"""Shared currency / FX helpers.

Central home for the exchange-rate vocabulary, the USD holding formula and the
lazily-created "Consumo en dólares" category (which used to be copy-pasted in
`routers/expenses.py` and `routers/credit_cards.py`).

The mental model this module encodes: buying foreign currency is a **transfer
between pockets**, not an expense. It never touches income/expense totals, but
it does move the holding and the available pesos.
"""
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.macro_variable import MacroVariable
from app.models.tenant import Tenant
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
    spent: Decimal            # USD out via expense entries (positive number)
    start_date: date | None   # cutoff — expenses before it are ignored


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

    `as_of` (inclusive) yields the holding at the close of a past date.
    """
    start_date = await get_fx_start_date(db, tenant_id, currency)

    def _op_sum(*extra):
        q = select(func.coalesce(func.sum(CurrencyOperation.foreign_amount), ZERO)).where(
            CurrencyOperation.tenant_id == tenant_id,
            CurrencyOperation.currency == currency,
            *extra,
        )
        if as_of is not None:
            q = q.where(CurrencyOperation.operation_date <= as_of)
        return q

    initial = await db.scalar(_op_sum(CurrencyOperation.op_type == "initial"))
    bought = await db.scalar(_op_sum(CurrencyOperation.op_type == "buy"))
    sold = await db.scalar(_op_sum(CurrencyOperation.op_type == "sell"))
    adjustments = await db.scalar(_op_sum(CurrencyOperation.op_type == "adjustment"))

    spent_q = select(func.coalesce(func.sum(ExpenseEntry.amount), ZERO)).where(
        ExpenseEntry.tenant_id == tenant_id,
        ExpenseEntry.currency == currency,
    )
    if start_date is not None:
        spent_q = spent_q.where(ExpenseEntry.expense_date >= start_date)
    if as_of is not None:
        spent_q = spent_q.where(ExpenseEntry.expense_date <= as_of)
    spent = await db.scalar(spent_q)

    # `sold` is stored negative (currency leaving), so this is a plain sum.
    holding = initial + bought + sold + adjustments - spent

    return HoldingBreakdown(
        holding=holding,
        initial=initial,
        bought=bought,
        sold=-sold,
        adjustments=adjustments,
        spent=spent,
        start_date=start_date,
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
