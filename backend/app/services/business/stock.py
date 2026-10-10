"""El stock de un negocio. **Sin commit.**

Stock = SUM(qty) de `stock_movements` por producto (el signo va en la cantidad).
De dónde sale cada movimiento:

- **Compra** (`add_purchase_lines`): un gasto simple que dice qué entró
  ("12 Coca-Cola"). Sólo de gastos simples: los espejos de tarjeta se borran
  por varios caminos (cuotas, conciliación) y el stock desaparecería en
  silencio. Una compra con tarjeta carga su ingreso a mano.
- **Venta** (`sync_ticket_movements`): cada línea de un ticket con producto que
  lleva stock resta lo vendido.
- **Cierre** (`sync_close_movements`): las unidades que se contaron al cerrar
  el día, menos lo que ya restaron los tickets de ese día.
- **A mano**: producción ("hice 30 empanadas"), merma, ingreso, y el conteo
  ("quedan 5"), que se guarda como un ajuste por la diferencia.

**Una venta nunca se frena por falta de stock**: el stock puede quedar
negativo, y la pantalla lo marca ("cargá la producción"). Frenar una venta en
el mostrador por un dato mal cargado es peor que el dato mal cargado.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import (
    SALE_KIND_TICKET, STOCK_KIND_ADJUSTMENT, STOCK_KIND_PRODUCTION, STOCK_KIND_PURCHASE,
    STOCK_KIND_SALE, STOCK_KIND_WASTE, Product, Sale, SaleLine, StockMovement,
)
from app.models.expense import ExpenseEntry
from app.services.business.products import assert_owns_product

# Lo que se carga a mano, y con qué signo entra.
MANUAL_KINDS = {STOCK_KIND_PRODUCTION: 1, STOCK_KIND_PURCHASE: 1, STOCK_KIND_WASTE: -1}


async def on_hand(db: AsyncSession, tenant_id: int, product_ids: list[int] | None = None) -> dict[int, Decimal]:
    q = (
        select(StockMovement.product_id, func.coalesce(func.sum(StockMovement.qty), 0))
        .where(StockMovement.tenant_id == tenant_id)
        .group_by(StockMovement.product_id)
    )
    if product_ids is not None:
        q = q.where(StockMovement.product_id.in_(product_ids))
    return {pid: Decimal(total) for pid, total in (await db.execute(q)).all()}


async def _tracked(db: AsyncSession, tenant_id: int, product_id: int) -> Product:
    """El producto, y si todavía no llevaba stock, ahora sí: cargarle un
    movimiento a mano es decir que se quiere contar."""
    product = await assert_owns_product(db, tenant_id, product_id)
    if not product.track_stock:
        product.track_stock = True
    return product


def _positive(qty: Decimal, what: str = "La cantidad") -> Decimal:
    if qty is None or qty <= 0:
        raise HTTPException(status_code=422, detail=f"{what} tiene que ser mayor a cero")
    return qty


async def record_movement(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    product_id: int,
    kind: str,
    qty: Decimal,
    movement_date: date,
    unit_cost: Decimal | None = None,
    notes: str | None = None,
    source: str = "app",
) -> StockMovement:
    """Producción, merma o ingreso a mano. `qty` va en positivo: el tipo decide el signo."""
    if kind not in MANUAL_KINDS:
        raise HTTPException(status_code=422, detail=f"kind debe ser uno de {tuple(MANUAL_KINDS)}")
    _positive(qty)
    if unit_cost is not None and unit_cost < 0:
        raise HTTPException(status_code=422, detail="El costo no puede ser negativo")
    await _tracked(db, tenant_id, product_id)
    movement = StockMovement(
        tenant_id=tenant_id, user_id=user_id, product_id=product_id, kind=kind,
        qty=qty * MANUAL_KINDS[kind], movement_date=movement_date,
        unit_cost=unit_cost if kind == STOCK_KIND_PURCHASE else None,
        notes=(notes or "").strip()[:255] or None, source=source,
    )
    db.add(movement)
    await db.flush()
    return movement


async def record_count(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    product_id: int,
    counted_qty: Decimal,
    movement_date: date,
    source: str = "app",
) -> StockMovement | None:
    """"Quedan 5": un ajuste por la diferencia con lo que dice el libro. Si ya
    coincide no se guarda nada (un ajuste de cero no dice nada)."""
    if counted_qty is None or counted_qty < 0:
        raise HTTPException(status_code=422, detail="Lo contado no puede ser negativo")
    await _tracked(db, tenant_id, product_id)
    current = (await on_hand(db, tenant_id, [product_id])).get(product_id, Decimal(0))
    delta = counted_qty - current
    if delta == 0:
        return None
    movement = StockMovement(
        tenant_id=tenant_id, user_id=user_id, product_id=product_id, kind=STOCK_KIND_ADJUSTMENT,
        qty=delta, counted_qty=counted_qty, movement_date=movement_date, source=source,
    )
    db.add(movement)
    await db.flush()
    return movement


async def delete_manual_movement(db: AsyncSession, tenant_id: int, movement_id: int) -> None:
    movement = await db.get(StockMovement, movement_id)
    if movement is None or movement.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    if movement.expense_entry_id is not None or movement.sale_id is not None:
        raise HTTPException(
            status_code=409,
            detail="Este movimiento sale de una compra o una venta: se corrige desde ahí.",
        )
    await db.delete(movement)
    await db.flush()


# ── Compras ────────────────────────────────────────────────────────────────────

async def add_purchase_lines(
    db: AsyncSession, *, tenant_id: int, user_id: int, entry: ExpenseEntry, lines: list,
) -> list[StockMovement]:
    """Lo que entró con una compra (`lines`: product_id, qty, unit_cost?). Con
    una sola línea y sin costo, el costo unitario es el gasto dividido la
    cantidad: queda guardado para el día que se quiera ver el margen."""
    if entry.payment_method == "tarjeta_credito":
        raise HTTPException(
            status_code=422,
            detail="El stock de una compra con tarjeta se carga a mano en Productos (Ingreso).",
        )
    movements = []
    for line in lines:
        qty = _positive(Decimal(line.qty))
        await _tracked(db, tenant_id, line.product_id)
        unit_cost = line.unit_cost
        if unit_cost is None and len(lines) == 1:
            unit_cost = (Decimal(entry.amount) / qty).quantize(Decimal("0.01"))
        movement = StockMovement(
            tenant_id=tenant_id, user_id=user_id, product_id=line.product_id, kind=STOCK_KIND_PURCHASE,
            qty=qty, unit_cost=unit_cost, movement_date=entry.expense_date, expense_entry_id=entry.id,
        )
        db.add(movement)
        movements.append(movement)
    await db.flush()
    return movements


async def delete_for_expense(db: AsyncSession, expense_entry_id: int) -> None:
    """Explícito y no sólo el CASCADE de la base: el SQLite de los tests no aplica FKs."""
    await db.execute(delete(StockMovement).where(StockMovement.expense_entry_id == expense_entry_id))


# ── Ventas ─────────────────────────────────────────────────────────────────────

async def _tracked_ids(db: AsyncSession, product_ids: set[int]) -> set[int]:
    if not product_ids:
        return set()
    return set((await db.scalars(
        select(Product.id).where(Product.id.in_(product_ids), Product.track_stock.is_(True))
    )).all())


async def delete_for_sale(db: AsyncSession, sale_id: int) -> None:
    await db.execute(delete(StockMovement).where(StockMovement.sale_id == sale_id))


async def sync_ticket_movements(db: AsyncSession, sale: Sale, user_id: int) -> None:
    """Lo que restó una venta: una salida por línea con producto que lleva
    stock. Se rehace entero en cada alta o edición."""
    await delete_for_sale(db, sale.id)
    tracked = await _tracked_ids(db, {ln.product_id for ln in sale.lines if ln.product_id})
    for ln in sale.lines:
        if ln.product_id in tracked:
            db.add(StockMovement(
                tenant_id=sale.tenant_id, user_id=user_id, product_id=ln.product_id, kind=STOCK_KIND_SALE,
                qty=-Decimal(ln.qty), movement_date=sale.sale_date, sale_id=sale.id,
            ))
    await db.flush()


async def sync_close_movements(db: AsyncSession, close: Sale, user_id: int) -> list[str]:
    """Las unidades del cierre (lo que se contó que salió en el día) menos lo
    que ya restaron los tickets de ese día. Si los tickets restaron más de lo
    que dice el cierre, no se suma nada de vuelta: se avisa."""
    await delete_for_sale(db, close.id)
    if not close.lines:
        return []
    ticket_units: dict[int, Decimal] = defaultdict(Decimal)
    rows = (await db.execute(
        select(SaleLine.product_id, func.sum(SaleLine.qty))
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(Sale.tenant_id == close.tenant_id, Sale.sale_date == close.sale_date,
               Sale.kind == SALE_KIND_TICKET, SaleLine.product_id.is_not(None))
        .group_by(SaleLine.product_id)
    )).all()
    for pid, qty in rows:
        ticket_units[pid] = Decimal(qty)
    tracked = await _tracked_ids(db, {ln.product_id for ln in close.lines if ln.product_id})
    warnings: list[str] = []
    for ln in close.lines:
        if ln.product_id not in tracked:
            continue
        remainder = Decimal(ln.qty) - ticket_units.get(ln.product_id, Decimal(0))
        if remainder > 0:
            db.add(StockMovement(
                tenant_id=close.tenant_id, user_id=user_id, product_id=ln.product_id, kind=STOCK_KIND_SALE,
                qty=-remainder, movement_date=close.sale_date, sale_id=close.id,
            ))
        elif remainder < 0:
            product = await db.get(Product, ln.product_id)
            warnings.append(
                f"{product.name}: las ventas cargadas suman más unidades que las del cierre."
            )
    await db.flush()
    return warnings


# ── Lectura ────────────────────────────────────────────────────────────────────

async def stock_levels(db: AsyncSession, tenant_id: int) -> list[dict]:
    """Los productos que llevan stock, con lo que hay y si están en alerta
    (negativo, o en el mínimo o debajo)."""
    products = (await db.scalars(
        select(Product).where(
            Product.tenant_id == tenant_id, Product.is_active.is_(True), Product.track_stock.is_(True),
        ).order_by(Product.name_key)
    )).all()
    levels = await on_hand(db, tenant_id, [p.id for p in products])
    out = []
    for p in products:
        qty = levels.get(p.id, Decimal(0))
        alert = "negativo" if qty < 0 else ("bajo" if p.min_stock is not None and qty <= p.min_stock else None)
        out.append({"product_id": p.id, "name": p.name, "unit": p.unit, "on_hand": qty,
                    "min_stock": p.min_stock, "alert": alert})
    return out


async def movements(db: AsyncSession, tenant_id: int, product_id: int | None = None, limit: int = 50) -> list[StockMovement]:
    q = select(StockMovement).where(StockMovement.tenant_id == tenant_id)
    if product_id is not None:
        q = q.where(StockMovement.product_id == product_id)
    return list((await db.scalars(
        q.order_by(StockMovement.movement_date.desc(), StockMovement.id.desc()).limit(limit)
    )).all())
