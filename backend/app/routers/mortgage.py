from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date
from decimal import Decimal

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.macro_variable import MacroVariable
from app.schemas.mortgage import (
    MortgageLoanCreate, MortgageLoanUpdate, MortgageLoanOut,
    MortgageSummary, MortgageRecordCreate, MortgageRecordOut,
)

router = APIRouter(prefix="/mortgage", tags=["mortgage"])

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


def _compute_cuota_numero(first_payment_date: date) -> int:
    today = date.today()
    months = (today.year - first_payment_date.year) * 12 + (today.month - first_payment_date.month)
    return max(1, months + 1)


def _compute_breakdown(loan: MortgageLoan, cuota_numero: int) -> tuple[Decimal | None, Decimal | None]:
    """Compute capital/interest UVA split for Sistema Francés if TNA and original capital available."""
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
    # Auto-create "Hipoteca" expense category if it doesn't exist
    await _get_or_create_hipoteca_category(user.tenant_id, user.id, db)
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
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    loan = await db.get(MortgageLoan, loan_id)
    if not loan or loan.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")
    loan.is_active = False
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

    # Latest UVA value
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

    # Check if current month already paid
    month_start = date(today.year, today.month, 1)
    month_end = date(today.year, today.month + 1, 1) if today.month < 12 else date(today.year + 1, 1, 1)
    paid_record = await db.scalar(
        select(MortgageRecord).where(
            MortgageRecord.mortgage_loan_id == loan_id,
            MortgageRecord.period_date >= month_start,
            MortgageRecord.period_date < month_end,
        )
    )

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
    )


# ── Pay (register this month's cuota as expense) ──────────────────────────────

@router.post("/loans/{loan_id}/pay", response_model=MortgageRecordOut, status_code=201)
async def pay_cuota(
    loan_id: int,
    amount_pesos: Decimal | None = None,  # required for tasa_variable
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    loan = await db.get(MortgageLoan, loan_id)
    if not loan or loan.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Préstamo no encontrado")

    today = date.today()
    month_start = date(today.year, today.month, 1)
    month_end = date(today.year, today.month + 1, 1) if today.month < 12 else date(today.year + 1, 1, 1)

    # Prevent double-registration
    existing = await db.scalar(
        select(MortgageRecord).where(
            MortgageRecord.mortgage_loan_id == loan_id,
            MortgageRecord.period_date >= month_start,
            MortgageRecord.period_date < month_end,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe un pago registrado para este mes")

    # Calculate amount
    macro = await db.scalar(
        select(MacroVariable)
        .where(MacroVariable.uva_value.is_not(None))
        .order_by(MacroVariable.period_date.desc())
        .limit(1)
    )

    payment_amount: Decimal
    uva_units: Decimal | None = None
    capital: Decimal | None = None
    interest: Decimal | None = None

    if loan.loan_type in UVA_LOAN_TYPES:
        if not loan.cuota_uva:
            raise HTTPException(status_code=422, detail="Préstamo sin cuota UVA configurada")
        if not macro or not macro.uva_value:
            raise HTTPException(status_code=422, detail="No hay valor UVA disponible para calcular la cuota")
        uva_units = loan.cuota_uva
        payment_amount = loan.cuota_uva * macro.uva_value

        # Capital/interest breakdown if TNA and original capital available
        cuota_numero = _compute_cuota_numero(loan.first_payment_date)
        cap_uva, int_uva = _compute_breakdown(loan, cuota_numero)
        if cap_uva is not None and macro.uva_value:
            capital = cap_uva * macro.uva_value
            interest = int_uva * macro.uva_value

    elif loan.loan_type == "tasa_fija":
        if not loan.cuota_pesos:
            raise HTTPException(status_code=422, detail="Préstamo sin cuota en pesos configurada")
        payment_amount = loan.cuota_pesos

    elif loan.loan_type == "tasa_variable":
        if amount_pesos is None:
            raise HTTPException(status_code=422, detail="Debe indicar el monto de la cuota (tasa variable)")
        payment_amount = amount_pesos

    else:
        raise HTTPException(status_code=422, detail="Tipo de préstamo desconocido")

    # Create expense entry
    cat = await _get_or_create_hipoteca_category(user.tenant_id, user.id, db)
    expense = ExpenseEntry(
        tenant_id=user.tenant_id,
        user_id=user.id,
        category_id=cat.id,
        amount=payment_amount,
        description=f"Cuota hipotecaria{' ' + loan.description if loan.description else ''}",
        expense_date=month_start,
        notes=f"{uva_units} UVAs" if uva_units else None,
    )
    db.add(expense)
    await db.flush()

    # Create mortgage record (detailed breakdown)
    record = MortgageRecord(
        tenant_id=user.tenant_id,
        mortgage_loan_id=loan_id,
        expense_entry_id=expense.id,
        period_date=month_start,
        payment_amount=payment_amount,
        capital=capital,
        interest=interest,
        uva_units=uva_units,
    )
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


# ── Legacy endpoints (manual entry, kept for backward compatibility) ───────────

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


@router.put("", response_model=MortgageRecordOut)
async def upsert_record(
    body: MortgageRecordCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    existing = await db.scalar(
        select(MortgageRecord).where(
            MortgageRecord.tenant_id == user.tenant_id,
            MortgageRecord.period_date == body.period_date,
        )
    )
    if existing:
        for field, value in body.model_dump(exclude={"period_date"}).items():
            if value is not None:
                setattr(existing, field, value)
        await db.commit()
        await db.refresh(existing)
        return existing
    record = MortgageRecord(**body.model_dump(), tenant_id=user.tenant_id)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record


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
    # Also delete linked expense entry if auto-generated
    if record.expense_entry_id:
        expense = await db.get(ExpenseEntry, record.expense_entry_id)
        if expense:
            await db.delete(expense)
    await db.delete(record)
    await db.commit()
