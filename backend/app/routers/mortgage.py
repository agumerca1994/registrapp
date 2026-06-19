import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sa_update
from datetime import date
from decimal import Decimal
import calendar

from app.core.database import get_db, AsyncSessionLocal
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.macro_variable import MacroVariable
from app.schemas.mortgage import (
    MortgageLoanCreate, MortgageLoanUpdate, MortgageLoanOut,
    MortgageSummary, MortgageRecordOut,
)

router = APIRouter(prefix="/mortgage", tags=["mortgage"])
logger = logging.getLogger(__name__)

HIPOTECA_CATEGORY_NAME = "Hipoteca"
HIPOTECA_CATEGORY_COLOR = "#6366f1"
UVA_LOAN_TYPES = {"uva_frances", "uva_aleman"}


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


async def _get_or_create_hipoteca_category(tenant_id: int, user_id: int, db: AsyncSession) -> ExpenseCategory:
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            ExpenseCategory.name == HIPOTECA_CATEGORY_NAME,
        )
    )
    if not cat:
        cat = ExpenseCategory(
            tenant_id=tenant_id,
            name=HIPOTECA_CATEGORY_NAME,
            color=HIPOTECA_CATEGORY_COLOR,
            is_fixed=True,
        )
        db.add(cat)
        await db.flush()
    return cat


def _compute_payment_date(year: int, month: int, payment_day: int | None) -> date:
    """Return the payment date for a given month based on loan configuration."""
    if payment_day is not None:
        max_day = calendar.monthrange(year, month)[1]
        return date(year, month, min(payment_day, max_day))
    # Primer día hábil: skip Saturday (5) and Sunday (6)
    d = date(year, month, 1)
    while d.weekday() >= 5:
        d = date(year, month, d.day + 1)
    return d


def _compute_cuota_numero(first_payment_date: date) -> int:
    today = date.today()
    months = (today.year - first_payment_date.year) * 12 + (today.month - first_payment_date.month)
    return max(1, months + 1)


def _compute_breakdown(loan: MortgageLoan, cuota_numero: int) -> tuple[Decimal | None, Decimal | None]:
    """Compute capital/interest UVA split for Sistema Francés."""
    if loan.loan_type != "uva_frances" or not loan.tna or not loan.original_capital_uva or not loan.cuota_uva:
        return None, None
    i = loan.tna / 12 / 100
    saldo = loan.original_capital_uva
    for _ in range(cuota_numero - 1):
        interes = saldo * i
        capital = loan.cuota_uva - interes
        saldo = saldo - capital
        if saldo <= 0:
            break
    if saldo <= 0:
        return None, None
    interes_n = saldo * i
    capital_n = loan.cuota_uva - interes_n
    return capital_n, interes_n


async def _sync_loan_cuotas(loan: MortgageLoan, user_id: int, db: AsyncSession) -> int:
    """Register all cuotas whose payment_date <= today and haven't been recorded yet.

    Includes the current month if the payment date has already passed.
    This is idempotent — existing records are skipped.
    """
    if loan.loan_type == "tasa_variable":
        return 0  # Can't auto-calculate historical amounts

    today = date.today()
    cat = await _get_or_create_hipoteca_category(loan.tenant_id, user_id, db)
    registered = 0

    cur_year = loan.first_payment_date.year
    cur_month = loan.first_payment_date.month

    while True:
        payment_date = _compute_payment_date(cur_year, cur_month, loan.payment_day)

        # Stop when we reach a month whose payment date is in the future
        if payment_date > today:
            break

        month_start = date(cur_year, cur_month, 1)

        existing = await db.scalar(
            select(MortgageRecord).where(
                MortgageRecord.mortgage_loan_id == loan.id,
                MortgageRecord.period_date == month_start,
            )
        )
        if not existing:
            uva_value: Decimal | None = None
            if loan.loan_type in UVA_LOAN_TYPES and loan.cuota_uva:
                macro = await db.scalar(
                    select(MacroVariable)
                    .where(
                        MacroVariable.uva_value.is_not(None),
                        MacroVariable.period_date <= payment_date,
                    )
                    .order_by(MacroVariable.period_date.desc())
                    .limit(1)
                )
                uva_value = macro.uva_value if macro else None

            payment_amount: Decimal | None = None
            uva_units: Decimal | None = None
            capital: Decimal | None = None
            interest: Decimal | None = None

            if loan.loan_type in UVA_LOAN_TYPES and loan.cuota_uva:
                uva_units = loan.cuota_uva
                if uva_value:
                    payment_amount = loan.cuota_uva * uva_value
                    cuota_n = (cur_year - loan.first_payment_date.year) * 12 + (cur_month - loan.first_payment_date.month) + 1
                    cap_uva, int_uva = _compute_breakdown(loan, cuota_n)
                    if cap_uva is not None:
                        capital = cap_uva * uva_value
                        interest = int_uva * uva_value
            elif loan.loan_type == "tasa_fija" and loan.cuota_pesos:
                payment_amount = loan.cuota_pesos

            if payment_amount:
                expense = ExpenseEntry(
                    tenant_id=loan.tenant_id,
                    user_id=user_id,
                    category_id=cat.id,
                    amount=payment_amount,
                    description=f"Cuota hipotecaria{' ' + loan.description if loan.description else ''}",
                    expense_date=payment_date,
                    notes=f"{uva_units} UVAs" if uva_units else None,
                )
                db.add(expense)
                await db.flush()

                db.add(MortgageRecord(
                    tenant_id=loan.tenant_id,
                    mortgage_loan_id=loan.id,
                    expense_entry_id=expense.id,
                    period_date=month_start,
                    payment_amount=payment_amount,
                    capital=capital,
                    interest=interest,
                    uva_units=uva_units,
                ))
                registered += 1

        # Advance to next month
        if cur_month == 12:
            cur_year += 1
            cur_month = 1
        else:
            cur_month += 1

    return registered


async def sync_all_active_loans():
    """Cron entry point: auto-register due cuotas for all active loans."""
    async with AsyncSessionLocal() as db:
        try:
            loans = (await db.scalars(
                select(MortgageLoan).where(MortgageLoan.is_active == True)
            )).all()
            total = 0
            for loan in loans:
                user = await db.scalar(
                    select(User).where(User.tenant_id == loan.tenant_id).limit(1)
                )
                if user:
                    total += await _sync_loan_cuotas(loan, user.id, db)
            await db.commit()
            if total:
                logger.info(f"Mortgage auto-sync: registered {total} cuotas")
        except Exception as e:
            logger.error(f"Mortgage auto-sync failed: {e}")
            await db.rollback()


# ── Loan CRUD ──────────────────────────────────────────────────────────────────

@router.get("/loans", response_model=list[MortgageLoanOut])
async def list_loans(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(MortgageLoan)
        .where(MortgageLoan.tenant_id == user.tenant_id)
        .order_by(MortgageLoan.created_at.desc())
    )
    return result.all()


@router.post("/loans", response_model=MortgageLoanOut, status_code=201)
async def create_loan(
    body: MortgageLoanCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    loan = MortgageLoan(**body.model_dump(), tenant_id=user.tenant_id)
    db.add(loan)
    await db.flush()
    await _sync_loan_cuotas(loan, user.id, db)
    await db.commit()
    await db.refresh(loan)
    return loan


@router.patch("/loans/{loan_id}", response_model=MortgageLoanOut)
async def update_loan(
    loan_id: int,
    body: MortgageLoanUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    loan = await db.get(MortgageLoan, loan_id)
    if not loan or loan.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(loan, field, value)
    await db.commit()
    await db.refresh(loan)
    return loan


@router.delete("/loans/{loan_id}", status_code=204)
async def delete_loan(
    loan_id: int,
    keep_history: bool = Query(default=True),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    loan = await db.get(MortgageLoan, loan_id)
    if not loan or loan.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")

    if keep_history:
        # Orphan the records (keep expenses and records, but detach from this loan)
        await db.execute(
            sa_update(MortgageRecord)
            .where(MortgageRecord.mortgage_loan_id == loan_id)
            .values(mortgage_loan_id=None)
        )
        await db.flush()
    else:
        # Delete all linked records and their expense entries.
        # Order matters: delete MortgageRecords first to release the FK on expense_entries,
        # then delete the ExpenseEntries.
        records = (await db.scalars(
            select(MortgageRecord).where(MortgageRecord.mortgage_loan_id == loan_id)
        )).all()
        expense_ids = [rec.expense_entry_id for rec in records if rec.expense_entry_id]
        for rec in records:
            await db.delete(rec)
        await db.flush()
        for eid in expense_ids:
            expense = await db.get(ExpenseEntry, eid)
            if expense:
                await db.delete(expense)
        await db.flush()

    await db.delete(loan)
    await db.commit()


# ── Summary ────────────────────────────────────────────────────────────────────

@router.get("/loans/{loan_id}/summary", response_model=MortgageSummary)
async def loan_summary(
    loan_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    loan = await db.get(MortgageLoan, loan_id)
    if not loan or loan.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")

    today = date.today()
    cuota_numero = _compute_cuota_numero(loan.first_payment_date)
    cuotas_restantes = max(0, loan.total_cuotas - cuota_numero + 1)
    pct_completado = round((cuota_numero - 1) / loan.total_cuotas * 100, 1)

    macro = await db.scalar(
        select(MacroVariable)
        .where(MacroVariable.uva_value.is_not(None))
        .order_by(MacroVariable.period_date.desc())
        .limit(1)
    )

    cuota_pesos_calculado: Decimal | None = None
    if loan.loan_type in UVA_LOAN_TYPES and loan.cuota_uva and macro and macro.uva_value:
        cuota_pesos_calculado = loan.cuota_uva * macro.uva_value
    elif loan.loan_type == "tasa_fija":
        cuota_pesos_calculado = loan.cuota_pesos

    month_start = date(today.year, today.month, 1)
    month_end = date(today.year, today.month + 1, 1) if today.month < 12 else date(today.year + 1, 1, 1)
    paid_record = await db.scalar(
        select(MortgageRecord).where(
            MortgageRecord.mortgage_loan_id == loan_id,
            MortgageRecord.period_date >= month_start,
            MortgageRecord.period_date < month_end,
        )
    )

    # Next payment date: next month if current month is already paid
    if paid_record:
        nm = today.month + 1 if today.month < 12 else 1
        ny = today.year if today.month < 12 else today.year + 1
        next_payment_date = _compute_payment_date(ny, nm, loan.payment_day)
    else:
        next_payment_date = _compute_payment_date(today.year, today.month, loan.payment_day)

    return MortgageSummary(
        loan=MortgageLoanOut.model_validate(loan),
        cuota_numero=cuota_numero,
        cuotas_restantes=cuotas_restantes,
        pct_completado=pct_completado,
        cuota_uva=loan.cuota_uva,
        latest_uva_value=macro.uva_value if macro else None,
        latest_uva_date=macro.period_date if macro else None,
        cuota_pesos_calculado=cuota_pesos_calculado,
        paid_this_month=paid_record is not None,
        mortgage_record_id=paid_record.id if paid_record else None,
        next_payment_date=next_payment_date,
    )


# ── Records (history display + manual delete) ──────────────────────────────────

@router.get("", response_model=list[MortgageRecordOut])
async def list_records(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(MortgageRecord)
        .where(MortgageRecord.tenant_id == user.tenant_id)
        .order_by(MortgageRecord.period_date.desc())
    )
    return result.all()


@router.delete("/{record_id}", status_code=204)
async def delete_record(
    record_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    record = await db.get(MortgageRecord, record_id)
    if not record or record.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    if record.expense_entry_id:
        expense = await db.get(ExpenseEntry, record.expense_entry_id)
        if expense:
            await db.delete(expense)
    await db.delete(record)
    await db.commit()
