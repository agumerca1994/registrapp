import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.services import notify_shared, participants, whatsapp
from app.services import shared_expenses as shared_service
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.user import User
from app.schemas.shared_expense import (
    ConvertToArsBody,
    InviteInfoOut,
    SharedExpenseCreate,
    SharedExpenseOut,
    SharedExpenseUpdate,
)

router = APIRouter(prefix="/shared-expenses", tags=["shared-expenses"])
logger = logging.getLogger(__name__)


# Estos helpers viven ahora en services/participants.py — se movieron junto con
# la resolución de participantes, que `credit_cards.py` duplicaba.
#
# Se re-exportan con sus nombres privados originales a propósito: siete módulos
# los importan desde acá (auth, contacts, reminders, credit_cards,
# internal_logs) y CLAUDE.md documenta `_normalize_phone` por esta ruta.
# Renombrar en el mismo commit que mueve el código convierte un refactor
# mecánico en una cacería de imports rotos.
_is_email = participants.is_email
_is_phone = participants.is_phone
_normalize_phone = participants.normalize_phone
_phone_lookup_values = participants.phone_lookup_values
_find_user_by_phone = participants.find_user_by_phone
_find_user_by_email = participants.find_user_by_email
_invite_lookup_values = participants.invite_lookup_values

# Las consultas y escrituras de compartidos viven en services/shared_expenses.py
# (las usa también el conector MCP). Mismos nombres privados de siempre porque
# credit_cards, internal_logs y este mismo archivo los importan así.
_my_split = shared_service.my_split
_consume_invite = shared_service.consume_invite
_load_q = shared_service.load_q
_pending_q = shared_service.pending_q
_out = shared_service.out
_get_or_create_shared_category = shared_service.get_or_create_shared_category
_find_group_shared_ids = shared_service.find_group_shared_ids
_find_future_group_shared_ids = shared_service.find_future_group_shared_ids
_accept_split = shared_service.accept_one_split


# `_save_tenant_contact` se fue a services/contacts.upsert_contact: guardaba
# sólo teléfonos en `tenant_contacts`, que no tenía dónde poner un mail — y ése
# era el único motivo de que "Elegir de la agenda" nunca mostrara un contacto
# de mail.


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


# Los enviadores de WhatsApp viven ahora en services/whatsapp.py: los usan
# auth.py (OTP) y reminders.py (recordatorios diarios), que no tienen nada que
# ver con gastos compartidos. Se re-exportan con los nombres privados por la
# misma razón que los helpers de participantes.
_resolve_whatsapp_jid = whatsapp.resolve_whatsapp_jid
_send_wa_msg = whatsapp.send_wa_msg
_send_whatsapp_invite = whatsapp.send_whatsapp_invite
_send_whatsapp_member_notify = whatsapp.send_whatsapp_member_notify


@router.get("", response_model=list[SharedExpenseOut])
async def list_shared_expenses(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(_load_q(user))
    return [_out(shared, user) for shared in result.all()]


@router.get("/pending", response_model=list[SharedExpenseOut])
async def list_pending_for_me(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """The expenses waiting on this user's accept/reject, newest first.

    Feeds both the first-login dialog and the nav dot. It returns the rows
    rather than a bare count on purpose: the dialog needs the amounts and the
    dot needs the number, and two endpoints answering "how many are pending"
    is exactly the pair that drifts apart.
    """
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(_pending_q(user))
    return [_out(shared, user) for shared in result.all()]


@router.post("", response_model=SharedExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_shared_expense(
    body: SharedExpenseCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    created = await shared_service.create_shared(user, body, db)
    await db.commit()

    # Avisos, después del commit. El mismo servicio que usa el compartir de
    # tarjetas, para que las dos vías avisen igual.
    await notify_shared.notify_share(
        db,
        creator=user,
        title=body.title,
        total_amount=body.total_amount,
        notify=created.notify,
        invites=created.invites,
        currency=body.currency,
    )

    result = await db.scalar(
        _load_q(user).where(SharedExpense.id == created.shared.id)
    )
    return _out(result, user)


@router.patch("/{shared_id}", response_model=SharedExpenseOut)
async def update_shared_expense(
    shared_id: int,
    body: SharedExpenseUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ver `services/shared_expenses.update_shared`."""
    user = await _get_db_user(firebase_user, db)
    await shared_service.update_shared(user, shared_id, body, db)
    await db.commit()
    result = await db.scalar(_load_q(user).where(SharedExpense.id == shared_id))
    return _out(result, user)


@router.post("/{shared_id}/convert-to-ars", response_model=SharedExpenseOut)
async def convert_to_ars(
    shared_id: int,
    body: ConvertToArsBody,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ver `services/shared_expenses.convert_shared`."""
    user = await _get_db_user(firebase_user, db)
    await shared_service.convert_shared(user, shared_id, body, db)
    await db.commit()
    result = await db.scalar(_load_q(user).where(SharedExpense.id == shared_id))
    return _out(result, user)


@router.delete("/{shared_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shared_expense(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ver `services/shared_expenses.delete_shared`."""
    user = await _get_db_user(firebase_user, db)
    await shared_service.delete_shared(user, shared_id, db)
    await db.commit()


@router.post("/{shared_id}/accept", response_model=SharedExpenseOut)
async def accept_split(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ver `services/shared_expenses.accept_shared`."""
    user = await _get_db_user(firebase_user, db)
    await shared_service.accept_shared(user, shared_id, db)
    await db.commit()
    result = await db.scalar(_load_q(user).where(SharedExpense.id == shared_id))
    return _out(result, user)


@router.post("/{shared_id}/reject", response_model=SharedExpenseOut)
async def reject_split(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Ver `services/shared_expenses.reject_shared`."""
    user = await _get_db_user(firebase_user, db)
    await shared_service.reject_shared(user, shared_id, db)
    await db.commit()
    result = await db.scalar(_load_q(user).where(SharedExpense.id == shared_id))
    return _out(result, user)


@router.get("/invite/{token}", response_model=InviteInfoOut)
async def get_invite_info(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    split = await db.scalar(
        select(SharedExpenseSplit)
        .where(
            SharedExpenseSplit.invite_token == token,
            SharedExpenseSplit.user_id.is_(None),
        )
        .options(selectinload(SharedExpenseSplit.shared_expense))
    )
    if not split:
        raise HTTPException(status_code=404, detail="Invitacion no encontrada o ya reclamada")
    if split.invite_expires_at and split.invite_expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="La invitacion ha expirado")

    shared = split.shared_expense
    creator = await db.get(User, shared.created_by_user_id)
    creator_name = creator.display_name or creator.email if creator else "Desconocido"

    group_ids = [shared.id] + await _find_group_shared_ids(shared, shared.id, db)
    cuotas_count = len(group_ids)
    cuotas_total_amount = None
    if cuotas_count > 1:
        amounts = await db.scalars(
            select(SharedExpenseSplit.amount).where(
                SharedExpenseSplit.shared_expense_id.in_(group_ids),
                SharedExpenseSplit.invite_email == split.invite_email,
            )
        )
        cuotas_total_amount = sum(amounts.all())

    return InviteInfoOut(
        shared_expense_id=shared.id,
        title=shared.title,
        total_amount=shared.total_amount,
        currency=shared.currency,
        split_amount=split.amount,
        expense_date=shared.expense_date,
        creator_name=creator_name,
        cuotas_count=cuotas_count,
        cuotas_total_amount=cuotas_total_amount,
    )


@router.post("/invite/{token}/claim", response_model=SharedExpenseOut)
async def claim_invite(
    token: str,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    split = await db.scalar(
        select(SharedExpenseSplit)
        .where(
            SharedExpenseSplit.invite_token == token,
            SharedExpenseSplit.user_id.is_(None),
        )
        .options(selectinload(SharedExpenseSplit.shared_expense))
    )
    if not split:
        raise HTTPException(status_code=404, detail="Invitacion no encontrada o ya reclamada")
    if split.invite_expires_at and split.invite_expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="La invitacion ha expirado")

    # Auto-accept: create ExpenseEntry immediately (same as accept flow)
    shared = split.shared_expense
    invite_email = split.invite_email
    await _accept_split(user, shared, split, db)

    # Installment purchases: the invite link is only ever sent for the root
    # cuota, so claiming it must sweep up every sibling cuota's matching
    # (still-unclaimed) split in one shot — otherwise the guest would be stuck
    # re-claiming a token that was never sent for each future month.
    if invite_email:
        for sib_id in await _find_group_shared_ids(shared, shared.id, db):
            sib_shared = await db.scalar(
                select(SharedExpense).where(SharedExpense.id == sib_id)
                .options(selectinload(SharedExpense.splits))
            )
            sib_split = next(
                (s for s in sib_shared.splits if s.invite_email == invite_email and s.user_id is None),
                None,
            )
            if sib_split:
                await _accept_split(user, sib_shared, sib_split, db)

    await db.commit()

    result = await db.scalar(
        _load_q(user).where(
            SharedExpense.id == split.shared_expense_id
        )
    )
    return _out(result, user)