"""Créditos del hogar: hipotecario, personal, prendario, plan de ahorro, entre
particulares u otro. Lo usan `/credits`, la pantalla vieja `/mortgage` y el
analytics, así ninguno calcula una cuota por su cuenta.

Un crédito se define por dos ejes independientes (ver `MortgageLoan`):
cómo se ajusta (`adjustment` + `currency`) y cómo se amortiza
(`amortization`). Y la cuota se conoce de tres maneras (`method`): se calcula,
la persona la sabe, o se carga a mano cada mes. Las "unidades" de un crédito
son UVA si se ajusta por UVA, y su moneda si no.

Refinanciaciones, adelantos y cuotas de tarjeta no van acá: ya viven en el
resumen de la tarjeta, y cargarlas también como crédito las contaría dos veces.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, update as sa_update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import EXPENSE_SOURCE_MORTGAGE, ExpenseCategory, ExpenseEntry
from app.models.macro_variable import MacroVariable
from app.models.mortgage import LEGACY_TYPES, MortgageLoan, MortgageRecord
from app.services.clock import ar_today
from app.services.search import fold, fold_text

# kind → (cómo se llama en pantalla, categoría de sus cuotas). La hipoteca
# conserva "Hipoteca", que es la que ya existe en los hogares que la tenían.
KINDS: dict[str, tuple[str, str]] = {
    "hipotecario": ("Crédito hipotecario", "Hipoteca"),
    "personal": ("Préstamo personal", "Préstamo personal"),
    "prendario": ("Crédito prendario", "Crédito prendario"),
    "plan_ahorro": ("Plan de ahorro", "Plan de ahorro"),
    "particular": ("Préstamo de un particular", "Préstamo particular"),
    "otro": ("Crédito", "Créditos"),
}
CATEGORY_COLOR = "#6366f1"
ADJUSTMENTS = {"uva", "fija"}
AMORTIZATIONS = {"frances", "aleman", "americano"}
METHODS = {"formula", "cuota", "manual"}
CURRENCIES = {"ARS", "USD"}
PLAN_STATUSES = {"suscripto", "adjudicado"}
MAX_CUOTAS = 600


# ── Fechas ────────────────────────────────────────────────────────────────────

def add_months(year: int, month: int, delta: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + delta
    return idx // 12, idx % 12 + 1


def payment_date(year: int, month: int, payment_day: int | None) -> date:
    """El día en que vence la cuota de un mes: un día fijo, o el primer día hábil."""
    if payment_day is not None:
        return date(year, month, min(payment_day, calendar.monthrange(year, month)[1]))
    d = date(year, month, 1)
    while d.weekday() >= 5:
        d += timedelta(days=1)
    return d


def cuota_month(loan: MortgageLoan, n: int) -> tuple[int, int]:
    return add_months(loan.first_payment_date.year, loan.first_payment_date.month, n - 1)


def cuota_number_for(loan: MortgageLoan, year: int, month: int) -> int:
    first = loan.first_payment_date
    return (year - first.year) * 12 + (month - first.month) + 1


# ── Lo que se muestra ─────────────────────────────────────────────────────────

def kind_label(loan: MortgageLoan) -> str:
    return KINDS.get(loan.kind or "hipotecario", KINDS["otro"])[0]


def display_name(loan: MortgageLoan) -> str:
    """Cómo se nombra el crédito: el banco o la persona si está, si no el tipo."""
    return (loan.description or "").strip() or kind_label(loan)


def legacy_loan_type(adjustment: str, amortization: str, method: str) -> str:
    """El `loan_type` que todavía lee la pantalla de Hipoteca de producción."""
    if method == "manual":
        return "tasa_variable"
    if adjustment == "uva":
        return "uva_aleman" if amortization == "aleman" else "uva_frances"
    return "tasa_fija"


def from_legacy_type(loan_type: str) -> dict:
    """Lo inverso, para los préstamos que crea la pantalla vieja."""
    return dict(LEGACY_TYPES[loan_type])


# ── El cálculo ────────────────────────────────────────────────────────────────

@dataclass
class Row:
    """Una cuota, en unidades del crédito (UVA o su moneda)."""
    number: int
    cuota: Decimal
    capital: Decimal | None
    interest: Decimal | None
    balance: Decimal | None  # lo que queda después de pagarla


def monthly_rate(loan: MortgageLoan) -> Decimal:
    return Decimal(loan.tna or 0) / 12 / 100


def principal_units(loan: MortgageLoan) -> Decimal | None:
    value = loan.original_capital_uva if loan.adjustment == "uva" else loan.capital
    return Decimal(value) if value else None


def known_cuota(loan: MortgageLoan) -> Decimal | None:
    value = loan.cuota_uva if loan.adjustment == "uva" else loan.cuota_pesos
    return Decimal(value) if value else None


def french_cuota(principal: Decimal, rate: Decimal, n: int) -> Decimal:
    if rate == 0:
        return principal / n
    return principal * rate / (1 - (1 + rate) ** (-n))


def schedule_row(loan: MortgageLoan, n: int) -> Row | None:
    """La cuota n, o None si no se puede saber (manual, o faltan datos).

    Con la cuota conocida sólo se separa capital de interés en sistema francés
    y si se sabe el capital: es el único sistema donde la cuota pareja y la
    fórmula dicen lo mismo.
    """
    total = loan.total_cuotas
    if loan.method == "manual" or n < 1 or n > total:
        return None
    rate = monthly_rate(loan)
    principal = principal_units(loan)

    if loan.method == "cuota":
        cuota = known_cuota(loan)
        if cuota is None:
            return None
        if principal is None or loan.amortization != "frances":
            return Row(n, cuota, None, None, None)
        balance = principal
        for k in range(1, n + 1):
            interest = balance * rate
            capital = cuota - interest
            if capital <= 0:  # la cuota no cubre ni el interés: datos que no cierran
                return Row(n, cuota, None, None, None)
            if k == n:
                return Row(n, cuota, capital, interest, max(balance - capital, Decimal(0)))
            balance -= capital
            if balance <= 0:
                return Row(n, cuota, None, None, Decimal(0))
        return None

    if principal is None:
        return None
    balance = principal
    french = french_cuota(principal, rate, total)
    for k in range(1, n + 1):
        interest = balance * rate
        if loan.amortization == "aleman":
            capital = principal / total
        elif loan.amortization == "americano":
            capital = principal if k == total else Decimal(0)
        else:
            capital = french - interest
        if k == n:
            return Row(n, capital + interest, capital, interest, max(balance - capital, Decimal(0)))
        balance -= capital
    return None


def balance_after(loan: MortgageLoan, paid: int) -> Decimal | None:
    """Lo que se debe, en unidades, después de `paid` cuotas."""
    if paid <= 0:
        return principal_units(loan)
    if paid >= loan.total_cuotas:
        return Decimal(0)
    row = schedule_row(loan, paid)
    return row.balance if row else None


async def uva_at(db: AsyncSession, day: date | None = None) -> tuple[Decimal | None, date | None]:
    """El valor de la UVA más reciente hasta ese día (o el último conocido)."""
    q = select(MacroVariable).where(MacroVariable.uva_value.is_not(None))
    if day is not None:
        q = q.where(MacroVariable.period_date <= day)
    macro = await db.scalar(q.order_by(MacroVariable.period_date.desc()).limit(1))
    return (macro.uva_value, macro.period_date) if macro else (None, None)


@dataclass
class CuotaAmount:
    number: int
    amount: Decimal          # en `loan.currency`
    units: Decimal | None    # UVA, si se ajusta por UVA
    capital: Decimal | None  # en `loan.currency`
    interest: Decimal | None
    estimated: bool          # la UVA de ese día todavía no se conoce


async def cuota_amount(db: AsyncSession, loan: MortgageLoan, n: int, pay_day: date) -> CuotaAmount | None:
    row = schedule_row(loan, n)
    if row is None:
        return None
    if loan.adjustment != "uva":
        return CuotaAmount(n, row.cuota, None, row.capital, row.interest, False)
    uva, uva_day = await uva_at(db, pay_day)
    if uva is None:
        return None
    return CuotaAmount(
        n, row.cuota * uva, row.cuota,
        row.capital * uva if row.capital is not None else None,
        row.interest * uva if row.interest is not None else None,
        estimated=uva_day is None or uva_day < pay_day,
    )


# ── Escrituras ────────────────────────────────────────────────────────────────

async def category_for(db: AsyncSession, tenant_id: int, kind: str) -> ExpenseCategory:
    """La categoría de las cuotas de ese tipo. Busca por nombre plegado, igual
    que el alta de categorías, para no duplicar una "hipoteca" que ya existe."""
    name = KINDS.get(kind, KINDS["otro"])[1]
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            fold(ExpenseCategory.name) == fold_text(name),
        ).limit(1)
    )
    if cat is None:
        cat = ExpenseCategory(tenant_id=tenant_id, name=name, color=CATEGORY_COLOR, is_fixed=True)
        db.add(cat)
        await db.flush()
    return cat


def expense_description(loan: MortgageLoan) -> str:
    desc = (loan.description or "").strip()
    if (loan.kind or "hipotecario") == "hipotecario":
        return f"Cuota hipotecaria{' ' + desc if desc else ''}"
    return f"Cuota {kind_label(loan).lower()}{' ' + desc if desc else ''}"


async def record_payment(
    db: AsyncSession, loan: MortgageLoan, user_id: int | None, *,
    period: date, pay_day: date, amount: Decimal, number: int | None,
    units: Decimal | None = None, capital: Decimal | None = None,
    interest: Decimal | None = None, manual: bool = False,
) -> MortgageRecord:
    """Registra una cuota con su egreso. Sólo hace flush."""
    cents = Decimal("0.01")
    amount = Decimal(amount).quantize(cents)
    capital = Decimal(capital).quantize(cents) if capital is not None else None
    interest = Decimal(interest).quantize(cents) if interest is not None else None
    units = Decimal(units).quantize(Decimal("0.000001")) if units is not None else None
    cat = await category_for(db, loan.tenant_id, loan.kind or "hipotecario")
    expense = ExpenseEntry(
        tenant_id=loan.tenant_id,
        user_id=user_id,
        category_id=cat.id,
        amount=amount,
        currency=loan.currency or "ARS",
        description=expense_description(loan),
        expense_date=pay_day,
        notes=f"{units:.2f} UVAs" if units else None,
        source=EXPENSE_SOURCE_MORTGAGE,
    )
    db.add(expense)
    await db.flush()
    record = MortgageRecord(
        tenant_id=loan.tenant_id,
        mortgage_loan_id=loan.id,
        expense_entry_id=expense.id,
        period_date=period,
        payment_amount=amount,
        capital=capital,
        interest=interest,
        uva_units=units,
        cuota_number=number,
        currency=loan.currency or "ARS",
        is_manual=manual,
    )
    db.add(record)
    await db.flush()
    return record


async def sync_loan(db: AsyncSession, loan: MortgageLoan, user_id: int | None) -> int:
    """Registra cada cuota vencida que todavía no está. Idempotente; sólo flush.

    Un crédito manual no se registra solo: su monto no se puede prever.
    """
    if loan.method == "manual" or not loan.is_active:
        return 0
    today = ar_today()
    done = set((await db.scalars(
        select(MortgageRecord.period_date).where(MortgageRecord.mortgage_loan_id == loan.id)
    )).all())
    registered = 0
    for n in range(1, loan.total_cuotas + 1):
        year, month = cuota_month(loan, n)
        pay_day = payment_date(year, month, loan.payment_day)
        if pay_day > today:
            break
        period = date(year, month, 1)
        if period in done:
            continue
        calc = await cuota_amount(db, loan, n, pay_day)
        if calc is None or not calc.amount:
            continue
        await record_payment(
            db, loan, user_id, period=period, pay_day=pay_day, amount=calc.amount,
            number=n, units=calc.units, capital=calc.capital, interest=calc.interest,
        )
        registered += 1
    return registered


async def delete_loan(db: AsyncSession, loan: MortgageLoan, keep_history: bool) -> None:
    """Borra el crédito. Con `keep_history` las cuotas y sus egresos quedan,
    sueltos; si no, se van con él. Sólo flush."""
    if keep_history:
        await db.execute(
            sa_update(MortgageRecord)
            .where(MortgageRecord.mortgage_loan_id == loan.id)
            .values(mortgage_loan_id=None)
        )
    else:
        records = (await db.scalars(
            select(MortgageRecord).where(MortgageRecord.mortgage_loan_id == loan.id)
        )).all()
        # El registro primero: es el que apunta al egreso.
        expense_ids = [r.expense_entry_id for r in records if r.expense_entry_id]
        for r in records:
            await db.delete(r)
        await db.flush()
        for eid in expense_ids:
            expense = await db.get(ExpenseEntry, eid)
            if expense:
                await db.delete(expense)
    await db.flush()
    await db.delete(loan)
    await db.flush()


async def delete_manual_payment(db: AsyncSession, record: MortgageRecord) -> None:
    if not record.is_manual:
        raise HTTPException(
            status_code=400,
            detail="Esta cuota la registró la app y no se borra. Si el monto no es el del banco, corregí el crédito.",
        )
    expense_id = record.expense_entry_id
    await db.delete(record)
    await db.flush()
    if expense_id:
        expense = await db.get(ExpenseEntry, expense_id)
        if expense:
            await db.delete(expense)
            await db.flush()


# ── Resumen ───────────────────────────────────────────────────────────────────

@dataclass
class Summary:
    loan: MortgageLoan
    title: str
    kind_label: str
    cuota_numero: int          # la próxima a pagar
    cuotas_pagadas: int
    cuotas_restantes: int
    pct_completado: float
    finished: bool
    paid_this_month: bool
    this_month_record_id: int | None
    next_payment_date: date | None
    next_amount: Decimal | None
    next_units: Decimal | None
    next_is_estimated: bool
    balance: Decimal | None        # en `currency`
    balance_units: Decimal | None  # UVA
    total_paid: Decimal
    records_count: int
    uva_value: Decimal | None
    uva_date: date | None


async def summarize(db: AsyncSession, loan: MortgageLoan, today: date | None = None) -> Summary:
    today = today or ar_today()
    records = (await db.scalars(
        select(MortgageRecord).where(MortgageRecord.mortgage_loan_id == loan.id)
    )).all()
    month_start = date(today.year, today.month, 1)
    this_month = next((r for r in records if r.period_date == month_start), None)

    current = cuota_number_for(loan, today.year, today.month)
    next_n = max(1, current + (1 if this_month else 0))
    if loan.method == "manual" and records:
        # Lo manual avanza por lo cargado: la próxima es la siguiente a la última.
        last = max((r.cuota_number or cuota_number_for(loan, r.period_date.year, r.period_date.month)) for r in records)
        next_n = max(next_n, last + 1)
    paid = min(next_n - 1, loan.total_cuotas)
    finished = next_n > loan.total_cuotas

    next_day = next_amount = next_units = None
    estimated = False
    if not finished:
        year, month = cuota_month(loan, next_n)
        next_day = payment_date(year, month, loan.payment_day)
        calc = await cuota_amount(db, loan, next_n, next_day)
        if calc:
            next_amount, next_units, estimated = calc.amount, calc.units, calc.estimated

    uva, uva_day = (await uva_at(db)) if loan.adjustment == "uva" else (None, None)
    units_left = balance_after(loan, paid)
    if loan.adjustment == "uva":
        balance_units = units_left
        balance = units_left * uva if units_left is not None and uva else None
    else:
        balance_units, balance = None, units_left

    def q(v: Decimal | None, places: str = "0.01") -> Decimal | None:
        return Decimal(v).quantize(Decimal(places)) if v is not None else None

    return Summary(
        loan=loan,
        title=display_name(loan),
        kind_label=kind_label(loan),
        cuota_numero=min(next_n, loan.total_cuotas),
        cuotas_pagadas=paid,
        cuotas_restantes=max(0, loan.total_cuotas - paid),
        pct_completado=round(paid / loan.total_cuotas * 100, 1) if loan.total_cuotas else 0.0,
        finished=finished,
        paid_this_month=this_month is not None,
        this_month_record_id=this_month.id if this_month else None,
        next_payment_date=next_day,
        next_amount=q(next_amount),
        next_units=q(next_units, "0.0001"),
        next_is_estimated=estimated,
        balance=q(balance),
        balance_units=q(balance_units, "0.0001"),
        total_paid=sum((r.payment_amount for r in records), Decimal(0)),
        records_count=len(records),
        uva_value=uva,
        uva_date=uva_day,
    )


# ── Lo que el analytics necesita ──────────────────────────────────────────────

async def active_loans(db: AsyncSession, tenant_id: int) -> list[MortgageLoan]:
    return list((await db.scalars(
        select(MortgageLoan).where(
            MortgageLoan.tenant_id == tenant_id,
            MortgageLoan.is_active == True,  # noqa: E712 — SQLAlchemy needs the literal
        ).order_by(MortgageLoan.id)
    )).all())


async def payments_for_month(
    db: AsyncSession, tenant_id: int, start: date, end: date, currency: str = "ARS",
) -> tuple[Decimal, Decimal]:
    """`(registrado, proyectado)` de las cuotas del mes, sumando todos los créditos.

    Por crédito: si la cuota del mes está registrada cuenta lo registrado (ya es
    un egreso); si no, se proyecta. Un crédito manual no se proyecta. La
    proyección de una cuota UVA usa la UVA más reciente hasta fin de mes.
    """
    recorded = sum((r.payment_amount for r in (await db.scalars(
        select(MortgageRecord).where(
            MortgageRecord.tenant_id == tenant_id,
            MortgageRecord.period_date >= start,
            MortgageRecord.period_date < end,
            MortgageRecord.currency == currency,
        )
    )).all()), Decimal(0))
    recorded_loans = set((await db.scalars(
        select(MortgageRecord.mortgage_loan_id).where(
            MortgageRecord.tenant_id == tenant_id,
            MortgageRecord.period_date >= start,
            MortgageRecord.period_date < end,
        )
    )).all())

    projected = Decimal(0)
    for loan in await active_loans(db, tenant_id):
        if loan.id in recorded_loans or (loan.currency or "ARS") != currency:
            continue
        n = cuota_number_for(loan, start.year, start.month)
        calc = await cuota_amount(db, loan, n, end - timedelta(days=1))
        if calc:
            projected += calc.amount
    return recorded, projected
