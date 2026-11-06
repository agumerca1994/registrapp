"""Créditos: la pantalla nueva. La lógica es `services/credits.py`; `/mortgage`
queda para la pantalla de Hipoteca que todavía usa producción."""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import case, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, get_actor
from app.core.database import get_db
from app.models.expense import ExpenseEntry
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.schemas.credit import (
    CreditCreate, CreditDetail, CreditOut, CreditPaymentCreate, CreditPaymentOut,
    CreditPreview, CreditUpdate,
)
from app.services import credits

router = APIRouter(prefix="/credits", tags=["credits"])


async def _actor(actor: Actor | None = Depends(get_actor)) -> Actor:
    if actor is None:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return actor


async def _own_loan(db: AsyncSession, loan_id: int, tenant_id: int) -> MortgageLoan:
    loan = await db.get(MortgageLoan, loan_id)
    if not loan or loan.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Crédito no encontrado")
    return loan


def _out(s: credits.Summary) -> CreditOut:
    loan = s.loan
    return CreditOut(
        id=loan.id, kind=loan.kind, kind_label=s.kind_label, title=s.title,
        adjustment=loan.adjustment, amortization=loan.amortization, method=loan.method,
        currency=loan.currency, description=loan.description, loan_number=loan.loan_number,
        total_cuotas=loan.total_cuotas, first_payment_date=loan.first_payment_date,
        payment_day=loan.payment_day, cuota_uva=loan.cuota_uva, cuota_pesos=loan.cuota_pesos,
        tna=loan.tna, original_capital_uva=loan.original_capital_uva, capital=loan.capital,
        plan_status=loan.plan_status, is_active=loan.is_active, created_at=loan.created_at,
        cuota_numero=s.cuota_numero, cuotas_pagadas=s.cuotas_pagadas,
        cuotas_restantes=s.cuotas_restantes, pct_completado=s.pct_completado,
        finished=s.finished, paid_this_month=s.paid_this_month,
        next_payment_date=s.next_payment_date, next_amount=s.next_amount,
        next_units=s.next_units, next_is_estimated=s.next_is_estimated,
        balance=s.balance, balance_units=s.balance_units, total_paid=s.total_paid, this_month_paid=s.this_month_paid,
        uva_value=s.uva_value, uva_date=s.uva_date,
    )


async def _build(db: AsyncSession, body: CreditCreate, tenant_id: int) -> MortgageLoan:
    """El crédito sin guardar. Pasa el capital en pesos a UVA si hace falta."""
    data = body.model_dump(exclude={"disbursement_date"})
    if (
        body.adjustment == "uva" and body.method == "formula"
        and not body.original_capital_uva and body.capital and body.disbursement_date
    ):
        uva, _ = await credits.uva_at(db, body.disbursement_date)
        if not uva:
            raise HTTPException(
                status_code=400,
                detail="No tengo el valor de la UVA de ese día. Cargá el capital en UVA, que figura en el contrato.",
            )
        data["original_capital_uva"] = (body.capital / uva).quantize(Decimal("0.000001"))
    data["loan_type"] = credits.legacy_loan_type(body.adjustment, body.amortization, body.method)
    return MortgageLoan(**data, tenant_id=tenant_id, is_active=True)


@router.get("", response_model=list[CreditOut])
async def list_credits(actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    loans = (await db.scalars(
        select(MortgageLoan)
        .where(MortgageLoan.tenant_id == actor.user.tenant_id)
        .order_by(case((MortgageLoan.is_active == True, 0), else_=1), MortgageLoan.created_at.desc())  # noqa: E712
    )).all()
    return [_out(await credits.summarize(db, loan)) for loan in loans]


@router.post("/preview", response_model=CreditPreview)
async def preview_credit(body: CreditCreate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    loan = await _build(db, body, actor.user.tenant_id)
    first_day = credits.payment_date(*credits.cuota_month(loan, 1), loan.payment_day)
    last_day = credits.payment_date(*credits.cuota_month(loan, loan.total_cuotas), loan.payment_day)
    first = await credits.cuota_amount(db, loan, 1, first_day)
    last = await credits.cuota_amount(db, loan, loan.total_cuotas, last_day)
    rows = [credits.schedule_row(loan, n) for n in range(1, loan.total_cuotas + 1)]
    total = sum((r.cuota for r in rows if r), Decimal(0)) if all(rows) else None
    return CreditPreview(
        first_amount=first.amount if first else None,
        first_units=first.units if first else None,
        last_amount=last.amount if last else None,
        last_units=last.units if last else None,
        total_units=total,
        original_capital_uva=loan.original_capital_uva,
        estimated=bool(first and first.estimated),
    )


@router.post("", response_model=CreditOut, status_code=201)
async def create_credit(body: CreditCreate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    loan = await _build(db, body, actor.user.tenant_id)
    db.add(loan)
    await db.flush()
    await credits.sync_loan(db, loan, actor.user.id)
    await db.commit()
    await db.refresh(loan)
    return _out(await credits.summarize(db, loan))


@router.get("/{loan_id}", response_model=CreditDetail)
async def get_credit(loan_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    loan = await _own_loan(db, loan_id, actor.user.tenant_id)
    rows = (await db.execute(
        select(MortgageRecord, ExpenseEntry.expense_date)
        .outerjoin(ExpenseEntry, ExpenseEntry.id == MortgageRecord.expense_entry_id)
        .where(MortgageRecord.mortgage_loan_id == loan.id)
        .order_by(MortgageRecord.period_date.desc())
    )).all()
    payments = []
    for record, paid_on in rows:
        out = CreditPaymentOut.model_validate(record)
        out.paid_on = paid_on
        if out.cuota_number is None:  # las registradas antes de guardar el número
            out.cuota_number = credits.cuota_number_for(loan, record.period_date.year, record.period_date.month)
        payments.append(out)
    return CreditDetail(credit=_out(await credits.summarize(db, loan)), payments=payments)


@router.patch("/{loan_id}", response_model=CreditOut)
async def update_credit(
    loan_id: int, body: CreditUpdate,
    actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    loan = await _own_loan(db, loan_id, actor.user.tenant_id)
    for field, value in body.model_dump(exclude_unset=True).items():
        if field == "is_active" and value is None:
            continue
        setattr(loan, field, value)
    if loan.method == "cuota" and not credits.known_cuota(loan):
        raise HTTPException(status_code=400, detail="La cuota no puede quedar vacía.")
    if loan.method == "formula" and not credits.principal_units(loan):
        raise HTTPException(status_code=400, detail="El capital no puede quedar vacío.")
    await db.flush()
    await credits.sync_loan(db, loan, actor.user.id)
    await db.commit()
    await db.refresh(loan)
    return _out(await credits.summarize(db, loan))


@router.delete("/{loan_id}", status_code=204)
async def delete_credit(
    loan_id: int, keep_history: bool = Query(default=True),
    actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    loan = await _own_loan(db, loan_id, actor.user.tenant_id)
    await credits.delete_loan(db, loan, keep_history)
    await db.commit()


@router.post("/{loan_id}/payments", response_model=CreditPaymentOut, status_code=201)
async def add_payment(
    loan_id: int, body: CreditPaymentCreate,
    actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    loan = await _own_loan(db, loan_id, actor.user.tenant_id)
    period = date(body.paid_on.year, body.paid_on.month, 1)
    taken = await db.scalar(
        select(MortgageRecord.id).where(
            MortgageRecord.mortgage_loan_id == loan.id, MortgageRecord.period_date == period,
        )
    )
    if taken:
        raise HTTPException(status_code=409, detail="Ya hay una cuota registrada en ese mes.")
    number = body.cuota_number or credits.cuota_number_for(loan, period.year, period.month)
    if not 1 <= number <= loan.total_cuotas:
        raise HTTPException(status_code=400, detail=f"Ese mes no tiene cuota: el crédito va de la 1 a la {loan.total_cuotas}.")
    record = await credits.record_payment(
        db, loan, actor.user.id, period=period, pay_day=body.paid_on,
        amount=body.amount, number=number, manual=True,
    )
    await db.commit()
    out = CreditPaymentOut.model_validate(record)
    out.paid_on = body.paid_on
    return out


@router.delete("/payments/{record_id}", status_code=204)
async def delete_payment(record_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    record = await db.get(MortgageRecord, record_id)
    if not record or record.tenant_id != actor.user.tenant_id:
        raise HTTPException(status_code=404, detail="Cuota no encontrada")
    await credits.delete_manual_payment(db, record)
    await db.commit()
