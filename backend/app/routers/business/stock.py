from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, assert_staff_day, get_staff_user
from app.core.database import get_db
from app.schemas.business import (
    StockCountsIn, StockLevelOut, StockMovementIn, StockMovementOut,
)
from app.services.business import sales as sales_service
from app.services.business import stock as stock_service

# El stock lo lleva cualquiera del negocio: producción, conteos y mermas son
# trabajo del mostrador.
router = APIRouter(prefix="/stock", tags=["negocio"])


@router.get("", response_model=list[StockLevelOut])
async def stock_levels(
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    return await stock_service.stock_levels(db, actor.user.tenant_id)


@router.get("/movements", response_model=list[StockMovementOut])
async def list_movements(
    product_id: int | None = None,
    limit: int = Query(50, ge=1, le=200),
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    moves = await stock_service.movements(db, actor.user.tenant_id, product_id, limit)
    if actor.is_employee:
        # Un empleado ve las cantidades, no lo que costó la mercadería.
        return [StockMovementOut.model_validate(m).model_copy(update={"unit_cost": None}) for m in moves]
    return moves


@router.post("/movements", response_model=StockMovementOut, status_code=status.HTTP_201_CREATED)
async def create_movement(
    body: StockMovementIn,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    assert_staff_day(actor, body.movement_date)
    tenant_id = actor.user.tenant_id
    await sales_service.lock_tenant(db, tenant_id)
    movement = await stock_service.record_movement(
        db, tenant_id=tenant_id, user_id=actor.user.id, product_id=body.product_id, kind=body.kind,
        qty=body.qty, movement_date=body.movement_date, notes=body.notes,
        unit_cost=None if actor.is_employee else body.unit_cost,
    )
    await db.commit()
    return movement


@router.post("/counts", response_model=list[StockMovementOut])
async def record_counts(
    body: StockCountsIn,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    """Varios conteos de una vez ("quedan 5 coca, 2 tartas"): un ajuste por
    producto que no coincida con el libro. Los que coinciden no generan nada."""
    assert_staff_day(actor, body.movement_date)
    tenant_id = actor.user.tenant_id
    await sales_service.lock_tenant(db, tenant_id)
    created = []
    for c in body.counts:
        movement = await stock_service.record_count(
            db, tenant_id=tenant_id, user_id=actor.user.id, product_id=c.product_id,
            counted_qty=c.counted_qty, movement_date=body.movement_date,
        )
        if movement is not None:
            created.append(movement)
    await db.commit()
    return created


@router.delete("/movements/{movement_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_movement(
    movement_id: int,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    if actor.is_employee:
        from app.models.business import StockMovement

        movement = await db.get(StockMovement, movement_id)
        if movement is not None and movement.tenant_id == actor.user.tenant_id:
            assert_staff_day(actor, movement.movement_date)
    await stock_service.delete_manual_movement(db, actor.user.tenant_id, movement_id)
    await db.commit()
