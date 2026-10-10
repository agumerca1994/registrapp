"""Los productos que vende un negocio. **Sin commit.**

Un producto no se borra: se archiva (`is_active=false`). Las ventas viejas lo
siguen nombrando (`sale_lines.product_id` es RESTRICT).
"""
from __future__ import annotations

from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import PRODUCT_KIND_RESALE, PRODUCT_KINDS, PRODUCT_UNITS, Product
from app.services.business.common import match_by_name, name_and_key


def _check(kind: str | None = None, unit: str | None = None, price: Decimal | None = None,
           min_stock: Decimal | None = None) -> None:
    if kind is not None and kind not in PRODUCT_KINDS:
        raise HTTPException(status_code=422, detail=f"kind debe ser uno de {PRODUCT_KINDS}")
    if unit is not None and unit not in PRODUCT_UNITS:
        raise HTTPException(status_code=422, detail=f"unit debe ser uno de {PRODUCT_UNITS}")
    if price is not None and price < 0:
        raise HTTPException(status_code=422, detail="El precio no puede ser negativo")
    if min_stock is not None and min_stock < 0:
        raise HTTPException(status_code=422, detail="El stock mínimo no puede ser negativo")


async def assert_owns_product(db: AsyncSession, tenant_id: int, product_id: int) -> Product:
    product = await db.get(Product, product_id)
    if product is None or product.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Producto no encontrado")
    return product


async def _assert_name_free(db: AsyncSession, tenant_id: int, key: str, exclude_id: int | None = None) -> None:
    q = select(Product.id).where(Product.tenant_id == tenant_id, Product.name_key == key)
    if exclude_id is not None:
        q = q.where(Product.id != exclude_id)
    if await db.scalar(q) is not None:
        raise HTTPException(status_code=409, detail="Ya hay un producto con ese nombre")


async def list_products(db: AsyncSession, tenant_id: int, *, include_inactive: bool = False) -> list[Product]:
    q = select(Product).where(Product.tenant_id == tenant_id)
    if not include_inactive:
        q = q.where(Product.is_active.is_(True))
    return list((await db.scalars(q.order_by(Product.name_key))).all())


async def create_product(
    db: AsyncSession,
    tenant_id: int,
    *,
    name: str,
    kind: str = "elaborado",
    unit: str = "unidad",
    sale_price: Decimal | None = None,
    track_stock: bool | None = None,
    min_stock: Decimal | None = None,
) -> Product:
    name, key = name_and_key(name)
    _check(kind, unit, sale_price, min_stock)
    await _assert_name_free(db, tenant_id, key)
    product = Product(
        tenant_id=tenant_id, name=name, name_key=key, kind=kind, unit=unit,
        sale_price=sale_price, min_stock=min_stock,
        # Lo de reventa entra con la compra y sale con la venta: lleva stock.
        # Lo elaborado depende de si el negocio quiere contar su producción.
        track_stock=(kind == PRODUCT_KIND_RESALE) if track_stock is None else track_stock,
    )
    db.add(product)
    await db.flush()
    return product


async def update_product(db: AsyncSession, product: Product, tenant_id: int, updates: dict) -> Product:
    """Aplica sólo las claves presentes (un `None` explícito en el precio o el
    stock mínimo los borra)."""
    if "name" in updates:
        name, key = name_and_key(updates["name"])
        await _assert_name_free(db, tenant_id, key, exclude_id=product.id)
        product.name, product.name_key = name, key
    _check(updates.get("kind"), updates.get("unit"), updates.get("sale_price"), updates.get("min_stock"))
    for field in ("kind", "unit", "sale_price", "track_stock", "min_stock", "is_active"):
        if field in updates and not (field in ("kind", "unit", "track_stock", "is_active") and updates[field] is None):
            setattr(product, field, updates[field])
    await db.flush()
    return product


async def resolve_product(db: AsyncSession, tenant_id: int, term: str) -> list[Product]:
    """De lo que escribe una persona ("coca", "empanada") a los productos
    activos que pueden ser. Vacío o varios = preguntar."""
    return match_by_name(await list_products(db, tenant_id), term)
