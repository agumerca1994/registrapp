"""Las ventas de un negocio: tickets, el cierre del día y el ingreso diario que
las lleva al libro. **Sin commit**: el router confirma una sola vez.

Tres reglas que este módulo hace cumplir, y que nadie más tiene que repetir:

1. **Un día = un ingreso.** Las ventas entran al libro como UN `IncomeEntry`
   por día en la fuente "Ventas" (`system_key="sales"`), sin ítems. Lo arma
   `rebuild_day`, que lo recalcula **desde cero** en cada escritura, nunca
   sumando o restando. Así el resultado del mes, la historia, el dashboard y
   el conector siguen funcionando sin saber que existen las ventas — el mismo
   motivo por el que un consumo con tarjeta se espeja en `ExpenseEntry` — y la
   lista de ingresos queda en ~30 filas por mes. Ese ingreso no se toca a
   mano: `services/income.assert_entry_writable` lo rechaza en el router y en
   el MCP.

2. **El cierre guarda lo CONTADO, no la diferencia.** El total del día es lo
   contado si hay cierre y la suma de los tickets si no. Guardar la diferencia
   (contado − tickets) falla con un ticket olvidado que se carga después del
   cierre con la plata ya contada en la caja: sumaría dos veces. "Sin ticket"
   y "diferencia de caja" se calculan para mostrarse, no se guardan.

3. **Las escrituras de un negocio van en fila** (`lock_tenant`): dos celulares
   cargando a la vez no se pisan el total del día. Es `FOR NO KEY UPDATE`
   sobre la fila del tenant, que no frena los inserts que la referencian.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timezone
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import (
    PAYMENT_METHODS, SALE_KIND_CLOSE, SALE_KIND_TICKET, Sale, SaleLine, SalePayment,
)
from app.models.income import IncomeEntry, IncomeSource, IncomeType
from app.models.tenant import Tenant
from app.schemas.business import DayBrief, DaySummary, MethodLine, SaleLineIn, SaleOut, SalePaymentIn
from app.services.business.products import assert_owns_product
from app.services.income import SALES_SYSTEM_KEY

MAX_LINES = 50
METHOD_LABELS = {
    "efectivo": "efectivo", "debito": "débito", "credito": "crédito",
    "mercadopago": "Mercado Pago", "transferencia": "transferencia", "otro": "otro medio",
}


def _ars(amount: Decimal) -> str:
    return "$ " + f"{amount:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")


def _now() -> datetime:
    # Naive UTC como el resto de las columnas DateTime. Se setea en Python y no
    # con server_default: una columna que la base completa queda expirada tras
    # el flush, y leerla en async es un lazy load (MissingGreenlet).
    return datetime.now(timezone.utc).replace(tzinfo=None)


async def lock_tenant(db: AsyncSession, tenant_id: int) -> None:
    await db.execute(select(Tenant.id).where(Tenant.id == tenant_id).with_for_update(key_share=True))


async def ensure_sales_source(db: AsyncSession, tenant_id: int) -> int:
    """La fuente "Ventas" del negocio, creada la primera vez que hace falta."""
    source_id = await db.scalar(
        select(IncomeSource.id).where(
            IncomeSource.tenant_id == tenant_id, IncomeSource.system_key == SALES_SYSTEM_KEY,
        )
    )
    if source_id is not None:
        return source_id
    source = IncomeSource(
        tenant_id=tenant_id, name="Ventas", income_type=IncomeType.other,
        description="La arma la app con las ventas de cada día.", system_key=SALES_SYSTEM_KEY,
    )
    db.add(source)
    await db.flush()
    return source.id


# ── Validación ─────────────────────────────────────────────────────────────────

def _payments(payments: list[SalePaymentIn], *, what: str) -> tuple[list[SalePayment], Decimal]:
    if not payments:
        raise HTTPException(status_code=422, detail=f"Falta {what}")
    seen: set[str] = set()
    rows: list[SalePayment] = []
    for p in payments:
        if p.method not in PAYMENT_METHODS:
            raise HTTPException(status_code=422, detail=f"Medio de pago desconocido: {p.method}")
        if p.method in seen:
            raise HTTPException(status_code=422, detail=f"«{METHOD_LABELS[p.method]}» aparece dos veces")
        if p.amount <= 0:
            raise HTTPException(status_code=422, detail="Los montos van mayores a cero")
        seen.add(p.method)
        rows.append(SalePayment(method=p.method, amount=p.amount))
    return rows, sum((r.amount for r in rows), Decimal(0))


async def _lines(db: AsyncSession, tenant_id: int, lines: list[SaleLineIn]) -> list[SaleLine]:
    if len(lines) > MAX_LINES:
        raise HTTPException(status_code=422, detail=f"Una venta lleva hasta {MAX_LINES} líneas")
    rows: list[SaleLine] = []
    for i, ln in enumerate(lines):
        description = (ln.description or "").strip()[:120] or None
        if ln.product_id is not None:
            await assert_owns_product(db, tenant_id, ln.product_id)
        elif not description:
            raise HTTPException(status_code=422, detail="Cada línea necesita un producto o una descripción")
        if ln.qty <= 0:
            raise HTTPException(status_code=422, detail="La cantidad tiene que ser mayor a cero")
        if ln.unit_price is not None and ln.unit_price < 0:
            raise HTTPException(status_code=422, detail="El precio no puede ser negativo")
        rows.append(SaleLine(
            product_id=ln.product_id, description=description, qty=ln.qty,
            unit_price=ln.unit_price, position=i,
        ))
    return rows


# ── Tickets ────────────────────────────────────────────────────────────────────

async def get_ticket(db: AsyncSession, tenant_id: int, sale_id: int) -> Sale:
    sale = await db.get(Sale, sale_id)
    if sale is None or sale.tenant_id != tenant_id or sale.kind != SALE_KIND_TICKET:
        raise HTTPException(status_code=404, detail="Venta no encontrada")
    return sale


async def create_ticket(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    sale_date: date,
    lines: list[SaleLineIn],
    payments: list[SalePaymentIn],
    notes: str | None = None,
    client_ref: str | None = None,
    source: str = "app",
) -> tuple[Sale, bool]:
    """Devuelve `(venta, creada)`. Con un `client_ref` ya visto devuelve esa
    misma venta sin crear otra: el reintento de un celular con mala señal."""
    await lock_tenant(db, tenant_id)
    if client_ref:
        existing = await db.scalar(
            select(Sale).where(Sale.tenant_id == tenant_id, Sale.client_ref == client_ref)
        )
        if existing is not None:
            return existing, False
    payment_rows, total = _payments(payments, what="cómo se cobró")
    line_rows = await _lines(db, tenant_id, lines)
    now = _now()
    sale = Sale(
        tenant_id=tenant_id, user_id=user_id, sale_date=sale_date, kind=SALE_KIND_TICKET,
        total=total, source=source, client_ref=client_ref, notes=(notes or "").strip()[:500] or None,
        created_at=now, updated_at=now, lines=line_rows, payments=payment_rows,
    )
    db.add(sale)
    await db.flush()
    await rebuild_day(db, tenant_id, sale_date, user_id)
    return sale, True


async def update_ticket(
    db: AsyncSession,
    sale: Sale,
    *,
    user_id: int,
    sale_date: date,
    lines: list[SaleLineIn],
    payments: list[SalePaymentIn],
    notes: str | None = None,
) -> Sale:
    """Reemplaza la venta entera (líneas y pagos). Si cambia de día, se
    reconstruyen los dos."""
    await lock_tenant(db, sale.tenant_id)
    payment_rows, total = _payments(payments, what="cómo se cobró")
    line_rows = await _lines(db, sale.tenant_id, lines)
    old_date = sale.sale_date
    # Vaciar y flush ANTES de agregar: el flush inserta antes de borrar y los
    # pagos nuevos chocarían con UNIQUE(sale_id, method) de los viejos.
    sale.lines.clear()
    sale.payments.clear()
    await db.flush()
    sale.lines.extend(line_rows)
    sale.payments.extend(payment_rows)
    sale.sale_date = sale_date
    sale.total = total
    sale.notes = (notes or "").strip()[:500] or None
    sale.updated_at = _now()
    await db.flush()
    await rebuild_day(db, sale.tenant_id, sale_date, user_id)
    if old_date != sale_date:
        await rebuild_day(db, sale.tenant_id, old_date, user_id)
    return sale


async def delete_ticket(db: AsyncSession, sale: Sale, *, user_id: int) -> None:
    await lock_tenant(db, sale.tenant_id)
    tenant_id, day = sale.tenant_id, sale.sale_date
    await db.delete(sale)
    await db.flush()
    await rebuild_day(db, tenant_id, day, user_id)


# ── Cierre del día ─────────────────────────────────────────────────────────────

async def get_close(db: AsyncSession, tenant_id: int, day: date) -> Sale | None:
    return await db.scalar(
        select(Sale).where(Sale.tenant_id == tenant_id, Sale.sale_date == day, Sale.kind == SALE_KIND_CLOSE)
    )


async def upsert_close(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    day: date,
    counted: list[SalePaymentIn],
    notes: str | None = None,
) -> Sale:
    """Lo contado al cerrar el día. Un día tiene un solo cierre: volver a
    cerrar lo reemplaza (ej. se siguió vendiendo después del primero)."""
    await lock_tenant(db, tenant_id)
    payment_rows, total = _payments(counted, what="lo contado")
    close = await get_close(db, tenant_id, day)
    now = _now()
    if close is None:
        close = Sale(
            tenant_id=tenant_id, user_id=user_id, sale_date=day, kind=SALE_KIND_CLOSE,
            total=total, source="app", created_at=now, updated_at=now, payments=payment_rows,
        )
        db.add(close)
    else:
        close.payments.clear()
        await db.flush()
        close.payments.extend(payment_rows)
        close.total = total
        close.user_id = user_id
        close.updated_at = now
    close.notes = (notes or "").strip()[:500] or None
    await db.flush()
    await rebuild_day(db, tenant_id, day, user_id)
    return close


async def delete_close(db: AsyncSession, *, tenant_id: int, user_id: int, day: date) -> None:
    await lock_tenant(db, tenant_id)
    close = await get_close(db, tenant_id, day)
    if close is None:
        raise HTTPException(status_code=404, detail="Ese día no tiene cierre")
    await db.delete(close)
    await db.flush()
    await rebuild_day(db, tenant_id, day, user_id)


# ── El libro ───────────────────────────────────────────────────────────────────

def _day_note(tickets: int, closed: bool) -> str:
    parts = []
    if tickets:
        parts.append(f"{tickets} venta{'s' if tickets != 1 else ''}")
    if closed:
        parts.append("cierre")
    return " · ".join(parts) or "Ventas del día"


async def day_total(db: AsyncSession, tenant_id: int, day: date) -> tuple[Decimal, int, bool]:
    """Lo que el día lleva al libro, cuántos tickets tuvo y si cerró."""
    close_total = await db.scalar(
        select(Sale.total).where(Sale.tenant_id == tenant_id, Sale.sale_date == day, Sale.kind == SALE_KIND_CLOSE)
    )
    count, tickets_total = (await db.execute(
        select(func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0)).where(
            Sale.tenant_id == tenant_id, Sale.sale_date == day, Sale.kind == SALE_KIND_TICKET,
        )
    )).one()
    total = Decimal(close_total) if close_total is not None else Decimal(tickets_total)
    return total, count, close_total is not None


async def rebuild_day(db: AsyncSession, tenant_id: int, day: date, user_id: int) -> Decimal:
    """El ingreso de un día en la fuente Ventas, recalculado desde cero."""
    source_id = await ensure_sales_source(db, tenant_id)
    total, tickets, closed = await day_total(db, tenant_id, day)
    entries = (await db.scalars(
        select(IncomeEntry)
        .where(IncomeEntry.tenant_id == tenant_id, IncomeEntry.source_id == source_id,
               IncomeEntry.period_date == day)
        .order_by(IncomeEntry.id)
    )).all()
    keep = entries[0] if entries and total > 0 else None
    for extra in entries:
        if extra is not keep:
            await db.delete(extra)
    if total > 0:
        note = _day_note(tickets, closed)
        if keep is None:
            db.add(IncomeEntry(
                tenant_id=tenant_id, user_id=user_id, source_id=source_id, amount=total,
                currency="ARS", period_date=day, notes=note,
            ))
        else:
            keep.amount, keep.notes, keep.currency = total, note, "ARS"
    await db.flush()
    return total


async def day_summary(db: AsyncSession, tenant_id: int, day: date) -> DaySummary:
    """Todo lo de un día para la pantalla de Ventas: tickets, cierre, contado
    contra vendido por medio de pago, y los avisos."""
    sales = (await db.scalars(
        select(Sale).where(Sale.tenant_id == tenant_id, Sale.sale_date == day).order_by(Sale.created_at, Sale.id)
    )).all()
    tickets = [s for s in sales if s.kind == SALE_KIND_TICKET]
    close = next((s for s in sales if s.kind == SALE_KIND_CLOSE), None)

    ticketed: dict[str, Decimal] = defaultdict(Decimal)
    for t in tickets:
        for p in t.payments:
            ticketed[p.method] += p.amount
    counted = {p.method: p.amount for p in close.payments} if close else {}

    by_method: list[MethodLine] = []
    warnings: list[str] = []
    for method in PAYMENT_METHODS:
        if method not in ticketed and method not in counted:
            continue
        sold = ticketed.get(method, Decimal(0))
        if close is None:
            by_method.append(MethodLine(method=method, ticketed=sold))
            continue
        got = counted.get(method, Decimal(0))
        diff = got - sold
        by_method.append(MethodLine(method=method, ticketed=sold, counted=got, diff=diff))
        if diff < 0:
            warnings.append(
                f"Diferencia de caja en {METHOD_LABELS[method]}: se contó {_ars(-diff)} menos "
                "de lo que suman las ventas."
            )
    if close is not None and any(t.created_at > close.updated_at for t in tickets):
        warnings.append(
            "Hay ventas cargadas después del cierre: el día suma lo contado. Si esa plata "
            "no estaba en la caja al cerrar, actualizá el cierre."
        )

    ticketed_total = sum(ticketed.values(), Decimal(0))
    return DaySummary(
        sale_date=day,
        tickets=[SaleOut.model_validate(t) for t in tickets],
        close=SaleOut.model_validate(close) if close else None,
        by_method=by_method,
        ticketed_total=ticketed_total,
        counted_total=close.total if close else None,
        total=close.total if close else ticketed_total,
        warnings=warnings,
    )


async def days_between(db: AsyncSession, tenant_id: int, start: date, end: date) -> list[DayBrief]:
    """Un renglón por día con ventas en `[start, end)`, del más nuevo al más viejo."""
    rows = (await db.execute(
        select(Sale.sale_date, Sale.kind, func.count(Sale.id), func.coalesce(func.sum(Sale.total), 0))
        .where(Sale.tenant_id == tenant_id, Sale.sale_date >= start, Sale.sale_date < end)
        .group_by(Sale.sale_date, Sale.kind)
    )).all()
    days: dict[date, dict] = defaultdict(lambda: {"tickets": 0, "tickets_total": Decimal(0), "close": None})
    for day, kind, count, total in rows:
        if kind == SALE_KIND_CLOSE:
            days[day]["close"] = Decimal(total)
        else:
            days[day]["tickets"] = count
            days[day]["tickets_total"] = Decimal(total)
    return [
        DayBrief(
            sale_date=day, tickets=d["tickets"], closed=d["close"] is not None,
            total=d["close"] if d["close"] is not None else d["tickets_total"],
        )
        for day, d in sorted(days.items(), reverse=True)
    ]
