from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, get_owner_user
from app.core.database import get_db
from app.schemas.business import PayeeCreate, PayeeOut, PayeeUpdate
from app.services.business import payees as payees_service

# Proveedores y empleados: sólo dueño y socios. Un empleado carga ventas y
# stock, no ve a quién se le paga ni cuánto.
router = APIRouter(prefix="/payees", tags=["negocio"])


@router.get("", response_model=list[PayeeOut])
async def list_payees(
    include_inactive: bool = False,
    actor: Actor = Depends(get_owner_user),
    db: AsyncSession = Depends(get_db),
):
    return await payees_service.list_payees(
        db, actor.user.tenant_id, include_inactive=include_inactive
    )


@router.post("", response_model=PayeeOut, status_code=status.HTTP_201_CREATED)
async def create_payee(
    body: PayeeCreate,
    actor: Actor = Depends(get_owner_user),
    db: AsyncSession = Depends(get_db),
):
    payee = await payees_service.create_payee(db, actor.user.tenant_id, **body.model_dump())
    await db.commit()
    return payee


@router.patch("/{payee_id}", response_model=PayeeOut)
async def update_payee(
    payee_id: int,
    body: PayeeUpdate,
    actor: Actor = Depends(get_owner_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = actor.user.tenant_id
    payee = await payees_service.assert_owns_payee(db, tenant_id, payee_id)
    await payees_service.update_payee(db, payee, tenant_id, body.model_dump(exclude_unset=True))
    await db.commit()
    return payee
