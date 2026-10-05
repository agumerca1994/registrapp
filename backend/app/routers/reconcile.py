"""Conciliación de resúmenes de tarjeta: subir el PDF, revisar, aplicar.

El router es una cáscara sobre `services/reconcile` (igual que dashboard
sobre analytics): la lógica vive ahí para que WhatsApp y el MCP no puedan
divergir. Dos reglas de acá:

- **El PDF se procesa en memoria y no se guarda.** Lo persistido es `parsed`.
- **La vista previa es la escritura real deshecha**: `?dry_run=true` ejecuta
  el apply y hace rollback — el patrón del conector MCP, para que la vista
  previa no pueda mentir.
"""


from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.reconciliation import (
    ACTION_PROPOSED,
    ReconciliationAction,
    ReconciliationSession,
    SESSION_NEEDS_AI,
)
from app.models.tenant import Tenant
from app.models.user import User
from app.services import reconcile as reconcile_service
from app.services.rate_limit import enforce_key
from app.services.reconcile import engine as reconcile_engine
from app.services.reconcile import rules as reconcile_rules

router = APIRouter(prefix="/reconcile", tags=["reconcile"])

MAX_PDF_BYTES = 10 * 1024 * 1024


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


async def _owned_session(
    session_id: int, user: User, db: AsyncSession
) -> ReconciliationSession:
    session = await db.scalar(
        select(ReconciliationSession).where(
            ReconciliationSession.id == session_id,
            ReconciliationSession.tenant_id == user.tenant_id,
        )
    )
    if not session:
        raise HTTPException(status_code=404, detail="Sesión no encontrada")
    return session


def _action_out(a: ReconciliationAction) -> dict:
    return {
        "id": a.id,
        "klass": a.klass,
        "op": a.op,
        "item_id": a.item_id,
        "payload": a.payload,
        "status": a.status,
        "applied_at": a.applied_at.isoformat() if a.applied_at else None,
    }


async def _session_out(session: ReconciliationSession, db: AsyncSession) -> dict:
    actions = (
        await db.scalars(
            select(ReconciliationAction)
            .where(ReconciliationAction.session_id == session.id)
            .order_by(ReconciliationAction.id)
        )
    ).all()
    groups: dict[str, list[dict]] = {}
    for a in actions:
        groups.setdefault(a.klass, []).append(_action_out(a))
    parsed = session.parsed or {}
    return {
        "id": session.id,
        "status": session.status,
        "reason": session.reason,
        "channel": session.channel,
        "bank": parsed.get("bank"),
        "bank_id": session.bank_id,
        "card_label": parsed.get("card_label"),
        "cardholder": session.cardholder,
        "card_id": session.card_id,
        "statement_id": session.statement_id,
        "period_year": session.period_year,
        "period_month": session.period_month,
        "closing_date": session.closing_date.isoformat() if session.closing_date else None,
        "due_date": session.due_date.isoformat() if session.due_date else None,
        "totals": session.totals,
        "choices": session.choices,
        "item_count": len(parsed.get("items", [])),
        "excluded": parsed.get("excluded"),
        "excluded_by_rule": parsed.get("excluded_by_rule"),
        "groups": groups,
        "group_order": reconcile_service.GROUP_ORDER,
        "created_at": session.created_at.isoformat() if session.created_at else None,
    }


@router.post("")
async def create_session(
    file: UploadFile = File(...),
    card_id: int | None = None,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    enforce_key(str(user.tenant_id), "reconcile", limit=20, window_seconds=3600)

    pdf_bytes = await file.read()
    if len(pdf_bytes) > MAX_PDF_BYTES:
        raise HTTPException(status_code=413, detail="El PDF supera los 10 MB")
    if not pdf_bytes:
        raise HTTPException(status_code=422, detail="Archivo vacío")

    session = await reconcile_service.start_session(
        db, user=user, pdf_bytes=pdf_bytes, channel="app", card_id=card_id
    )
    await db.commit()

    out = await _session_out(session, db)
    if session.status == SESSION_NEEDS_AI:
        tenant = await db.get(Tenant, user.tenant_id)
        out["plan"] = tenant.plan if tenant else "free"
    return out


@router.get("")
async def list_sessions(
    status: str | None = Query(default=None),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    q = (
        select(ReconciliationSession)
        .where(ReconciliationSession.tenant_id == user.tenant_id)
        .order_by(ReconciliationSession.created_at.desc())
        .limit(50)
    )
    if status:
        q = q.where(ReconciliationSession.status == status)
    sessions = (await db.scalars(q)).all()
    result = []
    for s in sessions:
        pending = await db.scalar(
            select(ReconciliationAction.id).where(
                ReconciliationAction.session_id == s.id,
                ReconciliationAction.status == ACTION_PROPOSED,
            ).limit(1)
        )
        parsed = s.parsed or {}
        result.append({
            "id": s.id,
            "status": s.status,
            "reason": s.reason,
            "bank": parsed.get("bank"),
            "card_id": s.card_id,
            "period_year": s.period_year,
            "period_month": s.period_month,
            "item_count": len(parsed.get("items", [])),
            "has_pending": pending is not None,
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })
    return result


@router.get("/pending")
async def list_pending(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Resúmenes subidos que todavía piden una decisión: alimentan el puntito
    de Tarjetas y la tarjeta "Resúmenes por revisar". Devuelve las filas (no
    un conteo) por el mismo motivo que /shared-expenses/pending: el panel
    necesita los datos y el puntito el número, y dos endpoints contestando
    "cuántos hay" es el par que se desincroniza.

    Declarada ANTES de /{session_id}: Starlette matchea en orden y "pending"
    caería en el parámetro entero como un 422.
    """
    user = await _get_db_user(firebase_user, db)
    sessions = (await db.scalars(
        select(ReconciliationSession)
        .where(
            ReconciliationSession.tenant_id == user.tenant_id,
            ReconciliationSession.status.in_(("ready", "unexplained", "applied", "needs_choice")),
        )
        .order_by(ReconciliationSession.created_at.desc())
        .limit(20)
    )).all()
    result = []
    for s in sessions:
        pending = (await db.scalars(
            select(ReconciliationAction.id).where(
                ReconciliationAction.session_id == s.id,
                ReconciliationAction.status == ACTION_PROPOSED,
            )
        )).all()
        # needs_choice no tiene acciones todavía, pero sí pide una decisión.
        if not pending and s.status != "needs_choice":
            continue
        parsed = s.parsed or {}
        result.append({
            "id": s.id,
            "status": s.status,
            "bank": parsed.get("bank"),
            "card_id": s.card_id,
            "period_year": s.period_year,
            "period_month": s.period_month,
            "pending_count": len(pending),
            "created_at": s.created_at.isoformat() if s.created_at else None,
        })
    return result


@router.get("/{session_id}")
async def get_session(
    session_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    session = await _owned_session(session_id, user, db)
    return await _session_out(session, db)


class NewCardBody(BaseModel):
    alias: str
    bank: str | None = None
    last_4_digits: str | None = None


class ChooseBody(BaseModel):
    card_id: int | None = None
    statement_id: int | None = None
    save_card_rule: bool = False
    # El resumen puede ser de una tarjeta que todavía no está cargada: crearla
    # acá evita el viaje a /tarjetas y volver a subir el PDF.
    new_card: NewCardBody | None = None


@router.post("/{session_id}/choose")
async def choose(
    session_id: int,
    body: ChooseBody,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    session = await _owned_session(session_id, user, db)
    if session.status == SESSION_NEEDS_AI:
        raise HTTPException(status_code=409, detail="Esta sesión no pudo leerse; no hay nada que elegir")

    card_id = body.card_id
    if body.new_card is not None:
        from app.models.credit_card import CreditCard

        alias = body.new_card.alias.strip()
        if not alias:
            raise HTTPException(status_code=422, detail="La tarjeta nueva necesita un alias")
        card = CreditCard(
            tenant_id=user.tenant_id,
            user_id=user.id,
            bank=(body.new_card.bank or (session.parsed or {}).get("bank") or "")[:100] or "—",
            alias=alias[:100],
            last_4_digits=(body.new_card.last_4_digits or "")[:4] or None,
        )
        db.add(card)
        await db.flush()
        card_id = card.id

    await reconcile_service.resolve_session(
        db, session, user,
        explicit_card_id=card_id,
        explicit_statement_id=body.statement_id,
        save_card_rule=body.save_card_rule,
    )
    await db.commit()
    return await _session_out(session, db)


class ActionPatch(BaseModel):
    category_id: int | None = None
    description: str | None = None
    discard: bool = False
    # Al elegir categoría, ofrecer guardar la regla comercio→categoría.
    save_merchant_rule: bool = False


@router.patch("/{session_id}/actions/{action_id}")
async def patch_action(
    session_id: int,
    action_id: int,
    body: ActionPatch,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    session = await _owned_session(session_id, user, db)
    action = await db.scalar(
        select(ReconciliationAction).where(
            ReconciliationAction.id == action_id,
            ReconciliationAction.session_id == session.id,
        )
    )
    if not action:
        raise HTTPException(status_code=404, detail="Acción no encontrada")
    if action.status != ACTION_PROPOSED:
        raise HTTPException(status_code=409, detail="La acción ya no está propuesta")

    if body.discard:
        action.status = "discarded"
    else:
        payload = dict(action.payload or {})
        if body.category_id is not None:
            payload["category_id"] = body.category_id
            payload["category_source"] = "user"
        if body.description is not None:
            payload["description"] = body.description[:255]
        action.payload = payload
        if body.save_merchant_rule and body.category_id is not None and payload.get("bank_description"):
            await reconcile_rules.save_rule(
                db, user.tenant_id, reconcile_rules.KIND_MERCHANT_CATEGORY,
                reconcile_rules.merchant_key(payload["bank_description"]),
                {"category_id": body.category_id,
                 "description": body.description or payload.get("description")},
            )
    await db.commit()
    return _action_out(action)


@router.post("/{session_id}/groups/{klass}/apply")
async def apply_group(
    session_id: int,
    klass: str,
    dry_run: bool = Query(default=False),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    session = await _owned_session(session_id, user, db)
    result = await reconcile_service.apply_group(db, session, user, klass)
    if dry_run:
        await db.rollback()
        return {"dry_run": True, **result}
    await db.commit()
    return {"dry_run": False, **result}


@router.post("/{session_id}/undo")
async def undo(
    session_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    session = await _owned_session(session_id, user, db)
    result = await reconcile_service.undo_last_group(db, session, user)
    await db.commit()
    return result


@router.post("/{session_id}/interest")
async def register_interest(
    session_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """El botón "Me interesa" de una sesión que necesitaría IA: el embudo que
    mide demanda real antes de construir (o cobrar) el análisis con IA."""
    user = await _get_db_user(firebase_user, db)
    session = await _owned_session(session_id, user, db)
    await reconcile_engine.record_event(
        db,
        tenant_id=user.tenant_id,
        user_id=user.id,
        channel=session.channel,
        input_kind="pdf",
        outcome="interest",
        reason=session.reason,
        bank_detected=session.bank_id,
    )
    await db.commit()
    return {"ok": True}


@router.delete("/{session_id}")
async def delete_session(
    session_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Borra la sesión (no toca nada ya aplicado — los ítems quedan)."""
    user = await _get_db_user(firebase_user, db)
    session = await _owned_session(session_id, user, db)
    await db.delete(session)
    await db.commit()
    return {"ok": True}
