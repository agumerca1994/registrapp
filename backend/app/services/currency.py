"""Shared currency / FX helpers.

Central home for the exchange-rate vocabulary, the USD holding formula and the
lazily-created "Consumo en dólares" category (which used to be copy-pasted in
`routers/expenses.py` and `routers/credit_cards.py`).

The mental model this module encodes: buying foreign currency is a **transfer
between pockets**, not an expense. It never touches income/expense totals, but
it does move the holding and the available pesos.
"""
import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import Date, select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry
from app.models.macro_variable import MacroVariable
from app.models.tenant import Tenant
from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.currency_operation import CurrencyOperation

# Exchange-rate vocabulary shared by shared-expense settlement conversion and
# by currency operations. "personalizado" means the user typed a rate by hand
# and there is no MacroVariable column behind it.
RATE_TYPES = ("oficial", "blue", "mayorista", "mep", "ccl", "personalizado")

RATE_TYPE_COLUMN = {
    "oficial": MacroVariable.usd_official,
    "blue": MacroVariable.usd_blue,
    "mayorista": MacroVariable.usd_mayorista,
    "mep": MacroVariable.usd_mep,
    "ccl": MacroVariable.usd_ccl,
}

DEFAULT_RATE_TYPE = "blue"

USD_CATEGORY_NAME = "Consumo en dólares"
USD_CATEGORY_COLOR = "#22c55e"

ZERO = Decimal("0")


@dataclass
class HoldingBreakdown:
    """Stock (holding) plus the all-time flows that produced it."""
    holding: Decimal          # what's actually held right now
    initial: Decimal          # starting balance the user declared
    bought: Decimal           # USD in via `buy`
    sold: Decimal             # USD out via `sell` (positive number)
    adjustments: Decimal      # net manual corrections (signed)
    spent: Decimal            # USD that has actually left (positive number)
    earned: Decimal           # USD in via income entries
    start_date: date | None   # cutoff — outflows before it are ignored
    pending: Decimal          # billed to a card but not due yet (positive)
    next_due_date: date | None  # when the next card statement takes its dollars


DEFAULT_DUE_DAY = 10


def estimated_due_date():
    """Where a statement's due date lands when the bank hasn't sent it yet.

    Statements are built up by hand during the month and future ones are created
    outright by instalment propagation, so `due_date` is NULL for a large share
    of them — that's the normal state, not an edge case. But the *month* is never
    in doubt: a period-M statement is paid in M+1. Only the day is unknown, and
    the day barely matters because everything aggregates monthly.

    So: day `credit_cards.due_day` (seeded from that card's last real due date)
    of the month after the statement period.
    """
    return func.cast(
        func.make_date(CreditCardStatement.year, CreditCardStatement.month, 1)
        + func.make_interval(0, 1, 0, func.coalesce(CreditCard.due_day, DEFAULT_DUE_DAY) - 1),
        Date,
    )


def estimate_due_date_py(year: int, month: int, due_day: int | None) -> date:
    """Python mirror of `estimated_due_date()` — same rule, for API responses.

    Kept next to the SQL version on purpose: if the two ever drift, the number
    the dashboard aggregates and the date shown on the statement stop matching.
    """
    y, m = (year + 1, 1) if month == 12 else (year, month + 1)
    day = due_day or DEFAULT_DUE_DAY
    last = calendar.monthrange(y, m)[1]
    return date(y, m, min(day, last))


def statement_due_date():
    """When a statement is paid — real date if known, estimate otherwise.

    Same rule `cash_out_date()` applies to expenses, but usable on queries that
    start from the statement instead of the expense entry. Requires
    `credit_card_statements` joined to `credit_cards`.
    """
    return func.coalesce(CreditCardStatement.due_date, estimated_due_date())


def cash_out_date():
    """When an expense actually takes money out.

    A card purchase doesn't move money on the purchase date — it moves when the
    statement is paid, a month later ("las tarjetas se pagan a mes vencido").
    So a card-linked expense cashes out on its statement's due date, real or
    estimated; anything else (cash, immediate purchase) on its own date.

    Falling back straight to `expense_date` for a statement without a due date
    would silently revert to purchase-date accounting for exactly the rows that
    need this most — every future instalment.

    Requires the outer joins in `with_statement()`.
    """
    return func.coalesce(
        CreditCardStatement.due_date,
        estimated_due_date(),
        ExpenseEntry.expense_date,
    )


def with_statement(q):
    """Attach each expense entry to its card statement and card, if any."""
    return (
        q.select_from(ExpenseEntry)
        .outerjoin(CreditCardItem, CreditCardItem.expense_entry_id == ExpenseEntry.id)
        .outerjoin(CreditCardStatement, CreditCardStatement.id == CreditCardItem.statement_id)
        .outerjoin(CreditCard, CreditCard.id == CreditCardStatement.card_id)
    )


async def get_or_create_usd_category(tenant_id: int, db: AsyncSession) -> int:
    """Id of this tenant's "Consumo en dólares" category, creating it on first use.

    USD expenses never ask the user for a category — they all land here, which is
    why the dashboard groups the USD donut by `description` instead of category.
    """
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            ExpenseCategory.name == USD_CATEGORY_NAME,
        )
    )
    if not cat:
        cat = ExpenseCategory(
            tenant_id=tenant_id,
            name=USD_CATEGORY_NAME,
            color=USD_CATEGORY_COLOR,
            is_fixed=False,
        )
        db.add(cat)
        await db.flush()
    return cat.id


async def get_tenant_rate_type(db: AsyncSession, tenant_id: int) -> str:
    """The household's chosen USD quote.

    Read with an explicit query rather than `user.tenant.fx_rate_type` — the
    relationship isn't eager-loaded and touching it inside async code raises
    MissingGreenlet.
    """
    value = await db.scalar(select(Tenant.fx_rate_type).where(Tenant.id == tenant_id))
    return value or DEFAULT_RATE_TYPE


async def get_latest_rate(
    db: AsyncSession,
    rate_type: str | None,
    as_of: date | None = None,
) -> Decimal | None:
    """Most recent quote for `rate_type`, optionally as of a past date.

    Returns None for "personalizado" (no column backs it) or an unknown type.
    """
    col = RATE_TYPE_COLUMN.get(rate_type or "")
    if col is None:
        return None

    q = select(col).where(col.is_not(None))
    if as_of is not None:
        q = q.where(MacroVariable.period_date <= as_of)
    return await db.scalar(q.order_by(MacroVariable.period_date.desc()).limit(1))


async def get_fx_start_date(
    db: AsyncSession, tenant_id: int, currency: str = "USD"
) -> date | None:
    """Date of the declared starting balance, if any.

    Everything before it is considered already baked into that number.
    """
    return await db.scalar(
        select(CurrencyOperation.operation_date).where(
            CurrencyOperation.tenant_id == tenant_id,
            CurrencyOperation.currency == currency,
            CurrencyOperation.op_type == "initial",
        )
    )


async def get_usd_holding(
    db: AsyncSession,
    tenant_id: int,
    as_of: date | None = None,
    currency: str = "USD",
) -> HoldingBreakdown:
    """How much foreign currency is held, and the flows behind it.

    holding = SUM(currency_operations.foreign_amount)
            − SUM(USD expense entries dated on/after the starting-balance date)

    That date cutoff is load-bearing: the database already holds USD expenses
    from before the user ever declared a starting balance, and that declared
    number already reflects them. Without the cutoff they'd be subtracted twice.

    Outflows are counted on their `cash_out_date()`, not their purchase date —
    a card purchase takes its dollars when the statement comes due.

    `as_of` (inclusive) yields the holding at the close of a past date. It is
    capped at today: money that hasn't left yet isn't spent, so a future date
    would report a projection as if it were the current balance.
    """
    start_date = await get_fx_start_date(db, tenant_id, currency)

    today = date.today()
    cutoff = min(as_of, today) if as_of is not None else today

    def _op_sum(*extra):
        return select(func.coalesce(func.sum(CurrencyOperation.foreign_amount), ZERO)).where(
            CurrencyOperation.tenant_id == tenant_id,
            CurrencyOperation.currency == currency,
            CurrencyOperation.operation_date <= cutoff,
            *extra,
        )

    initial = await db.scalar(_op_sum(CurrencyOperation.op_type == "initial"))
    bought = await db.scalar(_op_sum(CurrencyOperation.op_type == "buy"))
    sold = await db.scalar(_op_sum(CurrencyOperation.op_type == "sell"))
    adjustments = await db.scalar(_op_sum(CurrencyOperation.op_type == "adjustment"))

    cash_out = cash_out_date()

    def _spent_q(*extra):
        q = with_statement(select(func.coalesce(func.sum(ExpenseEntry.amount), ZERO))).where(
            ExpenseEntry.tenant_id == tenant_id,
            ExpenseEntry.currency == currency,
            *extra,
        )
        if start_date is not None:
            q = q.where(cash_out >= start_date)
        return q

    # Income in the foreign currency is dollars coming in, exactly like a buy —
    # without this the USD balance and the holding would contradict each other.
    earned_q = select(func.coalesce(func.sum(IncomeEntry.amount), ZERO)).where(
        IncomeEntry.tenant_id == tenant_id,
        IncomeEntry.currency == currency,
        IncomeEntry.period_date <= cutoff,
    )
    if start_date is not None:
        earned_q = earned_q.where(IncomeEntry.period_date >= start_date)
    earned = await db.scalar(earned_q)

    spent = await db.scalar(_spent_q(cash_out <= cutoff))
    # Already billed, dollars not gone yet — what the next statement will take.
    pending = await db.scalar(_spent_q(cash_out > cutoff))
    next_due = await db.scalar(
        with_statement(select(func.min(cash_out))).where(
            ExpenseEntry.tenant_id == tenant_id,
            ExpenseEntry.currency == currency,
            cash_out > cutoff,
        )
    )

    # `sold` is stored negative (currency leaving), so this is a plain sum.
    holding = initial + bought + sold + adjustments + earned - spent

    return HoldingBreakdown(
        holding=holding,
        initial=initial,
        bought=bought,
        sold=-sold,
        adjustments=adjustments,
        earned=earned,
        spent=spent,
        start_date=start_date,
        pending=pending,
        next_due_date=next_due,
    )


async def get_fx_ars_flow(
    db: AsyncSession,
    tenant_id: int,
    start: date,
    end: date,
    currency: str = "USD",
) -> tuple[Decimal, Decimal]:
    """Pesos spent buying / received selling foreign currency in [start, end).

    This is what makes the dashboard's peso balance honest: neither leg is an
    income or an expense, but both change how many pesos are actually left.
    """
    def _ars_sum(op_type: str):
        return select(func.coalesce(func.sum(CurrencyOperation.ars_amount), ZERO)).where(
            CurrencyOperation.tenant_id == tenant_id,
            CurrencyOperation.currency == currency,
            CurrencyOperation.op_type == op_type,
            CurrencyOperation.operation_date >= start,
            CurrencyOperation.operation_date < end,
        )

    bought_ars = await db.scalar(_ars_sum("buy"))
    sold_ars = await db.scalar(_ars_sum("sell"))
    return bought_ars, sold_ars
