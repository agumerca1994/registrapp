from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, assert_staff_day, get_owner_user, get_staff_user
from app.core.database import get_db
from app.schemas.business import CloseIn, DayBrief, DaySummary, SaleIn, SaleOut
from app.services import analytics
from app.services.business import sales as sales_service

# Cargar y corregir ventas y cerrar el día es de cualquiera del negocio (el
# mostrador); la lista de días con sus totales, del dueño y los socios.
router = APIRouter(prefix="/sales", tags=["negocio"])


@router.post("", response_model=SaleOut, status_code=status.HTTP_201_CREATED)
async def create_sale(
    body: SaleIn,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    assert_staff_day(actor, body.sale_date)
    sale, _created = await sales_service.create_ticket(
        db, tenant_id=actor.user.tenant_id, user_id=actor.user.id, sale_date=body.sale_date,
        lines=body.lines, payments=body.payments, notes=body.notes, client_ref=body.client_ref,
    )
    await db.commit()
    return sale


@router.patch("/{sale_id}", response_model=SaleOut)
async def update_sale(
    sale_id: int,
    body: SaleIn,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    sale = await sales_service.get_ticket(db, actor.user.tenant_id, sale_id)
    assert_staff_day(actor, sale.sale_date)
    assert_staff_day(actor, body.sale_date)
    await sales_service.update_ticket(
        db, sale, user_id=actor.user.id, sale_date=body.sale_date,
        lines=body.lines, payments=body.payments, notes=body.notes,
    )
    await db.commit()
    return sale


@router.delete("/{sale_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_sale(
    sale_id: int,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    sale = await sales_service.get_ticket(db, actor.user.tenant_id, sale_id)
    assert_staff_day(actor, sale.sale_date)
    await sales_service.delete_ticket(db, sale, user_id=actor.user.id)
    await db.commit()


@router.get("/day/{day}", response_model=DaySummary)
async def day_summary(
    day: date,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    assert_staff_day(actor, day)
    return await sales_service.day_summary(db, actor.user.tenant_id, day)


@router.put("/close/{day}", response_model=DaySummary)
async def close_day(
    day: date,
    body: CloseIn,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    assert_staff_day(actor, day)
    tenant_id = actor.user.tenant_id
    await sales_service.upsert_close(
        db, tenant_id=tenant_id, user_id=actor.user.id, day=day, counted=body.counted,
        units=body.units, notes=body.notes,
    )
    await db.commit()
    return await sales_service.day_summary(db, tenant_id, day)


@router.delete("/close/{day}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_close(
    day: date,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    assert_staff_day(actor, day)
    await sales_service.delete_close(db, tenant_id=actor.user.tenant_id, user_id=actor.user.id, day=day)
    await db.commit()


@router.get("/days", response_model=list[DayBrief])
async def list_days(
    year: int = Query(..., ge=2000, le=2100),
    month: int = Query(..., ge=1, le=12),
    actor: Actor = Depends(get_owner_user),
    db: AsyncSession = Depends(get_db),
):
    start, end = analytics.month_bounds(year, month)
    return await sales_service.days_between(db, actor.user.tenant_id, start, end)
