import logging
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db, AsyncSessionLocal
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.services import credits
from app.schemas.mortgage import (
    MortgageLoanCreate, MortgageLoanUpdate, MortgageLoanOut,
    MortgageSummary, MortgageRecordOut,
)

router = APIRouter(prefix="/mortgage", tags=["mortgage"])
logger = logging.getLogger(__name__)

# La pantalla de Hipoteca de producción. Créditos (`routers/credits.py`) es la
# nueva; las dos escriben en las mismas tablas por `services/credits.py`. Ésta
# sólo ve los hipotecarios: un préstamo personal cargado en Créditos no tiene
# que aparecer acá como si fuera la hipoteca.
HIPOTECARIO = MortgageLoan.kind == "hipotecario"


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


async def _sync_loan_cuotas(loan: MortgageLoan, user_id: int, db: AsyncSession) -> int:
    return await credits.sync_loan(db, loan, user_id)


async def sync_all_active_loans():
    """Cron entry point: auto-register due cuotas for all active loans."""
    async with AsyncSessionLocal() as db:
        try:
            loans = (await db.scalars(
                select(MortgageLoan).where(MortgageLoan.is_active == True)  # noqa: E712
            )).all()
            total = 0
            for loan in loans:
                user = await db.scalar(
                    select(User).where(User.tenant_id == loan.tenant_id).limit(1)
                )
                if user:
                    total += await credits.sync_loan(db, loan, user.id)
            await db.commit()
            if total:
                logger.info(f"Credit auto-sync: registered {total} cuotas")
        except Exception as e:
            logger.error(f"Credit auto-sync failed: {e}")
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
        .where(MortgageLoan.tenant_id == user.tenant_id, HIPOTECARIO)
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
    loan = MortgageLoan(
        **body.model_dump(), **credits.from_legacy_type(body.loan_type),
        kind="hipotecario", currency="ARS", tenant_id=user.tenant_id,
    )
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

    await credits.delete_loan(db, loan, keep_history)
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

    s = await credits.summarize(db, loan)
    # La pantalla vieja muestra "Cuota N de M" con N = la de este mes.
    cuota_numero = s.cuota_numero if not s.paid_this_month else max(1, s.cuota_numero - 1)
    if s.finished:
        cuota_numero = loan.total_cuotas
    row = credits.schedule_row(loan, cuota_numero)
    cuota_uva = row.cuota if row and loan.adjustment == "uva" else loan.cuota_uva
    cuota_pesos_calculado = None
    if row:
        cuota_pesos_calculado = row.cuota * s.uva_value if loan.adjustment == "uva" and s.uva_value else (
            row.cuota if loan.adjustment != "uva" else None
        )
    return MortgageSummary(
        loan=MortgageLoanOut.model_validate(loan),
        cuota_numero=cuota_numero,
        cuotas_restantes=max(0, loan.total_cuotas - cuota_numero + 1),
        pct_completado=round((cuota_numero - 1) / loan.total_cuotas * 100, 1),
        cuota_uva=cuota_uva,
        latest_uva_value=s.uva_value,
        latest_uva_date=s.uva_date,
        cuota_pesos_calculado=cuota_pesos_calculado,
        paid_this_month=s.paid_this_month,
        mortgage_record_id=s.this_month_record_id,
        next_payment_date=s.next_payment_date or credits.payment_date(
            *credits.cuota_month(loan, loan.total_cuotas), loan.payment_day),
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
        .outerjoin(MortgageLoan, MortgageLoan.id == MortgageRecord.mortgage_loan_id)
        .where(
            MortgageRecord.tenant_id == user.tenant_id,
            # Las sueltas (de un crédito borrado con su historial) eran de la hipoteca.
            (MortgageRecord.mortgage_loan_id.is_(None)) | HIPOTECARIO,
        )
        .order_by(MortgageRecord.period_date.desc())
    )
    return result.all()
