"""Tenant-scoped analytics, independent of any auth dependency.

Everything the dashboard computes used to live inside `routers/dashboard.py`,
glued to `Depends(get_current_user)`. The MCP connector needs the same numbers
without ever seeing a Firebase token, so the logic moved here as plain
`(db, tenant_id, ...)` functions and the router became a thin shell.

Domain rules encoded here (they are load-bearing, not stylistic):
- Currencies never mix. ARS totals filter `currency == "ARS"`; USD is reported
  separately. `balance` is therefore ARS-only.
- Buying foreign currency is a transfer between pockets, not an expense, so it
  stays out of income/expense totals — but it does move real pesos, which is
  what `ars_available` reports.
- **Expenses count in the month the money leaves, not the month it was spent.**
  Argentine cards are paid a month in arrears, so a card purchase cashes out on
  its statement's due date (`cash_out_date()`). Dating by purchase overstated a
  month's outflow by everything charged to a card and not yet billed — for a
  card-heavy household that ran ~50% high — and made `ars_available` claim
  pesos that were already committed to next month's statement.
"""
from datetime import date, timedelta
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import and_, case, func, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource
from app.models.macro_variable import MacroVariable
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.models.payment_reminder import PaymentReminder
from app.services.currency import (
    RATE_TYPE_COLUMN, cash_out_date, get_fx_ars_flow, get_latest_rate,
    get_tenant_rate_type, get_usd_holding, with_statement,
)


class CategorySummary(BaseModel):
    category_name: str
    total: Decimal                 # ARS actually paid
    total_usd: Decimal = Decimal(0)  # USD actually paid, kept unmixed
    ars_equivalent: Decimal = Decimal(0)  # total + total_usd × rate, for ranking
    color: str | None = None


class MonthSummary(BaseModel):
    period: str
    total_income: Decimal
    total_income_usd: Decimal
    total_expenses: Decimal
    total_expenses_usd: Decimal
    balance: Decimal
    # Dollars in minus dollars out for the month. A flow, unlike `usd_holding`,
    # which is the stock that carries across months.
    balance_usd: Decimal
    # Buying foreign currency is neither income nor expense — it's a transfer
    # between pockets — so it stays out of `balance`. But it does move real
    # pesos, which is why `ars_available` exists: without it the dashboard shows
    # more pesos than the household actually has left.
    fx_bought_ars: Decimal
    fx_sold_ars: Decimal
    ars_available: Decimal
    usd_holding: Decimal
    usd_holding_ars: Decimal | None
    usd_rate: Decimal | None
    usd_rate_type: str
    mortgage_payment: Decimal | None
    mortgage_is_projected: bool
    uva_value: Decimal | None
    inflation_pct: Decimal | None
    expenses_by_category: list[CategorySummary]


class HistoryPoint(BaseModel):
    period: str
    total_income: Decimal
    total_expenses: Decimal
    mortgage_payment: Decimal | None
    uva_value: Decimal | None
    inflation_pct: Decimal | None


def month_bounds(year: int, month: int) -> tuple[date, date]:
    """First day of the month and first day of the next one (half-open range)."""
    start = date(year, month, 1)
    end = date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)
    return start, end


def add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    """Shift a (year, month) pair by `delta` months, in either direction."""
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


async def mortgage_payment_for_month(
    db: AsyncSession, tenant_id: int, start: date, end: date
) -> tuple[Decimal | None, bool]:
    """Recorded mortgage payment for the month, or one projected from the active loan.

    Returns `(amount, is_projected)`. UVA loans project as `cuota_uva` times the
    latest known UVA value; fixed-rate loans just repeat `cuota_pesos`.
    """
    record = await db.scalar(
        select(MortgageRecord).where(
            MortgageRecord.tenant_id == tenant_id,
            MortgageRecord.period_date >= start,
            MortgageRecord.period_date < end,
        )
    )
    if record:
        return record.payment_amount, False

    active_loan = await db.scalar(
        select(MortgageLoan).where(
            MortgageLoan.tenant_id == tenant_id,
            MortgageLoan.is_active == True,  # noqa: E712 — SQLAlchemy needs the literal
        ).limit(1)
    )
    if not active_loan:
        return None, False

    if active_loan.loan_type in ("uva_frances", "uva_aleman") and active_loan.cuota_uva:
        latest_macro = await db.scalar(
            select(MacroVariable)
            .where(MacroVariable.uva_value.is_not(None), MacroVariable.period_date <= end)
            .order_by(MacroVariable.period_date.desc())
            .limit(1)
        )
        if latest_macro and latest_macro.uva_value:
            return active_loan.cuota_uva * latest_macro.uva_value, True
    elif active_loan.loan_type == "tasa_fija" and active_loan.cuota_pesos:
        return active_loan.cuota_pesos, True

    return None, False


async def month_summary(
    db: AsyncSession, tenant_id: int, year: int, month: int
) -> MonthSummary:
    """Everything the dashboard shows for a single calendar month."""
    start, end = month_bounds(year, month)

    def _income_sum(currency: str):
        return select(func.coalesce(func.sum(IncomeEntry.amount), 0)).where(
            IncomeEntry.tenant_id == tenant_id,
            IncomeEntry.period_date >= start,
            IncomeEntry.period_date < end,
            IncomeEntry.currency == currency,
        )

    total_income = await db.scalar(_income_sum("ARS"))
    total_income_usd = await db.scalar(_income_sum("USD"))

    cash_out = cash_out_date()

    def _expense_sum(currency: str):
        return with_statement(
            select(func.coalesce(func.sum(ExpenseEntry.amount), 0))
        ).where(
            ExpenseEntry.tenant_id == tenant_id,
            ExpenseEntry.currency == currency,
            cash_out >= start,
            cash_out < end,
        )

    total_expenses = await db.scalar(_expense_sum("ARS"))
    total_expenses_usd = await db.scalar(_expense_sum("USD"))

    # One row per category with both currencies side by side. Kept apart rather
    # than summed: mixing them would hide which part of a category was actually
    # paid in dollars. `ars_equivalent` is only for ordering and for the "total
    # spent on this" reading the user asked for.
    rows = await db.execute(
        with_statement(select(
            ExpenseCategory.name,
            ExpenseCategory.color,
            func.coalesce(func.sum(
                case((ExpenseEntry.currency == "ARS", ExpenseEntry.amount), else_=0)
            ), 0).label("total"),
            func.coalesce(func.sum(
                case((ExpenseEntry.currency == "USD", ExpenseEntry.amount), else_=0)
            ), 0).label("total_usd"),
        ))
        .join(ExpenseCategory, ExpenseEntry.category_id == ExpenseCategory.id)
        .where(
            ExpenseEntry.tenant_id == tenant_id,
            cash_out >= start,
            cash_out < end,
        )
        .group_by(ExpenseCategory.name, ExpenseCategory.color)
    )
    cat_rows = list(rows)

    mortgage_payment, mortgage_is_projected = await mortgage_payment_for_month(
        db, tenant_id, start, end
    )

    macro = await db.scalar(
        select(MacroVariable).where(
            MacroVariable.period_date >= start,
            MacroVariable.period_date < end,
        )
    )

    # Foreign-currency side: pesos moved by conversions this month, plus the
    # holding at the close of the month (a stock, so it carries across months —
    # dollars bought in one month to pay the next month's card statement).
    fx_bought_ars, fx_sold_ars = await get_fx_ars_flow(db, tenant_id, start, end)
    holding = await get_usd_holding(db, tenant_id, as_of=end - timedelta(days=1))
    rate_type = await get_tenant_rate_type(db, tenant_id)
    usd_rate = await get_latest_rate(db, rate_type)
    usd_holding_ars = (
        (holding.holding * usd_rate).quantize(Decimal("0.01")) if usd_rate is not None else None
    )

    balance = total_income - total_expenses

    rate_for_mix = usd_rate or Decimal(0)
    by_category = sorted(
        (
            CategorySummary(
                category_name=r.name,
                total=r.total,
                total_usd=r.total_usd,
                ars_equivalent=r.total + r.total_usd * rate_for_mix,
                color=r.color,
            )
            for r in cat_rows
        ),
        key=lambda c: c.ars_equivalent,
        reverse=True,
    )

    return MonthSummary(
        period=f"{year}-{month:02d}",
        total_income=total_income,
        total_income_usd=total_income_usd,
        total_expenses=total_expenses,
        total_expenses_usd=total_expenses_usd,
        balance=balance,
        balance_usd=total_income_usd - total_expenses_usd,
        fx_bought_ars=fx_bought_ars,
        fx_sold_ars=fx_sold_ars,
        ars_available=balance - fx_bought_ars + fx_sold_ars,
        usd_holding=holding.holding,
        usd_holding_ars=usd_holding_ars,
        usd_rate=usd_rate,
        usd_rate_type=rate_type,
        mortgage_payment=mortgage_payment,
        mortgage_is_projected=mortgage_is_projected,
        uva_value=macro.uva_value if macro else None,
        inflation_pct=macro.inflation_monthly_pct if macro else None,
        expenses_by_category=by_category,
    )


async def history_series(db: AsyncSession, tenant_id: int) -> list[HistoryPoint]:
    """Month-by-month series across the household's whole history."""
    data: dict[str, dict] = {}

    def ensure(p: str) -> None:
        if p not in data:
            data[p] = dict(
                total_income=Decimal(0),
                total_expenses=Decimal(0),
                mortgage_payment=None,
                uva_value=None,
                inflation_pct=None,
            )

    rows = await db.execute(
        select(
            func.date_trunc("month", IncomeEntry.period_date).label("p"),
            func.sum(IncomeEntry.amount).label("total"),
        )
        .where(IncomeEntry.tenant_id == tenant_id)
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        ensure(k)
        data[k]["total_income"] = r.total

    rows = await db.execute(
        # ARS only and by cash-out month, matching month_summary — otherwise the
        # trend chart tells a different story than the balance above it.
        with_statement(select(
            func.date_trunc("month", cash_out_date()).label("p"),
            func.sum(ExpenseEntry.amount).label("total"),
        ))
        .where(ExpenseEntry.tenant_id == tenant_id, ExpenseEntry.currency == "ARS")
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        ensure(k)
        data[k]["total_expenses"] = r.total

    rows = await db.execute(
        select(
            func.date_trunc("month", MortgageRecord.period_date).label("p"),
            func.sum(MortgageRecord.payment_amount).label("total"),
        )
        .where(MortgageRecord.tenant_id == tenant_id)
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        ensure(k)
        data[k]["mortgage_payment"] = r.total

    rows = await db.execute(
        select(
            func.date_trunc("month", MacroVariable.period_date).label("p"),
            func.max(MacroVariable.uva_value).label("uva"),
            func.max(MacroVariable.inflation_monthly_pct).label("inflation"),
        )
        .group_by(text("1"))
    )
    for r in rows:
        k = str(r.p)[:7]
        # Macro data is global (no tenant_id) and can span years of history —
        # unlike the income/expense/mortgage loops above, it must only
        # enrich months where the tenant already has activity, never
        # fabricate a new all-zero month on its own (that pollutes the tail
        # of the sorted history with phantom recent months, breaking the
        # dashboard's "last 4 months" income trend when the tenant hasn't
        # logged the current month yet but macro already synced it).
        if k in data:
            data[k]["uva_value"] = r.uva
            data[k]["inflation_pct"] = r.inflation

    return [HistoryPoint(period=k, **data[k]) for k in sorted(data.keys())]


# ---------------------------------------------------------------------------
# Aggregations used by the MCP connector
# ---------------------------------------------------------------------------

def period_key(d: date) -> str:
    return f"{d.year}-{d.month:02d}"


def periods_between(start: date, end_inclusive: date) -> list[str]:
    """Every "YYYY-MM" from `start` to `end_inclusive`, in order."""
    out: list[str] = []
    y, m = start.year, start.month
    while (y, m) <= (end_inclusive.year, end_inclusive.month):
        out.append(f"{y}-{m:02d}")
        y, m = add_months(y, m, 1)
    return out


def _installment_entry_ids():
    """Sub-select of expense entries that are really credit-card instalments.

    Every `CreditCardItem` mirrors itself into `expense_entries`, dated at the
    purchase. Averaging those into a monthly run rate and then *also* counting
    the same instalments as future commitments would double-count them.
    """
    return select(CreditCardItem.expense_entry_id).where(
        CreditCardItem.item_type == "installment",
        CreditCardItem.expense_entry_id.is_not(None),
    )


def _mortgage_entry_ids():
    """Mortgage payments mirror into expenses too, and are projected separately."""
    return select(MortgageRecord.expense_entry_id).where(
        MortgageRecord.expense_entry_id.is_not(None)
    )


async def expense_aggregate(
    db: AsyncSession,
    tenant_id: int,
    start: date,
    end: date,
    *,
    currency: str = "ARS",
    category: str | None = None,
    payment_method: str | None = None,
    entity: str | None = None,
    search: str | None = None,
    min_amount: Decimal | None = None,
    group_by: str = "category",
    limit: int = 50,
) -> dict:
    """Expenses in `[start, end)` for one currency, grouped or listed.

    Never mixes currencies: the caller asks for one and gets one.
    """
    filters = [
        ExpenseEntry.tenant_id == tenant_id,
        ExpenseEntry.expense_date >= start,
        ExpenseEntry.expense_date < end,
        ExpenseEntry.currency == currency,
    ]
    if payment_method == "tarjeta_credito":
        filters.append(ExpenseEntry.payment_method == "tarjeta_credito")
    elif payment_method == "otros":
        filters.append(or_(
            ExpenseEntry.payment_method.is_(None),
            ExpenseEntry.payment_method != "tarjeta_credito",
        ))
    if entity:
        filters.append(ExpenseEntry.entity.ilike(f"%{entity}%"))
    if search:
        filters.append(ExpenseEntry.description.ilike(f"%{search}%"))
    if min_amount is not None:
        filters.append(ExpenseEntry.amount >= min_amount)
    if category:
        filters.append(ExpenseEntry.category_id.in_(
            select(ExpenseCategory.id).where(
                ExpenseCategory.tenant_id == tenant_id,
                ExpenseCategory.name.ilike(f"%{category}%"),
            )
        ))

    total = await db.scalar(
        select(func.coalesce(func.sum(ExpenseEntry.amount), 0)).where(*filters)
    )
    count = await db.scalar(select(func.count(ExpenseEntry.id)).where(*filters))

    groups: list[dict] = []
    entries: list[dict] | None = None

    if group_by == "category":
        rows = await db.execute(
            select(
                ExpenseCategory.name.label("k"),
                func.sum(ExpenseEntry.amount).label("total"),
                func.count(ExpenseEntry.id).label("n"),
            )
            .join(ExpenseCategory, ExpenseEntry.category_id == ExpenseCategory.id)
            .where(*filters)
            .group_by(ExpenseCategory.name)
            .order_by(func.sum(ExpenseEntry.amount).desc())
        )
        groups = [{"key": r.k, "total": r.total, "count": r.n} for r in rows]

    elif group_by == "month":
        rows = await db.execute(
            select(
                func.date_trunc("month", ExpenseEntry.expense_date).label("k"),
                func.sum(ExpenseEntry.amount).label("total"),
                func.count(ExpenseEntry.id).label("n"),
            )
            .where(*filters)
            # Positional grouping: asyncpg gives the repeated date_trunc a
            # different placeholder index in SELECT vs GROUP BY and Postgres
            # rejects it.
            .group_by(text("1"))
            .order_by(text("1"))
        )
        groups = [{"key": str(r.k)[:7], "total": r.total, "count": r.n} for r in rows]

    elif group_by in ("description", "entity"):
        col = ExpenseEntry.description if group_by == "description" else ExpenseEntry.entity
        rows = await db.execute(
            select(col.label("k"), func.sum(ExpenseEntry.amount).label("total"),
                   func.count(ExpenseEntry.id).label("n"))
            .where(*filters)
            .group_by(col)
            .order_by(func.sum(ExpenseEntry.amount).desc())
            .limit(limit)
        )
        groups = [{"key": r.k or "(sin dato)", "total": r.total, "count": r.n} for r in rows]

    else:  # "none" — raw rows, capped
        rows = await db.execute(
            select(ExpenseEntry, ExpenseCategory.name)
            .join(ExpenseCategory, ExpenseEntry.category_id == ExpenseCategory.id)
            .where(*filters)
            .order_by(ExpenseEntry.expense_date.desc(), ExpenseEntry.id.desc())
            .limit(limit)
        )
        entries = [
            {
                "date": e.expense_date.isoformat(),
                "amount": e.amount,
                "description": e.description,
                "category": cat_name,
                "payment_method": e.payment_method,
                "entity": e.entity,
            }
            for e, cat_name in rows
        ]

    return {
        "total": total,
        "count": count,
        "groups": groups,
        "entries": entries,
        "truncated": bool(entries is not None and count > len(entries)),
    }


async def income_aggregate(
    db: AsyncSession,
    tenant_id: int,
    start: date,
    end: date,
    *,
    source: str | None = None,
    income_type: str | None = None,
    group_by: str = "month",
    limit: int = 50,
) -> dict:
    """Income in `[start, end)`. Income has no currency column — it is always ARS."""
    filters = [
        IncomeEntry.tenant_id == tenant_id,
        IncomeEntry.period_date >= start,
        IncomeEntry.period_date < end,
    ]
    if source or income_type:
        src = [IncomeSource.tenant_id == tenant_id]
        if source:
            src.append(IncomeSource.name.ilike(f"%{source}%"))
        if income_type:
            src.append(IncomeSource.income_type == income_type)
        filters.append(IncomeEntry.source_id.in_(select(IncomeSource.id).where(*src)))

    totals = (await db.execute(
        select(
            func.coalesce(func.sum(IncomeEntry.amount), 0),
            func.coalesce(func.sum(IncomeEntry.bruto), 0),
            func.coalesce(func.sum(IncomeEntry.deducciones), 0),
            func.count(IncomeEntry.id),
        ).where(*filters)
    )).one()

    groups: list[dict] = []
    entries: list[dict] | None = None

    if group_by == "month":
        rows = await db.execute(
            select(
                func.date_trunc("month", IncomeEntry.period_date).label("k"),
                func.sum(IncomeEntry.amount).label("neto"),
                func.sum(IncomeEntry.bruto).label("bruto"),
            )
            .where(*filters)
            .group_by(text("1"))
            .order_by(text("1"))
        )
        groups = [{"key": str(r.k)[:7], "neto": r.neto, "bruto": r.bruto} for r in rows]

    elif group_by == "source":
        rows = await db.execute(
            select(
                IncomeSource.name.label("k"),
                func.sum(IncomeEntry.amount).label("neto"),
                func.sum(IncomeEntry.bruto).label("bruto"),
            )
            .join(IncomeSource, IncomeEntry.source_id == IncomeSource.id)
            .where(*filters)
            .group_by(IncomeSource.name)
            .order_by(func.sum(IncomeEntry.amount).desc())
        )
        groups = [{"key": r.k, "neto": r.neto, "bruto": r.bruto} for r in rows]

    else:
        rows = await db.execute(
            select(IncomeEntry, IncomeSource.name)
            .join(IncomeSource, IncomeEntry.source_id == IncomeSource.id)
            .where(*filters)
            .order_by(IncomeEntry.period_date.desc(), IncomeEntry.id.desc())
            .limit(limit)
        )
        entries = [
            {
                "period": period_key(e.period_date),
                "date": e.period_date.isoformat(),
                "source": src_name,
                "neto": e.amount,
                "bruto": e.bruto,
                "deducciones": e.deducciones,
            }
            for e, src_name in rows
        ]

    return {
        "total_neto": totals[0],
        "total_bruto": totals[1],
        "total_deducciones": totals[2],
        "count": totals[3],
        "groups": groups,
        "entries": entries,
        "truncated": bool(entries is not None and totals[3] > len(entries)),
    }


MACRO_COLUMNS = {
    "inflation_monthly_pct": MacroVariable.inflation_monthly_pct,
    "inflation_interanual_pct": MacroVariable.inflation_interanual_pct,
    "uva_value": MacroVariable.uva_value,
    "usd_official": MacroVariable.usd_official,
    "usd_blue": MacroVariable.usd_blue,
    "usd_mayorista": MacroVariable.usd_mayorista,
    "usd_mep": MacroVariable.usd_mep,
    "usd_ccl": MacroVariable.usd_ccl,
    "uvi": MacroVariable.uvi,
    "icl": MacroVariable.icl,
    "ripte": MacroVariable.ripte,
    "smvm": MacroVariable.smvm,
    "canasta_basica_total": MacroVariable.canasta_basica_total,
}


async def macro_monthly(
    db: AsyncSession, start: date, end: date, columns: list[str] | None = None
) -> dict[str, dict]:
    """One row per month for the requested macro columns.

    `macro_variables` is global (no tenant) and stores one row per *day*, so
    everything gets collapsed with max() — for a monthly index like inflation
    every day of the month carries the same value anyway.
    """
    wanted = [c for c in (columns or list(MACRO_COLUMNS)) if c in MACRO_COLUMNS]
    if not wanted:
        return {}

    rows = await db.execute(
        select(
            func.date_trunc("month", MacroVariable.period_date).label("k"),
            *[func.max(MACRO_COLUMNS[c]).label(c) for c in wanted],
        )
        .where(MacroVariable.period_date >= start, MacroVariable.period_date < end)
        .group_by(text("1"))
        .order_by(text("1"))
    )
    return {str(r.k)[:7]: {c: getattr(r, c) for c in wanted} for r in rows}


async def inflation_index(db: AsyncSession, periods: list[str]) -> dict[str, dict]:
    """Chained CPI index over `periods`, normalised so the last one is 100.

    `CPI_t = Pi (1 + pi_k/100)` from the first period onwards, then rebased.
    Months INDEC hasn't published yet reuse the last known rate and come back
    flagged `estimated`, so callers can say so instead of quietly inventing one.
    """
    if not periods:
        return {}

    first = date(int(periods[0][:4]), int(periods[0][5:7]), 1)
    last_y, last_m = int(periods[-1][:4]), int(periods[-1][5:7])
    ny, nm = add_months(last_y, last_m, 1)
    macro = await macro_monthly(db, first, date(ny, nm, 1), ["inflation_monthly_pct"])

    level = Decimal(1)
    last_known: Decimal | None = None
    raw: dict[str, tuple[Decimal, bool]] = {}
    for p in periods:
        rate = (macro.get(p) or {}).get("inflation_monthly_pct")
        estimated = rate is None
        if rate is None:
            rate = last_known if last_known is not None else Decimal(0)
        else:
            last_known = rate
        level = level * (1 + Decimal(rate) / 100)
        raw[p] = (level, estimated)

    base = raw[periods[-1]][0]
    return {p: {"index": lvl / base * 100, "estimated": est} for p, (lvl, est) in raw.items()}


async def committed_installments_by_period(
    db: AsyncSession, tenant_id: int, periods: list[str], currency: str = "ARS"
) -> dict[str, list[dict]]:
    """Instalments already booked into each future statement, by billing month.

    These are certainties, not forecasts: every cuota of a plan is written into
    its statement the moment the purchase is loaded.
    """
    if not periods:
        return {}
    pairs = [(int(p[:4]), int(p[5:7])) for p in periods]

    rows = await db.execute(
        select(
            CreditCardStatement.year,
            CreditCardStatement.month,
            CreditCardItem.description,
            CreditCardItem.amount,
            CreditCardItem.installment_number,
            CreditCardItem.installment_count,
            CreditCard.alias,
        )
        .join(CreditCardStatement, CreditCardItem.statement_id == CreditCardStatement.id)
        .join(CreditCard, CreditCardStatement.card_id == CreditCard.id)
        .where(
            CreditCardStatement.tenant_id == tenant_id,
            CreditCardItem.item_type == "installment",
            CreditCardItem.currency == currency,
            or_(*[
                and_(CreditCardStatement.year == y, CreditCardStatement.month == m)
                for y, m in pairs
            ]),
        )
        .order_by(CreditCardItem.amount.desc())
    )

    out: dict[str, list[dict]] = {p: [] for p in periods}
    for r in rows:
        out[f"{r.year}-{r.month:02d}"].append({
            "description": r.description,
            "amount": r.amount,
            "cuota": (
                f"{r.installment_number}/{r.installment_count}"
                if r.installment_number and r.installment_count else None
            ),
            "card": r.alias,
        })
    return out


async def statement_totals_by_period(
    db: AsyncSession, tenant_id: int, periods: list[str]
) -> dict[str, list[dict]]:
    """Per-card statement totals (ARS and USD kept apart) for the given months."""
    if not periods:
        return {}
    pairs = [(int(p[:4]), int(p[5:7])) for p in periods]

    rows = await db.execute(
        select(
            CreditCardStatement.year,
            CreditCardStatement.month,
            CreditCard.alias,
            CreditCardStatement.closing_date,
            CreditCardStatement.due_date,
            CreditCardItem.currency,
            func.sum(CreditCardItem.amount).label("total"),
            func.count(CreditCardItem.id).label("n"),
        )
        .join(CreditCard, CreditCardStatement.card_id == CreditCard.id)
        .join(CreditCardItem, CreditCardItem.statement_id == CreditCardStatement.id)
        .where(
            CreditCardStatement.tenant_id == tenant_id,
            or_(*[
                and_(CreditCardStatement.year == y, CreditCardStatement.month == m)
                for y, m in pairs
            ]),
        )
        .group_by(
            CreditCardStatement.year, CreditCardStatement.month, CreditCard.alias,
            CreditCardStatement.closing_date, CreditCardStatement.due_date,
            CreditCardItem.currency,
        )
    )

    out: dict[str, dict[str, dict]] = {p: {} for p in periods}
    for r in rows:
        period = f"{r.year}-{r.month:02d}"
        card = out[period].setdefault(r.alias, {
            "card": r.alias,
            "closing_date": r.closing_date.isoformat() if r.closing_date else None,
            "due_date": r.due_date.isoformat() if r.due_date else None,
            "total_ars": Decimal(0),
            "total_usd": Decimal(0),
            "items": 0,
        })
        card["total_usd" if r.currency == "USD" else "total_ars"] += r.total
        card["items"] += r.n

    return {p: list(cards.values()) for p, cards in out.items()}


async def reminders_by_period(
    db: AsyncSession, tenant_id: int, start: date, end: date
) -> dict[str, list[dict]]:
    rows = (await db.execute(
        select(PaymentReminder)
        .where(
            PaymentReminder.tenant_id == tenant_id,
            PaymentReminder.remind_date >= start,
            PaymentReminder.remind_date < end,
        )
        .order_by(PaymentReminder.remind_date)
    )).scalars().all()

    out: dict[str, list[dict]] = {}
    for r in rows:
        out.setdefault(period_key(r.remind_date), []).append(
            {"title": r.title, "date": r.remind_date.isoformat()}
        )
    return out


async def baseline_run_rate(
    db: AsyncSession, tenant_id: int, months: int, *, until: date
) -> dict:
    """Average monthly income and "ordinary" expenses over the last closed months.

    Ordinary means: excluding credit-card instalments and mortgage payments,
    both of which get counted as explicit future commitments instead. Leaving
    them in the average *and* adding them per month would count them twice.
    """
    start_y, start_m = add_months(until.year, until.month, -months)
    start = date(start_y, start_m, 1)

    income = await db.scalar(
        select(func.coalesce(func.sum(IncomeEntry.amount), 0)).where(
            IncomeEntry.tenant_id == tenant_id,
            IncomeEntry.period_date >= start,
            IncomeEntry.period_date < until,
        )
    )

    expense_filters = [
        ExpenseEntry.tenant_id == tenant_id,
        ExpenseEntry.expense_date >= start,
        ExpenseEntry.expense_date < until,
        ExpenseEntry.currency == "ARS",
    ]
    gross = await db.scalar(
        select(func.coalesce(func.sum(ExpenseEntry.amount), 0)).where(*expense_filters)
    )
    ordinary = await db.scalar(
        select(func.coalesce(func.sum(ExpenseEntry.amount), 0)).where(
            *expense_filters,
            ExpenseEntry.id.not_in(_installment_entry_ids()),
            ExpenseEntry.id.not_in(_mortgage_entry_ids()),
        )
    )

    n = Decimal(months)
    prev_y, prev_m = add_months(until.year, until.month, -1)
    return {
        "months": months,
        "from": period_key(start),
        "to": f"{prev_y}-{prev_m:02d}",
        "avg_income": Decimal(income) / n,
        "avg_expenses_total": Decimal(gross) / n,
        "avg_expenses_ordinary": Decimal(ordinary) / n,
    }
