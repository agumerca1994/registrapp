"""Conciliación de resúmenes desde el asistente.

El flujo que el usuario hacía a mano con la IA (comparar el PDF del banco
renglón por renglón contra `get_card_statement`) ahora lo hace el motor
determinista de `services/reconcile` — el mismo de la pantalla /conciliar.
El asistente aporta lo que el motor no tiene: el cliente ya sabe leer el PDF
adjunto, así que acá entra el TEXTO del resumen, y los parsers y el control
de totales deciden igual que en la app.

Reglas propias de este módulo:
- `reconcile_statement` crea la sesión y clasifica, pero NO escribe en los
  resúmenes: devolver el reporte es el "dry run" natural de todo el flujo.
- `apply_reconcile_group` sí escribe y sigue el contrato de todas las tools
  de escritura: `dry_run=True` por default y la vista previa es la escritura
  real deshecha (`finish`).
- Un faltante en ARS sin categoría no se aplica; `set_reconcile_category`
  la asigna por nombre (mismo resolver tolerante que las tools de tarjetas).
"""
from typing import Any

from fastapi import HTTPException
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy import select

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.serialize import guard
from app.mcp_server.write_common import (
    WRITE, audit, finish, fold, http_to_tool, limit_writes,
)
from app.models.expense import ExpenseCategory
from app.models.reconciliation import ReconciliationAction, ReconciliationSession
from app.models.user import User
from app.services import reconcile as reconcile_service
from app.services.reconcile import rules as reconcile_rules


async def _me(db, caller) -> User:
    user = await db.get(User, caller.user_id)
    if user is None:
        raise ToolError("Usuario no encontrado")
    return user


async def _owned_session(db, caller, session_id: int) -> ReconciliationSession:
    session = await db.scalar(
        select(ReconciliationSession).where(
            ReconciliationSession.id == session_id,
            ReconciliationSession.tenant_id == caller.tenant_id,
        )
    )
    if session is None:
        raise ToolError(f"No hay una sesión de conciliación {session_id} en este hogar")
    return session


def _action_dict(a: ReconciliationAction) -> dict[str, Any]:
    return {
        "id": a.id,
        "klass": a.klass,
        "op": a.op,
        "status": a.status,
        "payload": a.payload,
    }


async def _session_dict(db, session: ReconciliationSession) -> dict[str, Any]:
    actions = (
        await db.scalars(
            select(ReconciliationAction)
            .where(ReconciliationAction.session_id == session.id)
            .order_by(ReconciliationAction.id)
        )
    ).all()
    groups: dict[str, list[dict]] = {}
    for a in actions:
        groups.setdefault(a.klass, []).append(_action_dict(a))
    parsed = session.parsed or {}
    return {
        "session_id": session.id,
        "status": session.status,
        "reason": session.reason,
        "bank": parsed.get("bank"),
        "card_id": session.card_id,
        "statement_id": session.statement_id,
        "period": f"{session.period_year}-{session.period_month:02d}"
        if session.period_year else None,
        "closing_date": session.closing_date.isoformat() if session.closing_date else None,
        "due_date": session.due_date.isoformat() if session.due_date else None,
        "totals": session.totals,
        "choices": session.choices,
        "item_count": len(parsed.get("items", [])),
        "groups": groups,
        "group_order": reconcile_service.GROUP_ORDER,
    }


@mcp.tool(annotations=WRITE)
async def reconcile_statement(
    statement_text: str,
    card_id: int | None = None,
    statement_id: int | None = None,
) -> dict[str, Any]:
    """Concilia el texto de un resumen de tarjeta del banco contra lo cargado.

    Pegá el TEXTO del PDF del resumen (vos ya sabés leer el adjunto). El motor
    de la app lo parsea, verifica contra los totales que imprime el banco,
    elige tarjeta y período, y clasifica las diferencias en grupos: faltantes,
    sobrantes, dobles conteos, montos distintos, USD mal identificados y
    redondeos. NO escribe nada en los resúmenes: mostrá el reporte al usuario
    y aplicá los grupos que confirme con `apply_reconcile_group`.

    Si `status` vuelve "needs_choice", repetí con `card_id` o `statement_id`
    según las opciones en `choices`. Si vuelve "needs_ai", el parser no pudo
    con este formato: en ese caso compará a mano con `get_card_statement`,
    como siempre. Si "unexplained", los números no cierran al centavo —
    decíselo al usuario antes de proponer nada.

    Args:
        statement_text: El texto completo del resumen (todas las páginas con
            movimientos; incluí los renglones de totales del banco).
        card_id: Tarjeta elegida, cuando el motor no pudo decidir.
        statement_id: Resumen elegido, cuando hubo empate de período.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        user = await _me(db, caller)
        try:
            session = await reconcile_service.start_session(
                db, user=user, text=statement_text, channel="mcp", card_id=card_id
            )
            if statement_id is not None and session.status == "needs_choice":
                await reconcile_service.resolve_session(
                    db, session, user, explicit_statement_id=statement_id
                )
            await db.commit()
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)
        return guard(await _session_dict(db, session))


@mcp.tool(annotations=WRITE)
async def set_reconcile_category(
    session_id: int,
    action_id: int,
    category: str,
    description: str | None = None,
    save_rule: bool = False,
) -> dict[str, Any]:
    """Asigna la categoría (y opcionalmente la descripción) a un faltante de
    una conciliación, antes de aplicar el grupo. La categoría va por nombre,
    tolerante a mayúsculas y tildes.

    Args:
        session_id: La sesión de `reconcile_statement`.
        action_id: La acción (grupo "missing") a completar.
        category: Nombre de una categoría existente del hogar.
        description: Descripción final del gasto (default: la del banco).
        save_rule: true guarda la regla comercio → categoría para proponerla
            en la próxima conciliación (confirmalo con el usuario).
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        session = await _owned_session(db, caller, session_id)
        action = await db.scalar(
            select(ReconciliationAction).where(
                ReconciliationAction.id == action_id,
                ReconciliationAction.session_id == session.id,
            )
        )
        if action is None:
            raise ToolError(f"No hay una acción {action_id} en la sesión {session_id}")
        if action.status != "proposed":
            raise ToolError("La acción ya no está propuesta")

        cats = (await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.tenant_id == caller.tenant_id)
        )).all()
        match = [c for c in cats if fold(c.name) == fold(category)]
        if not match:
            names = ", ".join(sorted(c.name for c in cats)) or "(ninguna)"
            raise ToolError(f"No hay una categoría «{category}». Categorías: {names}")

        payload = dict(action.payload or {})
        payload["category_id"] = match[0].id
        payload["category_source"] = "user"
        if description:
            payload["description"] = description[:255]
        action.payload = payload
        if save_rule and payload.get("bank_description"):
            await reconcile_rules.save_rule(
                db, caller.tenant_id, reconcile_rules.KIND_MERCHANT_CATEGORY,
                reconcile_rules.merchant_key(payload["bank_description"]),
                {"category_id": match[0].id, "description": payload.get("description")},
            )
        await db.commit()
        return {"action": _action_dict(action), "category": match[0].name}


@mcp.tool(annotations=WRITE)
async def apply_reconcile_group(
    session_id: int,
    klass: str,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Aplica un grupo confirmado de una conciliación (crea faltantes, corrige
    montos, borra sobrantes — según el grupo), en una sola transacción.

    Con `dry_run=true` (default) es la escritura real deshecha: mostrásela al
    usuario y repetí con `dry_run=false` SÓLO si confirma ese grupo. Los
    faltantes en ARS sin categoría quedan sin aplicar y vuelven en `skipped`
    (usá `set_reconcile_category`).

    Args:
        session_id: La sesión de `reconcile_statement`.
        klass: Uno de "dates", "missing", "double_count", "amount_diff",
            "usd_fix", "rounding", "surplus".
        dry_run: true = sólo vista previa.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        user = await _me(db, caller)
        session = await _owned_session(db, caller, session_id)
        try:
            result = await reconcile_service.apply_group(db, session, user, klass)
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)

        async def on_apply() -> None:
            await audit(
                db, caller, "apply_reconcile_group",
                f"conciliación {session.id}: grupo {klass} aplicado",
                {"session_id": session.id, "klass": klass, "result": result},
            )

        return await finish(db, dry_run, {"group": klass, **result}, on_apply)


@mcp.tool(annotations=WRITE)
async def undo_reconcile_group(session_id: int, dry_run: bool = True) -> dict[str, Any]:
    """Deshace el último grupo aplicado de una conciliación, usando los
    snapshots `before` de cada acción. Con `dry_run=true` (default) muestra
    qué revertiría sin tocar nada.

    Args:
        session_id: La sesión de `reconcile_statement`.
        dry_run: true = sólo vista previa.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        user = await _me(db, caller)
        session = await _owned_session(db, caller, session_id)
        try:
            result = await reconcile_service.undo_last_group(db, session, user)
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)

        async def on_apply() -> None:
            await audit(
                db, caller, "undo_reconcile_group",
                f"conciliación {session.id}: último grupo deshecho",
                {"session_id": session.id, "result": result},
            )

        return await finish(db, dry_run, result, on_apply)
