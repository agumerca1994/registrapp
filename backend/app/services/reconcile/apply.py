"""Aplicar y deshacer grupos de una conciliación.

Las reglas que este módulo hace cumplir, todas aprendidas en la práctica
manual del caso de referencia:

- **Se confirma por grupo, no por ítem**, y cada grupo se aplica en una sola
  transacción del caller (acá sólo hay flush).
- **Nunca se toca un ítem fuera del resumen que se concilia**: las
  correcciones van con `scope="item"` y los faltantes en cuotas sólo
  propagan cuotas futuras cuando el resumen es el más nuevo de la tarjeta.
- **Deshacer es por grupo aplicado**: cada acción guarda su `before`, y el
  grupo entero comparte el mismo `applied_at`, que es lo que permite
  identificar "lo último".
- Un faltante en ARS sin categoría no se aplica: queda propuesto y el
  resultado lo lista — elegir categoría es la única decisión por ítem que
  el usuario no puede delegar.
"""
from __future__ import annotations

from datetime import date, datetime  # noqa: F401
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import ExpenseEntry
from app.models.reconciliation import (
    ACTION_APPLIED,
    ACTION_PROPOSED,
    ACTION_UNDONE,
    ReconciliationAction,
    ReconciliationSession,
    SESSION_APPLIED,
    SESSION_CLOSED,
)
from app.schemas.credit_card import CreditCardItemCreate
from app.services.credit_cards import (
    apply_item_update,
    create_expense_entry,
    create_item_in_statement,
    delete_item_tree,
)
from app.services.reconcile.period import is_latest_statement

CAPTURE_SOURCE = "reconcile"


def _item_snapshot(item: CreditCardItem, entry: ExpenseEntry | None) -> dict:
    return {
        "item": {
            "statement_id": item.statement_id,
            "description": item.description,
            "category_id": item.category_id,
            "item_date": item.item_date.isoformat(),
            "item_type": item.item_type,
            "amount": str(item.amount),
            "currency": item.currency,
            "installment_count": item.installment_count,
            "installment_number": item.installment_number,
            "purchase_total": str(item.purchase_total) if item.purchase_total else None,
            "installment_group_id": item.installment_group_id,
            "bank_description": item.bank_description,
            "bank_coupon": item.bank_coupon,
            "capture_source": item.capture_source,
        },
        "entry": {
            "description": entry.description,
            "amount": str(entry.amount),
            "expense_date": entry.expense_date.isoformat(),
            "category_id": entry.category_id,
        } if entry else None,
    }


async def _stamp_matches(db: AsyncSession, session: ReconciliationSession) -> int:
    """Guarda descripción y cupón del banco en los ítems matcheados exactos.

    Es metadata de trazabilidad, no una decisión: se hace una vez, junto con
    el primer grupo aplicado, y es lo que vuelve exacta la próxima
    conciliación de estos comercios.
    """
    stamps = (session.parsed or {}).get("stamps") or []
    stamped = 0
    for s in stamps:
        item = await db.get(CreditCardItem, s["item_id"])
        if item is None:
            continue
        changed = False
        if s.get("bank_description") and not item.bank_description:
            item.bank_description = s["bank_description"][:255]
            changed = True
        if s.get("bank_coupon") and not item.bank_coupon:
            item.bank_coupon = s["bank_coupon"][:20]
            changed = True
        if changed:
            stamped += 1
    if stamps:
        session.parsed = {**session.parsed, "stamps": []}
    await db.flush()
    return stamped


async def apply_group(
    db: AsyncSession,
    session: ReconciliationSession,
    user,
    klass: str,
) -> dict:
    """Aplica las acciones propuestas de un grupo. **Sólo flush** — el caller
    decide commit (real) o rollback (dry run: la vista previa ES la escritura
    real deshecha, el mismo patrón que el conector MCP)."""
    stmt = await db.get(CreditCardStatement, session.statement_id)
    card = await db.get(CreditCard, session.card_id) if session.card_id else None
    if stmt is None or card is None:
        raise HTTPException(status_code=409, detail="La sesión no tiene resumen o tarjeta asignados")

    actions = (
        await db.scalars(
            select(ReconciliationAction).where(
                ReconciliationAction.session_id == session.id,
                ReconciliationAction.klass == klass,
                ReconciliationAction.status == ACTION_PROPOSED,
            ).order_by(ReconciliationAction.id)
        )
    ).all()
    if not actions:
        raise HTTPException(status_code=400, detail="No hay acciones propuestas en ese grupo")

    applied_at = datetime.now()
    propagate = await is_latest_statement(db, stmt)
    applied, skipped = [], []

    for action in actions:
        payload = action.payload or {}

        if action.op == "update_statement":
            before = {
                "closing_date": stmt.closing_date.isoformat() if stmt.closing_date else None,
                "due_date": stmt.due_date.isoformat() if stmt.due_date else None,
            }
            if payload.get("closing_date"):
                stmt.closing_date = date.fromisoformat(payload["closing_date"])
            if payload.get("due_date"):
                stmt.due_date = date.fromisoformat(payload["due_date"])
            action.before = before

        elif action.op == "create_item":
            if payload["currency"] == "ARS" and not payload.get("category_id"):
                skipped.append({"action_id": action.id, "reason": "sin_categoria",
                                "description": payload["description"]})
                continue
            body = CreditCardItemCreate(
                description=payload["description"],
                category_id=payload.get("category_id"),
                item_date=date.fromisoformat(payload["date"]),
                item_type=payload["item_type"],
                amount=Decimal(payload["amount"]),
                currency=payload["currency"],
                installment_count=payload.get("installment_count"),
                installment_number=payload.get("installment_number") or 1,
            )
            item = await create_item_in_statement(stmt, card, body, user, db, propagate=propagate)
            item.bank_description = (payload.get("bank_description") or "")[:255] or None
            item.bank_coupon = (payload.get("bank_coupon") or "")[:20] or None
            item.capture_source = CAPTURE_SOURCE
            action.item_id = item.id
            action.before = {"created_item_id": item.id, "propagated": propagate}

        elif action.op == "update_item":
            item = await db.get(CreditCardItem, payload["item_id"])
            if item is None:
                skipped.append({"action_id": action.id, "reason": "item_inexistente"})
                continue
            entry = await db.get(ExpenseEntry, item.expense_entry_id) if item.expense_entry_id else None
            action.before = _item_snapshot(item, entry)
            updates = dict(payload.get("updates") or {})
            if "amount" in updates:
                updates["amount"] = Decimal(updates["amount"])
            await apply_item_update(item, updates, session.tenant_id, db, scope=payload.get("scope", "item"))
            if payload.get("bank_description") and not item.bank_description:
                item.bank_description = payload["bank_description"][:255]
            if payload.get("bank_coupon") and not item.bank_coupon:
                item.bank_coupon = payload["bank_coupon"][:20]

        elif action.op == "delete_item":
            item = await db.get(CreditCardItem, payload["item_id"])
            if item is None:
                skipped.append({"action_id": action.id, "reason": "item_inexistente"})
                continue
            entry = await db.get(ExpenseEntry, item.expense_entry_id) if item.expense_entry_id else None
            action.before = _item_snapshot(item, entry)
            await delete_item_tree(item, db)
            action.item_id = None

        else:  # pragma: no cover
            skipped.append({"action_id": action.id, "reason": f"op desconocida {action.op}"})
            continue

        action.status = ACTION_APPLIED
        action.applied_at = applied_at
        applied.append(action.id)

    stamped = await _stamp_matches(db, session)
    if applied:
        session.status = SESSION_APPLIED
    await db.flush()

    remaining = await _pending_summary(db, session)
    # Sin nada propuesto pendiente, la conciliación está terminada: el estado
    # lo dice acá, centralizado, así la app, el bot y el MCP lo ven igual.
    if applied and not remaining:
        session.status = SESSION_CLOSED
        await db.flush()
    return {
        "applied": len(applied),
        "skipped": skipped,
        "stamped": stamped,
        "propagated_future_cuotas": propagate,
        "pending_groups": remaining,
    }


async def _pending_summary(db: AsyncSession, session: ReconciliationSession) -> dict[str, int]:
    rows = (
        await db.scalars(
            select(ReconciliationAction).where(
                ReconciliationAction.session_id == session.id,
                ReconciliationAction.status == ACTION_PROPOSED,
            )
        )
    ).all()
    summary: dict[str, int] = {}
    for a in rows:
        summary[a.klass] = summary.get(a.klass, 0) + 1
    return summary


async def undo_last_group(db: AsyncSession, session: ReconciliationSession, user) -> dict:
    """Revierte el último grupo aplicado (mismo `applied_at`). Sólo flush."""
    last = await db.scalar(
        select(ReconciliationAction.applied_at)
        .where(
            ReconciliationAction.session_id == session.id,
            ReconciliationAction.status == ACTION_APPLIED,
        )
        .order_by(ReconciliationAction.applied_at.desc())
        .limit(1)
    )
    if last is None:
        raise HTTPException(status_code=400, detail="No hay ningún grupo aplicado para deshacer")

    actions = (
        await db.scalars(
            select(ReconciliationAction).where(
                ReconciliationAction.session_id == session.id,
                ReconciliationAction.status == ACTION_APPLIED,
                ReconciliationAction.applied_at == last,
            ).order_by(ReconciliationAction.id.desc())
        )
    ).all()

    stmt = await db.get(CreditCardStatement, session.statement_id)
    card = await db.get(CreditCard, session.card_id) if session.card_id else None
    undone = 0

    for action in actions:
        before = action.before or {}

        if action.op == "update_statement":
            if stmt is not None:
                stmt.closing_date = (
                    date.fromisoformat(before["closing_date"]) if before.get("closing_date") else None
                )
                stmt.due_date = (
                    date.fromisoformat(before["due_date"]) if before.get("due_date") else None
                )

        elif action.op == "create_item":
            item = await db.get(CreditCardItem, before.get("created_item_id"))
            if item is not None:
                await delete_item_tree(item, db)
            action.item_id = None

        elif action.op == "update_item":
            item = await db.get(CreditCardItem, action.item_id) if action.item_id else None
            snap = before.get("item") or {}
            if item is not None and snap:
                item.description = snap["description"]
                item.amount = Decimal(snap["amount"])
                item.category_id = snap["category_id"]
                item.item_date = date.fromisoformat(snap["item_date"])
                item.bank_description = snap.get("bank_description")
                item.bank_coupon = snap.get("bank_coupon")
                entry_snap = before.get("entry")
                if entry_snap and item.expense_entry_id:
                    entry = await db.get(ExpenseEntry, item.expense_entry_id)
                    if entry is not None:
                        entry.description = entry_snap["description"]
                        entry.amount = Decimal(entry_snap["amount"])
                        entry.expense_date = date.fromisoformat(entry_snap["expense_date"])
                        entry.category_id = entry_snap["category_id"]

        elif action.op == "delete_item":
            snap = before.get("item") or {}
            entry_snap = before.get("entry")
            if snap and card is not None:
                entry = None
                if entry_snap:
                    entry = await create_expense_entry(
                        card,
                        date.fromisoformat(entry_snap["expense_date"]),
                        Decimal(entry_snap["amount"]),
                        entry_snap["description"],
                        entry_snap["category_id"],
                        session.tenant_id,
                        user.id,
                        db,
                        currency=snap["currency"],
                    )
                restored = CreditCardItem(
                    statement_id=snap["statement_id"],
                    description=snap["description"],
                    category_id=snap["category_id"],
                    item_date=date.fromisoformat(snap["item_date"]),
                    item_type=snap["item_type"],
                    amount=Decimal(snap["amount"]),
                    currency=snap["currency"],
                    installment_count=snap.get("installment_count"),
                    installment_number=snap.get("installment_number"),
                    purchase_total=Decimal(snap["purchase_total"]) if snap.get("purchase_total") else None,
                    bank_description=snap.get("bank_description"),
                    bank_coupon=snap.get("bank_coupon"),
                    capture_source=snap.get("capture_source"),
                    expense_entry_id=entry.id if entry else None,
                )
                db.add(restored)
                await db.flush()
                action.item_id = restored.id

        action.status = ACTION_UNDONE
        undone += 1

    await db.flush()
    return {"undone": undone, "pending_groups": await _pending_summary(db, session)}
