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
from app.mcp_server.serialize import f0
from app.mcp_server.write_common import (
    DESTRUCTIVE, WRITE, audit, finish, fold, http_to_tool, limit_writes,
)
from app.models.expense import EXPENSE_SOURCE_MCP, ExpenseCategory, ExpenseEntry
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


async def _load_entry(db: AsyncSession, caller: McpCaller, entry_id: int) -> ExpenseEntry:
    entry = await db.get(ExpenseEntry, entry_id)
    if entry is None or entry.tenant_id != caller.tenant_id:
        raise ToolError(f"No hay un egreso {entry_id} en este hogar")
    return entry


async def _entry_dict(db: AsyncSession, e: ExpenseEntry) -> dict[str, Any]:
    cat = await db.get(ExpenseCategory, e.category_id) if e.category_id else None
    return {
        "id": e.id,
        "date": e.expense_date.isoformat(),
        "description": e.description,
        "amount": f0(e.amount),
        "currency": e.currency,
        "category": cat.name if cat else None,
        "payment_method": e.payment_method,
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
                source=EXPENSE_SOURCE_MCP,
            )
            after = await _entry_dict(db, entry)
            new_id = entry.id
            if dry_run:
                after["id"] = None
            result = {"action": "create", "entry": after, "warnings": warnings}
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
