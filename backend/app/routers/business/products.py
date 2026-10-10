from fastapi import APIRouter, Depends, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, get_owner_user, get_staff_user
from app.core.database import get_db
from app.schemas.business import ProductCreate, ProductOut, ProductUpdate
from app.services.business import products as products_service

# El catálogo lo ve cualquiera del negocio (hace falta para cargar una venta);
# lo arman y lo cambian el dueño y los socios.
router = APIRouter(prefix="/products", tags=["negocio"])


@router.get("", response_model=list[ProductOut])
async def list_products(
    include_inactive: bool = False,
    actor: Actor = Depends(get_staff_user),
    db: AsyncSession = Depends(get_db),
):
    return await products_service.list_products(db, actor.user.tenant_id, include_inactive=include_inactive)


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
async def create_product(
    body: ProductCreate,
    actor: Actor = Depends(get_owner_user),
    db: AsyncSession = Depends(get_db),
):
    product = await products_service.create_product(db, actor.user.tenant_id, **body.model_dump())
    await db.commit()
    return product


@router.patch("/{product_id}", response_model=ProductOut)
async def update_product(
    product_id: int,
    body: ProductUpdate,
    actor: Actor = Depends(get_owner_user),
    db: AsyncSession = Depends(get_db),
):
    tenant_id = actor.user.tenant_id
    product = await products_service.assert_owns_product(db, tenant_id, product_id)
    await products_service.update_product(db, product, tenant_id, body.model_dump(exclude_unset=True))
    await db.commit()
    return product
