from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.tenant import Tenant
from app.models.expense import ExpenseEntry
from app.models.currency_operation import CurrencyOperation
from app.schemas.currency_operation import (
    CurrencyOperationCreate, CurrencyOperationUpdate, CurrencyOperationOut,
    CurrencySummaryOut, CurrencySettingsOut, CurrencySettingsUpdate,
)
from app.services.currency import (
    ZERO, with_statement, cash_out_date, get_latest_rate,
    get_tenant_rate_type, get_usd_holding,
)

router = APIRouter(prefix="/currency", tags=["currency"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


def _month_bounds(year: int, month: int) -> tuple[date, date]:
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="Mes inválido")
    start = date(year, month, 1)
    end = date(year, month + 1, 1) if month < 12 else date(year + 1, 1, 1)
    return start, end


# ── Settings ──────────────────────────────────────────────────────────────────
# Kept on this router rather than folded into UserOut: that schema reaches the
# tenant through a lazy relationship, and every endpoint returning it would need
# a selectinload(User.tenant) to avoid MissingGreenlet.

@router.get("/settings", response_model=CurrencySettingsOut)
async def get_settings(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    rate_type = await get_tenant_rate_type(db, user.tenant_id)
    return CurrencySettingsOut(
        fx_rate_type=rate_type,
        rate=await get_latest_rate(db, rate_type),
    )


@router.patch("/settings", response_model=CurrencySettingsOut)
async def update_settings(
    body: CurrencySettingsUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    tenant = await db.get(Tenant, user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Hogar no encontrado")
    tenant.fx_rate_type = body.fx_rate_type
    await db.commit()
    return CurrencySettingsOut(
        fx_rate_type=body.fx_rate_type,
        rate=await get_latest_rate(db, body.fx_rate_type),
    )


# ── Operations CRUD ───────────────────────────────────────────────────────────

@router.get("/operations", response_model=list[CurrencyOperationOut])
async def list_operations(
    year: int | None = None,
    month: int | None = None,
    currency: str = "USD",
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    q = select(CurrencyOperation).where(
        CurrencyOperation.tenant_id == user.tenant_id,
        CurrencyOperation.currency == currency,
    )
    if year is not None and month is not None:
        start, end = _month_bounds(year, month)
        # The declared starting balance is the anchor of the whole holding, so it
        # stays visible in every month rather than hiding in whichever month it
        # happens to be dated.
        q = q.where(
            (CurrencyOperation.op_type == "initial")
            | (
                (CurrencyOperation.operation_date >= start)
                & (CurrencyOperation.operation_date < end)
            )
        )
    result = await db.scalars(q.order_by(CurrencyOperation.operation_date.desc(), CurrencyOperation.id.desc()))
    return result.all()


@router.post("/operations", response_model=CurrencyOperationOut, status_code=status.HTTP_201_CREATED)
async def create_operation(
    body: CurrencyOperationCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    if body.op_type == "initial":
        existing = await db.scalar(
            select(CurrencyOperation.id).where(
                CurrencyOperation.tenant_id == user.tenant_id,
                CurrencyOperation.currency == body.currency,
                CurrencyOperation.op_type == "initial",
            )
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe una tenencia inicial para esta moneda. Editala o usá un ajuste.",
            )

    op = CurrencyOperation(
        tenant_id=user.tenant_id,
        user_id=user.id,
        **body.model_dump(),
    )
    db.add(op)
    await db.commit()
    await db.refresh(op)
    return op


@router.patch("/operations/{op_id}", response_model=CurrencyOperationOut)
async def update_operation(
    op_id: int,
    body: CurrencyOperationUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    op = await db.scalar(
        select(CurrencyOperation).where(
            CurrencyOperation.id == op_id,
            CurrencyOperation.tenant_id == user.tenant_id,
        )
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operación no encontrada")

    # Changing an existing row into a second starting balance would break the
    # unique index at flush time — reject it with a readable message instead.
    if body.op_type == "initial" and op.op_type != "initial":
        existing = await db.scalar(
            select(CurrencyOperation.id).where(
                CurrencyOperation.tenant_id == user.tenant_id,
                CurrencyOperation.currency == op.currency,
                CurrencyOperation.op_type == "initial",
            )
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Ya existe una tenencia inicial para esta moneda.",
            )

    for field, value in body.model_dump().items():
        setattr(op, field, value)
    await db.commit()
    await db.refresh(op)
    return op


@router.delete("/operations/{op_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_operation(
    op_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    op = await db.scalar(
        select(CurrencyOperation).where(
            CurrencyOperation.id == op_id,
            CurrencyOperation.tenant_id == user.tenant_id,
        )
    )
    if not op:
        raise HTTPException(status_code=404, detail="Operación no encontrada")
    await db.delete(op)
    await db.commit()


# ── Summary ───────────────────────────────────────────────────────────────────

@router.get("/summary/{year}/{month}", response_model=CurrencySummaryOut)
async def currency_summary(
    year: int,
    month: int,
    currency: str = "USD",
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    tid = user.tenant_id
    start, end = _month_bounds(year, month)

    # Stock at both ends of the month. `end - 1 day` because get_usd_holding's
    # `as_of` is inclusive.
    closing = await get_usd_holding(db, tid, as_of=end - timedelta(days=1), currency=currency)
    opening = await get_usd_holding(db, tid, as_of=start - timedelta(days=1), currency=currency)

    # Flow inside the month.
    async def _op_sum(op_type: str) -> Decimal:
        return await db.scalar(
            select(func.coalesce(func.sum(CurrencyOperation.foreign_amount), ZERO)).where(
                CurrencyOperation.tenant_id == tid,
                CurrencyOperation.currency == currency,
                CurrencyOperation.op_type == op_type,
                CurrencyOperation.operation_date >= start,
                CurrencyOperation.operation_date < end,
            )
        )

    async def _ars_sum(op_type: str) -> Decimal:
        return await db.scalar(
            select(func.coalesce(func.sum(CurrencyOperation.ars_amount), ZERO)).where(
                CurrencyOperation.tenant_id == tid,
                CurrencyOperation.currency == currency,
                CurrencyOperation.op_type == op_type,
                CurrencyOperation.operation_date >= start,
                CurrencyOperation.operation_date < end,
            )
        )

    bought_usd = await _op_sum("buy")
    sold_usd = await _op_sum("sell")
    adjustments_usd = await _op_sum("adjustment")
    bought_ars = await _ars_sum("buy")
    sold_ars = await _ars_sum("sell")

    # Dollars that left during the month — by statement due date for card
    # purchases, so July's card spending lands in the month it's actually paid.
    cash_out = cash_out_date()
    spent_q = with_statement(select(func.coalesce(func.sum(ExpenseEntry.amount), ZERO))).where(
        ExpenseEntry.tenant_id == tid,
        ExpenseEntry.currency == currency,
        cash_out >= start,
        cash_out < end,
    )
    if closing.start_date is not None:
        spent_q = spent_q.where(cash_out >= closing.start_date)
    spent_usd = await db.scalar(spent_q)

    rate_type = await get_tenant_rate_type(db, tid)
    rate = await get_latest_rate(db, rate_type)
    valuation = (closing.holding * rate).quantize(Decimal("0.01")) if rate is not None else None

    return CurrencySummaryOut(
        currency=currency,
        period=f"{year}-{month:02d}",
        holding=closing.holding,
        holding_start=opening.holding,
        initial=closing.initial,
        start_date=closing.start_date,
        total_bought=closing.bought,
        total_sold=closing.sold,
        total_spent=closing.spent,
        total_adjustments=closing.adjustments,
        total_earned=closing.earned,
        pending_usd=closing.pending,
        pending_own_usd=closing.pending_own,
        pending_others_usd=closing.pending - closing.pending_own,
        next_due_date=closing.next_due_date,
        bought_usd=bought_usd,
        bought_ars=bought_ars,
        sold_usd=-sold_usd,
        sold_ars=sold_ars,
        spent_usd=spent_usd,
        adjustments_usd=adjustments_usd,
        net_usd=bought_usd + sold_usd + adjustments_usd - spent_usd,
        rate=rate,
        rate_type=rate_type,
        valuation_ars=valuation,
    )
