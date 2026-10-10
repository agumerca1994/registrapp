"""Gastos simples desde el asistente: cargar, corregir y borrar.

"Simple" = lo que no es espejo de otra cosa: efectivo, débito, transferencia —
lo que en la app se carga con el formulario de Egresos o por el bot. Los
gastos con tarjeta van por `save_card_item` y los compartidos por
`create_shared_expense`; esta tool los **rechaza** en vez de tocarlos.

Esa negativa es la diferencia con el router: `PATCH/DELETE /expenses/entries`
dejan tocar cualquier egreso porque el frontend esconde los botones de los
espejos. Una IA no tiene esa red, y editar el espejo de un ítem de tarjeta lo
desincroniza del resumen; borrar el de un split lo devuelve a "pendiente".
`services/expenses.linked_to()` lo detecta por el vínculo real.

Reglas de la casa, como todas las tools de escritura: `dry_run=True` por
default y la vista previa es la escritura real deshecha (`finish`), la lógica
vive en `services/expenses.py` (la misma que usa el router), cada escritura
aplicada se audita, y lo dudoso vuelve como `warnings` — no bloquea.
"""
from datetime import timedelta
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp_server.context import McpCaller, current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.params import parse_date
from app.mcp_server.serialize import f, f0
from app.services.business.capture import fmt_qty
from app.mcp_server.write_common import (
    DESTRUCTIVE, WRITE, audit, finish, fold, http_to_tool, limit_writes,
)
from app.models.business import Payee, Product
from app.models.expense import EXPENSE_SOURCE_MCP, ExpenseCategory, ExpenseEntry
from app.models.tenant import TENANT_KIND_BUSINESS, Tenant
from app.services import expenses as svc

_LINK_HINT = {
    "tarjeta": "Es un gasto con tarjeta: se corrige desde su resumen (get_card_statement / save_card_item).",
    "compartido": "Es la parte de un gasto compartido: se corrige desde el compartido (update_shared_expense).",
    "hipoteca": "Es una cuota de la hipoteca, que se sincroniza sola: no se edita a mano.",
}


def _dec(v: float) -> Decimal:
    try:
        d = Decimal(str(v)).quantize(Decimal("0.01"))
    except InvalidOperation:
        raise ToolError("amount no es un número válido")
    if d <= 0:
        raise ToolError("amount tiene que ser positivo")
    return d


async def _resolve_category(
    db: AsyncSession, caller: McpCaller, category: str | None, category_id: int | None,
) -> int | None:
    """Categoría por id o por nombre exacto (sin mayúsculas ni tildes)."""
    if category_id is not None:
        return category_id  # la propiedad la chequea el servicio
    if category is None:
        return None
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == caller.tenant_id)
    )).all()
    match = [c for c in cats if fold(c.name) == fold(category)]
    if not match:
        names = ", ".join(sorted(c.name for c in cats)) or "(ninguna)"
        raise ToolError(f"No hay una categoría «{category}». Categorías: {names}")
    return match[0].id


async def _is_business(db: AsyncSession, caller: McpCaller) -> bool:
    return await db.scalar(select(Tenant.kind).where(Tenant.id == caller.tenant_id)) == TENANT_KIND_BUSINESS


async def _resolve_payee(
    db: AsyncSession, caller: McpCaller, payee: str | None, payee_id: int | None,
) -> int | None:
    """Proveedor o empleado por id o por nombre (sin tildes, tolera plurales)."""
    if payee is None and payee_id is None:
        return None
    if not await _is_business(db, caller):
        raise ToolError("payee es para cuentas de negocio, y esta cuenta es un hogar.")
    if payee_id is not None:
        return payee_id  # la propiedad la chequea el servicio
    from app.services.business.payees import list_payees, resolve_payee

    matches = await resolve_payee(db, caller.tenant_id, payee)
    if len(matches) == 1:
        return matches[0].id
    if not matches:
        names = ", ".join(p.name for p in await list_payees(db, caller.tenant_id)) or "(ninguno)"
        raise ToolError(f"No hay un proveedor o empleado «{payee}». Están: {names}. Se crean desde la app.")
    raise ToolError(f"«{payee}» puede ser " + ", ".join(f"{p.name} (id {p.id})" for p in matches) + ": usá payee_id.")


async def _stock_lines(db: AsyncSession, caller: McpCaller, raw_lines: list[dict]) -> list:
    """Lo que entra al stock con una compra, validado antes de escribir nada."""
    from app.mcp_server.tools_business import product_arg
    from app.schemas.business import StockLineIn

    if not await _is_business(db, caller):
        raise ToolError("stock_lines es para cuentas de negocio, y esta cuenta es un hogar.")
    out = []
    for raw in raw_lines:
        if not isinstance(raw, dict) or raw.get("qty") is None:
            raise ToolError('Cada línea de stock va como {"product": "coca", "qty": 12}')
        try:
            product = await product_arg(db, caller.tenant_id, raw.get("product"), raw.get("product_id"))
        except ToolError as exc:
            raise ToolError(f"{exc} Si es materia prima, cargá el gasto sin stock_lines: no es stock.")
        try:
            qty = Decimal(str(raw["qty"]))
            cost = None if raw.get("unit_cost") is None else Decimal(str(raw["unit_cost"])).quantize(Decimal("0.01"))
        except InvalidOperation:
            raise ToolError("qty y unit_cost tienen que ser números")
        if qty <= 0 or (cost is not None and cost < 0):
            raise ToolError("qty va mayor a cero y unit_cost no puede ser negativo")
        out.append(StockLineIn(product_id=product.id, qty=qty, unit_cost=cost))
    return out


async def _load_entry(db: AsyncSession, caller: McpCaller, entry_id: int) -> ExpenseEntry:
    entry = await db.get(ExpenseEntry, entry_id)
    if entry is None or entry.tenant_id != caller.tenant_id:
        raise ToolError(f"No hay un egreso {entry_id} en este hogar")
    return entry


async def _entry_dict(db: AsyncSession, e: ExpenseEntry) -> dict[str, Any]:
    cat = await db.get(ExpenseCategory, e.category_id) if e.category_id else None
    payee = await db.get(Payee, e.payee_id) if e.payee_id else None
    return {
        "id": e.id,
        "date": e.expense_date.isoformat(),
        "description": e.description,
        "amount": f0(e.amount),
        "currency": e.currency,
        "category": cat.name if cat else None,
        "payment_method": e.payment_method,
        "payee": payee.name if payee else None,
        "notes": e.notes,
    }


@mcp.tool(annotations=WRITE)
async def save_expense(
    entry_id: int | None = None,
    amount: float | None = None,
    expense_date: str | None = None,
    description: str | None = None,
    category: str | None = None,
    category_id: int | None = None,
    currency: str = "ARS",
    payment_method: str | None = None,
    notes: str | None = None,
    payee: str | None = None,
    payee_id: int | None = None,
    stock_lines: list[dict] | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Carga un gasto simple (efectivo, débito o transferencia), o corrige uno.

    - Sin `entry_id` CREA: hacen falta amount, expense_date y la categoría
      (en USD es opcional: si no se da, va a "Consumo en dólares").
    - Con `entry_id` EDITA: sólo cambia lo que se pasa.

    NO es para gastos con tarjeta (usá save_card_item, que además crea las
    cuotas y el resumen) ni para gastos compartidos (create_shared_expense):
    un egreso que es espejo de una tarjeta, un compartido o la hipoteca se
    rechaza al editarlo. Antes de crear, si hay riesgo de duplicado, revisá
    con list_expenses; la vista previa igual avisa si hay uno parecido.
    En un negocio, `payee` dice a quién se le pagó, y una compra para revender
    lleva `stock_lines`: el gasto y el stock quedan juntos (borrar el gasto se
    lleva el stock). La materia prima es gasto, no stock: va sin stock_lines.
    Arranca en dry_run=true: mostrá la vista previa y aplicá sólo si el
    usuario confirma.

    Args:
        entry_id: Egreso a editar (de list_expenses con group_by="none").
        amount: Monto, positivo.
        expense_date: Fecha del gasto, YYYY-MM-DD.
        description: Descripción corta, ej. "Verdulería".
        category: Nombre de la categoría (ver get_taxonomy).
        category_id: Alternativa a category, por id.
        currency: "ARS" (default) o "USD". Sólo al crear.
        payment_method: "efectivo", "debito" o "transferencia" (opcional).
        notes: Nota libre (opcional).
        payee: Negocio: el proveedor o empleado al que se le pagó (nombre; ver
            `payees` en get_taxonomy). Al crear sin categoría, usa la suya.
        payee_id: Alternativa a payee, por id.
        stock_lines: Negocio, sólo al crear: lo que entró al stock con esta
            compra, [{"product": "coca", "qty": 12}] (unit_cost opcional; con
            una sola línea sale del monto).
        dry_run: true = vista previa (default). false = guardar.
    """
    if payment_method is not None and payment_method not in svc.PAYMENT_METHODS:
        raise ToolError(f"payment_method debe ser uno de: {', '.join(svc.PAYMENT_METHODS)}")
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        try:
            warnings: list[str] = []
            cat_id = await _resolve_category(db, caller, category, category_id)
            pid = await _resolve_payee(db, caller, payee, payee_id)

            if entry_id is not None:
                entry = await _load_entry(db, caller, entry_id)
                link = await svc.linked_to(db, entry)
                if link:
                    raise ToolError(_LINK_HINT[link])
                before = await _entry_dict(db, entry)
                updates: dict[str, Any] = {}
                if amount is not None:
                    updates["amount"] = _dec(amount)
                if expense_date is not None:
                    updates["expense_date"] = parse_date(expense_date, "expense_date")
                if description is not None:
                    updates["description"] = description.strip()[:255] or None
                if cat_id is not None:
                    updates["category_id"] = cat_id
                if payment_method is not None:
                    updates["payment_method"] = payment_method
                if notes is not None:
                    updates["notes"] = notes.strip()[:500] or None
                if pid is not None:
                    updates["payee_id"] = pid
                if stock_lines:
                    raise ToolError(
                        "El stock de una compra se carga al crearla. Para corregirlo, borrá el gasto y "
                        "cargalo de nuevo, o ajustá con record_stock_movement."
                    )
                if not updates:
                    raise ToolError("No hay nada para cambiar")
                await svc.update_expense(db, entry, caller.tenant_id, updates)
                after = await _entry_dict(db, entry)
                result = {"action": "update", "entry": after, "before": before, "warnings": warnings}
                return await finish(db, dry_run, result, lambda: audit(
                    db, caller, "save_expense", f"editado egreso {entry_id}",
                    {"entry_id": entry_id, "before": before, "after": after},
                ))

            # ── create
            missing = [n for n, v in (("amount", amount), ("expense_date", expense_date)) if v is None]
            if missing:
                raise ToolError(f"Para cargar un gasto faltan: {', '.join(missing)}")
            if currency not in ("ARS", "USD"):
                raise ToolError('currency debe ser "ARS" o "USD"')
            amt = _dec(amount)
            when = parse_date(expense_date, "expense_date")
            lines = await _stock_lines(db, caller, stock_lines) if stock_lines else []
            if lines and currency != "ARS":
                raise ToolError("El stock entra con compras en pesos")
            chosen = await db.get(Payee, pid) if pid is not None else None
            if chosen is not None and chosen.tenant_id != caller.tenant_id:
                chosen = None  # el servicio lo rechaza; acá no se lee nada de otro negocio
            if chosen is not None and cat_id is None:
                # Como en el formulario: el proveedor sólo llena una categoría vacía.
                cat_id = chosen.default_category_id
            if not (description or "").strip():
                # Sin descripción, lo que se compró o a quién se le pagó (como el bot):
                # un egreso "s/d" en la lista no dice nada.
                if lines:
                    stocked = await db.scalars(select(Product).where(Product.id.in_([ln.product_id for ln in lines])))
                    by_id = {p.id: p.name for p in stocked.all()}
                    description = " + ".join(f"{fmt_qty(ln.qty)} {by_id.get(ln.product_id, '')}".strip() for ln in lines)
                elif chosen is not None:
                    description = chosen.name

            # El duplicado probable: mismo monto y moneda, ±1 día. Avisa, no frena
            # (dos cafés iguales el mismo día existen).
            dupes = (await db.scalars(
                select(ExpenseEntry).where(
                    ExpenseEntry.tenant_id == caller.tenant_id,
                    ExpenseEntry.amount == amt,
                    ExpenseEntry.currency == currency,
                    ExpenseEntry.expense_date.between(when - timedelta(days=1), when + timedelta(days=1)),
                )
            )).all()
            for d in dupes:
                warnings.append(
                    f"Ya hay un egreso del mismo monto cerca de esa fecha: «{d.description or 's/d'}» "
                    f"(id {d.id}, {d.expense_date.isoformat()}). Si es el mismo, no lo cargues de nuevo."
                )

            entry = await svc.create_expense(
                db,
                tenant_id=caller.tenant_id,
                user_id=caller.user_id,
                amount=amt,
                expense_date=when,
                category_id=cat_id,
                currency=currency,
                description=(description or "").strip()[:255] or None,
                notes=(notes or "").strip()[:500] or None,
                payment_method=payment_method,
                payee_id=pid,
                source=EXPENSE_SOURCE_MCP,
            )
            stock_out = []
            if lines:
                from app.services.business import stock as stock_svc

                moves = await stock_svc.add_purchase_lines(
                    db, tenant_id=caller.tenant_id, user_id=caller.user_id, entry=entry, lines=lines,
                )
                levels = await stock_svc.on_hand(db, caller.tenant_id, [m.product_id for m in moves])
                names = {p.id: p.name for p in (await db.scalars(
                    select(Product).where(Product.id.in_([m.product_id for m in moves]))
                )).all()}
                stock_out = [
                    {"product": names.get(m.product_id), "qty": f(m.qty, 3), "unit_cost": f(m.unit_cost),
                     "on_hand_after": f(levels.get(m.product_id), 3)}
                    for m in moves
                ]
            after = await _entry_dict(db, entry)
            new_id = entry.id
            if dry_run:
                after["id"] = None
            result = {"action": "create", "entry": after, "warnings": warnings}
            if stock_out:
                result["stock"] = stock_out
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "save_expense",
                f"cargado egreso {new_id} ({after['description']}, {after['amount']} {after['currency']})",
                {"entry_id": new_id, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_expense(entry_id: int, dry_run: bool = True) -> dict[str, Any]:
    """Borra un gasto simple. Los espejos de una tarjeta, un compartido o la
    hipoteca se rechazan (se borran desde su origen). Arranca en dry_run=true:
    mostrá qué se borraría y aplicá sólo si el usuario confirma.

    Args:
        entry_id: Egreso a borrar (de list_expenses con group_by="none").
        dry_run: true = vista previa (default). false = borrar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        try:
            entry = await _load_entry(db, caller, entry_id)
            link = await svc.linked_to(db, entry)
            if link:
                raise ToolError(_LINK_HINT[link])
            before = await _entry_dict(db, entry)
            await svc.delete_expense(db, entry, caller.tenant_id)
            result = {"action": "delete", "entry": before}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "delete_expense", f"borrado egreso {entry_id}",
                {"entry_id": entry_id, "before": before},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)
