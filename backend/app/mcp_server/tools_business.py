"""El negocio desde el asistente: ventas, el cierre del día, stock y productos.

Las mismas reglas que las demás tools de escritura (`write_common`):
`dry_run=True` por default y la vista previa es la escritura real deshecha;
sin lógica propia —todo pasa por `services/business/` (`sales`, `stock`,
`products`), lo mismo que usan la app y el bot—; cada escritura aplicada se
audita, y hay un límite por hora. En un hogar devuelven error: no hay ventas
ni stock que tocar.

Lo que el asistente tiene que saber del dominio viaja en `BUSINESS_RULES`
(tools_meta): el día suma lo contado si se cerró la caja, una venta nunca se
frena por falta de stock, un producto se archiva y no se borra.
"""
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp_server.context import McpCaller, current_caller, tool_session
from app.mcp_server.instance import READ_ONLY, mcp
from app.mcp_server.params import parse_date, parse_range
from app.mcp_server.serialize import f, f0, guard
from app.mcp_server.write_common import DESTRUCTIVE, WRITE, audit, finish, http_to_tool, limit_writes
from app.models.business import PAYMENT_METHODS, SALE_KIND_TICKET, Product, Sale
from app.models.tenant import TENANT_KIND_BUSINESS, Tenant
from app.schemas.business import DaySummary, SaleLineIn, SalePaymentIn
from app.services.business import analytics as biz_analytics, products as products_svc, sales, stock
from app.services.business.capture import fmt_qty
from app.services.clock import business_today

MAX_SALE_DAYS = 31
STOCK_KINDS = ("produccion", "merma", "compra", "conteo")


# ── Comunes ───────────────────────────────────────────────────────────────────

async def _business_caller(db: AsyncSession) -> McpCaller:
    caller = await current_caller(db)
    kind = await db.scalar(select(Tenant.kind).where(Tenant.id == caller.tenant_id))
    if kind != TENANT_KIND_BUSINESS:
        raise ToolError("Esta herramienta es para cuentas de negocio, y esta cuenta es un hogar.")
    return caller


def _dec(value: Any, field: str, *, places: str = "0.01", allow_zero: bool = False) -> Decimal:
    try:
        d = Decimal(str(value)).quantize(Decimal(places))
    except (InvalidOperation, ValueError, TypeError):
        raise ToolError(f"{field} no es un número válido (recibí {value!r})")
    if d < 0 or (d == 0 and not allow_zero):
        raise ToolError(f"{field} tiene que ser {'cero o más' if allow_zero else 'mayor a cero'}")
    return d


async def _find_products(db: AsyncSession, tenant_id: int, name: str) -> list[Product]:
    return await products_svc.resolve_product(db, tenant_id, name)


async def product_arg(db: AsyncSession, tenant_id: int, name: str | None, product_id: int | None) -> Product:
    """Un producto por id o por nombre (sin tildes, tolera plurales). Si el
    nombre no alcanza para decidir, el error lista los candidatos. También lo
    usa `save_expense` para sus `stock_lines`."""
    if product_id is not None:
        return await products_svc.assert_owns_product(db, tenant_id, int(product_id))
    if not name:
        raise ToolError("Falta el producto: product (nombre) o product_id")
    matches = await _find_products(db, tenant_id, name)
    if len(matches) == 1:
        return matches[0]
    if not matches:
        names = ", ".join(p.name for p in await products_svc.list_products(db, tenant_id)) or "(ninguno)"
        raise ToolError(f"No hay un producto «{name}». Productos: {names}")
    raise ToolError(
        f"«{name}» puede ser " + ", ".join(f"{p.name} (id {p.id})" for p in matches) + ": usá product_id."
    )


def _payments(payments: list[dict] | None, amount: float | None, method: str | None) -> list[SalePaymentIn] | None:
    if payments:
        out = []
        for p in payments:
            if not isinstance(p, dict) or "method" not in p or "amount" not in p:
                raise ToolError('Cada pago va como {"method": "efectivo", "amount": 6500}')
            if p["method"] not in PAYMENT_METHODS:
                raise ToolError(f"method debe ser uno de: {', '.join(PAYMENT_METHODS)}")
            out.append(SalePaymentIn(method=p["method"], amount=_dec(p["amount"], "amount")))
        return out
    if amount is not None:
        method = method or "efectivo"
        if method not in PAYMENT_METHODS:
            raise ToolError(f"method debe ser uno de: {', '.join(PAYMENT_METHODS)}")
        return [SalePaymentIn(method=method, amount=_dec(amount, "amount"))]
    return None


async def _sale_lines(db: AsyncSession, tenant_id: int, lines: list[dict] | None, warnings: list[str]) -> list[SaleLineIn]:
    """Las líneas de una venta. Un nombre que no es un producto queda como
    texto libre (no mueve stock), igual que en el bot: no se inventa un producto."""
    out = []
    for raw in lines or []:
        if not isinstance(raw, dict):
            raise ToolError('Cada línea va como {"product": "empanada", "qty": 3} o {"description": "…", "qty": 1}')
        qty = _dec(raw.get("qty", 1), "qty", places="0.001")
        price = None if raw.get("unit_price") is None else _dec(raw["unit_price"], "unit_price", allow_zero=True)
        name, pid = raw.get("product"), raw.get("product_id")
        if pid is None and name and not await _find_products(db, tenant_id, name):
            warnings.append(f"No hay un producto «{name}»: va como texto libre y no mueve stock.")
            out.append(SaleLineIn(description=str(name), qty=qty, unit_price=price))
        elif pid is not None or name:
            product = await product_arg(db, tenant_id, name, pid)
            out.append(SaleLineIn(product_id=product.id, qty=qty,
                                  unit_price=price if price is not None else product.sale_price))
        elif raw.get("description"):
            out.append(SaleLineIn(description=str(raw["description"]), qty=qty, unit_price=price))
        else:
            raise ToolError("Cada línea necesita product, product_id o description")
    return out


async def _names(db: AsyncSession, ids) -> dict[int, str]:
    ids = [i for i in ids if i]
    if not ids:
        return {}
    return {p.id: p.name for p in (await db.scalars(select(Product).where(Product.id.in_(ids)))).all()}


def _sale_dict(sale: Sale, names: dict[int, str]) -> dict[str, Any]:
    return {
        "id": sale.id,
        "date": sale.sale_date.isoformat(),
        "kind": "venta" if sale.kind == SALE_KIND_TICKET else "cierre",
        "total": f0(sale.total),
        "source": sale.source,
        "notes": sale.notes,
        "payments": [{"method": p.method, "amount": f0(p.amount)} for p in sale.payments],
        "lines": [
            {
                "product_id": ln.product_id,
                "product": names.get(ln.product_id) if ln.product_id else None,
                "description": ln.description,
                "qty": f(ln.qty, 3),
                "unit_price": f(ln.unit_price),
            }
            for ln in sale.lines
        ],
    }


def _day_dict(s: DaySummary) -> dict[str, Any]:
    return {
        "date": s.sale_date.isoformat(),
        "total": f0(s.total),
        "closed": s.close is not None,
        "sales_count": len(s.tickets),
        "sales_total": f0(s.ticketed_total),
        "counted_total": f(s.counted_total),
        "by_method": [
            {"method": m.method, "sold": f0(m.ticketed), "counted": f(m.counted), "diff": f(m.diff)}
            for m in s.by_method
        ],
        "warnings": s.warnings,
    }


async def _negative_stock(db: AsyncSession, tenant_id: int, product_ids) -> list[str]:
    levels = {lv["product_id"]: lv for lv in await stock.stock_levels(db, tenant_id)}
    return [
        f"{levels[pid]['name']} queda en {fmt_qty(levels[pid]['on_hand'])}: falta cargar la producción o un ingreso."
        for pid in dict.fromkeys(product_ids) if pid in levels and levels[pid]["alert"] == "negativo"
    ]


# ── Lectura ───────────────────────────────────────────────────────────────────

@mcp.tool(annotations=READ_ONLY)
async def get_sales(date_from: str, date_to: str, group_by: str = "day") -> dict[str, Any]:
    """Las ventas de un período, con el total y el desglose pedido.

    Cada día suma lo CONTADO si se cerró la caja y, si no, la suma de las
    ventas: la misma regla que el ingreso del día en la fuente «Ventas». Los
    productos salen sólo de las ventas cargadas una por una (el cierre no
    detalla productos).

    Args:
        date_from: Desde, YYYY-MM-DD (inclusive).
        date_to: Hasta, YYYY-MM-DD (inclusive).
        group_by: "day" (default: un renglón por día, con cuántas ventas tuvo
            y si se cerró), "method" (por medio de pago), "product" (lo que
            más facturó) o "sale" (cada venta con su id, sus líneas y sus
            pagos, más el cierre y los avisos de cada día; hasta 31 días).
    """
    if group_by not in ("day", "method", "product", "sale"):
        raise ToolError('group_by debe ser "day", "method", "product" o "sale"')
    start, end = parse_range(date_from, date_to)
    async with tool_session() as db:
        caller = await _business_caller(db)
        tid = caller.tenant_id
        days = await sales.days_between(db, tid, start, end)
        result: dict[str, Any] = {
            "period": {"from": start.isoformat(), "to": (end - timedelta(days=1)).isoformat()},
            "total": f0(sum((d.total for d in days), Decimal(0))),
            "days_with_sales": len(days),
        }
        if group_by == "day":
            result["days"] = [
                {"date": d.sale_date.isoformat(), "total": f0(d.total), "sales_count": d.tickets, "closed": d.closed}
                for d in sorted(days, key=lambda d: d.sale_date)
            ]
        elif group_by == "method":
            result["by_method"] = [
                {"method": m.method, "total": f0(m.total)}
                for m in await biz_analytics.sales_by_method(db, tid, start, end)
            ]
        elif group_by == "product":
            result["by_product"] = [
                {"product_id": p.product_id, "name": p.name, "qty": f(p.qty, 3), "revenue": f0(p.revenue)}
                for p in await biz_analytics.top_products(db, tid, start, end, limit=50)
            ]
            result["notes"] = [
                "revenue es cantidad × precio de cada línea; una venta cargada sin precio "
                "por línea (sólo el total) no suma acá.",
            ]
        else:
            if (end - start).days > MAX_SALE_DAYS:
                raise ToolError(f'group_by="sale" trae hasta {MAX_SALE_DAYS} días: achicá el rango.')
            detail = []
            for d in sorted(days, key=lambda d: d.sale_date):
                summary = await sales.day_summary(db, tid, d.sale_date)
                rows = (await db.scalars(
                    select(Sale).where(Sale.tenant_id == tid, Sale.sale_date == d.sale_date)
                    .order_by(Sale.created_at, Sale.id)
                )).all()
                names = await _names(db, [ln.product_id for s in rows for ln in s.lines])
                detail.append({**_day_dict(summary), "sales": [_sale_dict(s, names) for s in rows]})
            result["days"] = detail
    return guard(result)


@mcp.tool(annotations=READ_ONLY)
async def get_stock(only_alerts: bool = False, product: str | None = None, movements: int = 0) -> dict[str, Any]:
    """Cuánto hay de cada producto que lleva stock, con su mínimo y la alerta:
    "negativo" (se vendió más de lo cargado: falta cargar producción o un
    ingreso) o "bajo" (en el mínimo o debajo).

    Args:
        only_alerts: true = sólo los productos en alerta.
        product: Sólo este producto (nombre o parte del nombre).
        movements: Con `product`, sus últimos N movimientos (máx. 50): de
            dónde salió cada entrada y salida.
    """
    async with tool_session() as db:
        caller = await _business_caller(db)
        tid = caller.tenant_id
        levels = await stock.stock_levels(db, tid)
        target = await product_arg(db, tid, product, None) if product else None
        if target is not None:
            levels = [lv for lv in levels if lv["product_id"] == target.id]
        if only_alerts:
            levels = [lv for lv in levels if lv["alert"]]
        result: dict[str, Any] = {
            "products": [
                {"product_id": lv["product_id"], "name": lv["name"], "unit": lv["unit"],
                 "on_hand": f(lv["on_hand"], 3), "min_stock": f(lv["min_stock"], 3), "alert": lv["alert"]}
                for lv in levels
            ],
        }
        if target is not None and not target.track_stock:
            result["notes"] = [f"{target.name} no lleva stock: se activa al cargarle producción o un ingreso."]
        if target is not None and movements > 0:
            rows = await stock.movements(db, tid, target.id, limit=min(movements, 50))
            result["movements"] = [
                {
                    "id": m.id, "date": m.movement_date.isoformat(), "kind": m.kind, "qty": f(m.qty, 3),
                    "counted_qty": f(m.counted_qty, 3), "unit_cost": f(m.unit_cost),
                    "from": _origin(m),
                    "notes": m.notes,
                }
                for m in rows
            ]
    return guard(result)


def _origin(m) -> str:
    if m.sale_id:
        return "venta"
    if m.expense_entry_id:
        return f"compra (egreso {m.expense_entry_id})"
    return "a mano"


# ── Escritura ─────────────────────────────────────────────────────────────────

@mcp.tool(annotations=WRITE)
async def record_sale(
    sale_date: str,
    lines: list[dict] | None = None,
    amount: float | None = None,
    method: str | None = None,
    payments: list[dict] | None = None,
    notes: str | None = None,
    sale_id: int | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Carga una venta (con sus productos y cómo se cobró), o reemplaza una.

    La venta suma al ingreso de su día en la fuente «Ventas», salvo que ese
    día ya tenga cierre (record_daily_close): entonces el día sigue sumando lo
    contado, y la vista previa lo avisa. Los productos que llevan stock lo
    descuentan; si queda negativo no se frena: se avisa.

    Arranca en dry_run=true: mostrá la vista previa y aplicá sólo si el
    usuario confirma.

    Args:
        sale_date: Día de la venta, YYYY-MM-DD.
        lines: Lo vendido (opcional): [{"product": "empanada", "qty": 3,
            "unit_price": 1500}] (precio opcional: si falta, el de lista) o
            [{"description": "2 porciones de tarta", "qty": 1}]. Un nombre que
            no es un producto queda como texto libre.
        amount: Lo cobrado, con `method`. Sin amount ni payments, el total sale
            de los precios de lista (si todas las líneas tienen).
        method: efectivo (default), debito, credito, mercadopago, transferencia u otro.
        payments: En vez de amount + method, un pago dividido:
            [{"method": "efectivo", "amount": 4500}, {"method": "mercadopago", "amount": 2000}].
        notes: Nota libre.
        sale_id: Para REEMPLAZAR una venta ya cargada (líneas y pagos completos).
        dry_run: true = vista previa (default). false = guardar.
    """
    day = parse_date(sale_date, "sale_date")
    async with tool_session() as db:
        caller = await _business_caller(db)
        limit_writes(caller)
        tid = caller.tenant_id
        try:
            warnings: list[str] = []
            sale_lines = await _sale_lines(db, tid, lines, warnings)
            pays = _payments(payments, amount, method)
            if pays is None:
                if not sale_lines or any(ln.unit_price is None for ln in sale_lines):
                    raise ToolError("Falta lo cobrado: amount (+ method) o payments.")
                total = sum((ln.qty * ln.unit_price for ln in sale_lines), Decimal(0)).quantize(Decimal("0.01"))
                pays = [SalePaymentIn(method=method or "efectivo", amount=total)]
                warnings.append("Sin monto: el total sale de los precios de lista.")

            before = None
            if sale_id is not None:
                sale = await sales.get_ticket(db, tid, sale_id)
                before = _sale_dict(sale, await _names(db, [ln.product_id for ln in sale.lines]))
                sale = await sales.update_ticket(
                    db, sale, user_id=caller.user_id, sale_date=day, lines=sale_lines, payments=pays, notes=notes,
                )
            else:
                total = sum((p.amount for p in pays), Decimal(0))
                same = (await db.scalars(select(Sale).where(
                    Sale.tenant_id == tid, Sale.sale_date == day, Sale.kind == SALE_KIND_TICKET, Sale.total == total,
                ))).all()
                for s in same:
                    warnings.append(f"Ese día ya hay una venta de {f0(s.total)} (id {s.id}). Si es la misma, no la cargues de nuevo.")
                sale, _ = await sales.create_ticket(
                    db, tenant_id=tid, user_id=caller.user_id, sale_date=day, lines=sale_lines, payments=pays,
                    notes=notes, source="mcp",
                )
            after = _sale_dict(sale, await _names(db, [ln.product_id for ln in sale.lines]))
            summary = await sales.day_summary(db, tid, day)
            if summary.close is not None:
                warnings.append(
                    "Ese día ya tiene cierre: el día sigue sumando lo contado. Si esta venta no estaba "
                    "en la caja al cerrar, hay que volver a cerrar con record_daily_close."
                )
            warnings += await _negative_stock(db, tid, [ln.product_id for ln in sale.lines if ln.product_id])
            new_id = sale.id
            if dry_run and sale_id is None:
                after["id"] = None
            result = {"action": "update" if sale_id else "create", "sale": after, "before": before,
                      "day": _day_dict(summary), "warnings": warnings}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "record_sale", f"{'reemplazada' if sale_id else 'cargada'} venta {new_id} ({after['total']})",
                {"sale_id": new_id, "before": before, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=WRITE)
async def record_daily_close(
    close_date: str,
    counted: list[dict],
    units: list[dict] | None = None,
    notes: str | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """El cierre de caja de un día: lo CONTADO por medio de pago.

    Con cierre, el día suma lo contado (no la suma de las ventas). La vista
    previa compara contado contra vendido por medio de pago: si sobra, es
    venta sin ticket; si falta, diferencia de caja. Un día tiene un solo
    cierre: volver a cerrar lo reemplaza.

    Args:
        close_date: Día que se cierra, YYYY-MM-DD.
        counted: [{"method": "efectivo", "amount": 200000}, {"method": "mercadopago", "amount": 150000}].
            Un medio que no viene es un medio en el que no se contó nada.
        units: Lo que salió en el día de cada producto con stock (opcional):
            [{"product": "empanada", "qty": 40}]. Descuenta del stock lo que
            no descontaron las ventas cargadas. Si no se pasa y el día ya tenía
            cierre, se conservan sus unidades; [] las borra.
        notes: Nota libre.
        dry_run: true = vista previa (default). false = guardar.
    """
    day = parse_date(close_date, "close_date")
    async with tool_session() as db:
        caller = await _business_caller(db)
        limit_writes(caller)
        tid = caller.tenant_id
        try:
            pays = _payments(counted, None, None)
            if not pays:
                raise ToolError('counted es obligatorio: [{"method": "efectivo", "amount": …}]')
            previous = await sales.get_close(db, tid, day)
            before = _sale_dict(previous, await _names(db, [ln.product_id for ln in previous.lines])) if previous else None
            if units is None:
                unit_rows = [SaleLineIn(product_id=ln.product_id, qty=ln.qty) for ln in previous.lines
                             if ln.product_id] if previous else []
            else:
                unit_rows = []
                for raw in units:
                    if not isinstance(raw, dict):
                        raise ToolError('Cada unidad va como {"product": "empanada", "qty": 40}')
                    product = await product_arg(db, tid, raw.get("product"), raw.get("product_id"))
                    unit_rows.append(SaleLineIn(product_id=product.id, qty=_dec(raw.get("qty"), "qty", places="0.001")))
            close = await sales.upsert_close(
                db, tenant_id=tid, user_id=caller.user_id, day=day, counted=pays, units=unit_rows,
                notes=notes if notes is not None else (previous.notes if previous else None), source="mcp",
            )
            after = _sale_dict(close, await _names(db, [ln.product_id for ln in close.lines]))
            summary = await sales.day_summary(db, tid, day)
            new_id = close.id
            result = {"action": "replace" if previous else "create", "close": after, "before": before,
                      "day": _day_dict(summary), "warnings": list(summary.warnings)}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "record_daily_close", f"cierre {day.isoformat()} ({after['total']})",
                {"sale_id": new_id, "before": before, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=WRITE)
async def record_stock_movement(
    kind: str,
    qty: float,
    product: str | None = None,
    product_id: int | None = None,
    movement_date: str | None = None,
    unit_cost: float | None = None,
    notes: str | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Un movimiento de stock cargado a mano.

    - "produccion": lo que se hizo (suma).
    - "merma": lo que se tiró o se rompió (resta).
    - "compra": un ingreso SIN gasto (suma), por ejemplo mercadería pagada con
      tarjeta. Una compra con gasto va por save_expense con stock_lines, así el
      gasto y el stock quedan juntos.
    - "conteo": `qty` es lo que se CONTÓ; se guarda un ajuste por la diferencia
      con lo que dice el sistema (nada, si ya coincide).

    Arranca en dry_run=true: mostrá la vista previa y aplicá sólo si el
    usuario confirma.

    Args:
        kind: produccion, merma, compra o conteo.
        qty: Cantidad, en positivo (el tipo decide si suma o resta).
        product: Nombre del producto (o product_id).
        product_id: Alternativa a product.
        movement_date: YYYY-MM-DD (default: hoy, día de negocio).
        unit_cost: Costo por unidad (sólo en "compra", opcional).
        notes: Nota libre.
        dry_run: true = vista previa (default). false = guardar.
    """
    if kind not in STOCK_KINDS:
        raise ToolError(f"kind debe ser uno de: {', '.join(STOCK_KINDS)}")
    day = parse_date(movement_date, "movement_date") if movement_date else business_today()
    async with tool_session() as db:
        caller = await _business_caller(db)
        limit_writes(caller)
        tid = caller.tenant_id
        try:
            target = await product_arg(db, tid, product, product_id)
            name, pid = target.name, target.id
            before_qty = (await stock.on_hand(db, tid, [pid])).get(pid, Decimal(0))
            if kind == "conteo":
                movement = await stock.record_count(
                    db, tenant_id=tid, user_id=caller.user_id, product_id=pid,
                    counted_qty=_dec(qty, "qty", places="0.001", allow_zero=True), movement_date=day, source="mcp",
                )
            else:
                movement = await stock.record_movement(
                    db, tenant_id=tid, user_id=caller.user_id, product_id=pid, kind=kind,
                    qty=_dec(qty, "qty", places="0.001"), movement_date=day,
                    unit_cost=None if unit_cost is None else _dec(unit_cost, "unit_cost", allow_zero=True),
                    notes=notes, source="mcp",
                )
            after_qty = (await stock.on_hand(db, tid, [pid])).get(pid, Decimal(0))
            moved = None if movement is None else {
                "id": None if dry_run else movement.id, "kind": movement.kind, "qty": f(movement.qty, 3),
                "date": movement.movement_date.isoformat(),
            }
            result = {
                "action": kind, "product": name, "product_id": pid, "movement": moved,
                "on_hand_before": f(before_qty, 3), "on_hand_after": f(after_qty, 3),
                "warnings": ["Ya coincidía con lo contado: no hace falta un ajuste."] if movement is None else [],
            }
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "record_stock_movement", f"{kind} {name} ({f(before_qty, 3)} → {f(after_qty, 3)})",
                {"product_id": pid, "kind": kind, "qty": str(qty)},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


def _product_dict(p: Product) -> dict[str, Any]:
    return {
        "id": p.id, "name": p.name, "kind": p.kind, "unit": p.unit, "sale_price": f(p.sale_price),
        "track_stock": p.track_stock, "min_stock": f(p.min_stock, 3), "is_active": p.is_active,
    }


@mcp.tool(annotations=WRITE)
async def save_product(
    product_id: int | None = None,
    name: str | None = None,
    kind: str | None = None,
    unit: str | None = None,
    sale_price: float | None = None,
    track_stock: bool | None = None,
    min_stock: float | None = None,
    is_active: bool | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Crea un producto del negocio, o edita uno (sólo lo que se pasa).

    Los productos no se borran: se archivan con is_active=false, porque las
    ventas viejas los nombran.

    Args:
        product_id: Producto a editar (de get_taxonomy). Sin él, CREA (hace falta name).
        name: Nombre, ej. "Empanada de carne". Único en el negocio.
        kind: "elaborado" (lo produce el negocio) o "reventa" (se compra y se
            vende, como una gaseosa). Al crear, "elaborado" por default.
        unit: "unidad", "porcion" o "kg".
        sale_price: Precio de venta (el de lista).
        track_stock: Si se cuenta su stock. Al crear: sí para reventa, no
            para elaborado, salvo que digas otra cosa.
        min_stock: Stock mínimo: en ese número o debajo, alerta.
        is_active: false = archivar, true = restaurar.
        dry_run: true = vista previa (default). false = guardar.
    """
    async with tool_session() as db:
        caller = await _business_caller(db)
        limit_writes(caller)
        tid = caller.tenant_id
        try:
            price = None if sale_price is None else _dec(sale_price, "sale_price", allow_zero=True)
            minimum = None if min_stock is None else _dec(min_stock, "min_stock", places="0.001", allow_zero=True)
            if product_id is None:
                if not name:
                    raise ToolError("Para crear un producto hace falta name")
                product = await products_svc.create_product(
                    db, tid, name=name, kind=kind or "elaborado", unit=unit or "unidad", sale_price=price,
                    track_stock=track_stock, min_stock=minimum,
                )
                before = None
            else:
                product = await products_svc.assert_owns_product(db, tid, product_id)
                before = _product_dict(product)
                updates = {k: v for k, v in {
                    "name": name, "kind": kind, "unit": unit, "sale_price": price,
                    "track_stock": track_stock, "min_stock": minimum, "is_active": is_active,
                }.items() if v is not None}
                if not updates:
                    raise ToolError("No hay nada para cambiar")
                await products_svc.update_product(db, product, tid, updates)
            after = _product_dict(product)
            new_id = product.id
            if dry_run and product_id is None:
                after["id"] = None
            result = {"action": "update" if product_id else "create", "product": after, "before": before}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "save_product", f"{'editado' if product_id else 'creado'} producto {new_id} ({after['name']})",
                {"product_id": new_id, "before": before, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_sale(sale_id: int | None = None, close_date: str | None = None, dry_run: bool = True) -> dict[str, Any]:
    """Borra una venta (sale_id) o el cierre de un día (close_date). Lo que
    descontó del stock vuelve, y el ingreso del día se recalcula: sin cierre,
    el día vuelve a sumar las ventas cargadas.

    Arranca en dry_run=true: mostrá qué se borraría y aplicá sólo si el
    usuario confirma.

    Args:
        sale_id: Venta a borrar (de get_sales con group_by="sale").
        close_date: En vez de sale_id, el día cuyo cierre se borra (YYYY-MM-DD).
        dry_run: true = vista previa (default). false = borrar.
    """
    if (sale_id is None) == (close_date is None):
        raise ToolError("Pasá sale_id (una venta) o close_date (un cierre), uno de los dos.")
    async with tool_session() as db:
        caller = await _business_caller(db)
        limit_writes(caller)
        tid = caller.tenant_id
        try:
            if sale_id is not None:
                sale = await db.get(Sale, sale_id)
                if sale is not None and sale.tenant_id == tid and sale.kind != SALE_KIND_TICKET:
                    raise ToolError(f"La {sale_id} es el cierre del {sale.sale_date.isoformat()}: usá close_date.")
                sale = await sales.get_ticket(db, tid, sale_id)
                day = sale.sale_date
                before = _sale_dict(sale, await _names(db, [ln.product_id for ln in sale.lines]))
                await sales.delete_ticket(db, sale, user_id=caller.user_id)
            else:
                day = parse_date(close_date, "close_date")
                close = await sales.get_close(db, tid, day)
                if close is None:
                    raise ToolError(f"El {day.isoformat()} no tiene cierre")
                before = _sale_dict(close, await _names(db, [ln.product_id for ln in close.lines]))
                await sales.delete_close(db, tenant_id=tid, user_id=caller.user_id, day=day)
            summary = await sales.day_summary(db, tid, day)
            result = {"action": "delete", "deleted": before, "day": _day_dict(summary)}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "delete_sale", f"borrado {before['kind']} {before['id']} ({before['total']})",
                {"before": before},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)
