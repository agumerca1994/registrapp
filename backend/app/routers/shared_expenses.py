import logging
import re
import secrets
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.user import User
from app.schemas.shared_expense import (
    InviteInfoOut,
    SharedExpenseCreate,
    SharedExpenseOut,
)

router = APIRouter(prefix="/shared-expenses", tags=["shared-expenses"])
logger = logging.getLogger(__name__)


def _is_email(value: str) -> bool:
    return "@" in value


def _is_phone(value: str) -> bool:
    cleaned = re.sub(r"[\s\-().]", "", value)
    return bool(re.match(r"^\+?\d{7,15}$", cleaned))


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


def _load_q(user_id: int, tenant_id: int):
    return (
        select(SharedExpense)
        .where(
            or_(
                SharedExpense.tenant_id == tenant_id,
                exists(
                    select(SharedExpenseSplit.id).where(
                        SharedExpenseSplit.shared_expense_id == SharedExpense.id,
                        SharedExpenseSplit.user_id == user_id,
                    )
                ),
            )
        )
        .options(selectinload(SharedExpense.splits))
        .order_by(SharedExpense.expense_date.desc(), SharedExpense.created_at.desc())
    )


async def _get_or_create_shared_category(tenant_id: int, db: AsyncSession) -> int:
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            ExpenseCategory.name == "Gasto compartido",
        )
    )
    if not cat:
        cat = ExpenseCategory(tenant_id=tenant_id, name="Gasto compartido", color="#6366f1")
        db.add(cat)
        await db.flush()
    return cat.id


async def _send_wa_msg(phone: str, msg: str) -> None:
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        logger.info("Evolution API not configured, skipping WhatsApp send")
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.EVOLUTION_API_URL}/message/sendText/{settings.EVOLUTION_INSTANCE}",
                json={"number": phone, "text": msg},
                headers={"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"},
            )
            if resp.status_code >= 400:
                logger.warning(f"WhatsApp send failed {resp.status_code} to {phone}: {resp.text[:300]}")
            else:
                logger.info(f"WhatsApp sent to {phone}: {resp.status_code}")
    except Exception as e:
        logger.warning(f"WhatsApp send error to {phone}: {e}")


async def _send_whatsapp_invite(phone: str, creator_name: str, title: str, amount, token: str) -> None:
    link = f"{settings.FRONTEND_URL}/invite/{token}"
    msg = (
        f"Hola! {creator_name} te invito a compartir un gasto: '{title}' "
        f"por ${amount}.\n\nEntra al link para verlo y aceptarlo:\n{link}"
    )
    await _send_wa_msg(phone, msg)


async def _send_whatsapp_member_notify(phone: str, creator_name: str, title: str, total_amount, split_amount) -> None:
    app_url = f"{settings.FRONTEND_URL}/shared"
    msg = (
        f"Hola! {creator_name} te compartio el gasto '{title}' "
        f"por ${total_amount}.\nTu parte: ${split_amount}.\n"
        f"Ingresa a la app para aceptarlo: {app_url}"
    )
    await _send_wa_msg(phone, msg)

@router.get("", response_model=list[SharedExpenseOut])
async def list_shared_expenses(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(_load_q(user.id, user.tenant_id))
    return result.all()


@router.post("", response_model=SharedExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_shared_expense(
    body: SharedExpenseCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    shared = SharedExpense(
        tenant_id=user.tenant_id,
        created_by_user_id=user.id,
        title=body.title,
        total_amount=body.total_amount,
        category_id=body.category_id,
        split_type=body.split_type,
        expense_date=body.expense_date,
    )
    db.add(shared)
    await db.flush()

    pending_wa_invites = []    # (phone, token) for unregistered externals
    pending_wa_notify = []     # user_id for registered members to notify

    for split_in in body.splits:
        is_creator = split_in.user_id == user.id

        resolved_user_id = split_in.user_id
        resolved_name = split_in.member_name
        invite_token = None
        invite_email = None  # stores email OR phone in this column
        invite_expires_at = None

        if split_in.invite_contact and not split_in.user_id:
            contact = split_in.invite_contact.strip()
            if _is_email(contact):
                # Look up existing user by email
                found = await db.scalar(select(User).where(User.email == contact))
                if found:
                    resolved_user_id = found.id
                    resolved_name = found.display_name or found.email
                    if found.id != user.id:
                        pending_wa_notify.append(found.id)
                else:
                    invite_email = contact
                    invite_token = secrets.token_urlsafe(32)
                    invite_expires_at = datetime.utcnow() + timedelta(days=30)
            elif _is_phone(contact):
                # Look up existing user by whatsapp_phone
                found = await db.scalar(select(User).where(User.whatsapp_phone == contact))
                if found:
                    resolved_user_id = found.id
                    resolved_name = found.display_name or found.email
                    if found.id != user.id:
                        pending_wa_notify.append(found.id)
                else:
                    invite_email = contact  # store phone in invite_email column
                    invite_token = secrets.token_urlsafe(32)
                    invite_expires_at = datetime.utcnow() + timedelta(days=30)
                    # Queue WhatsApp invite to send after flush
                    pending_wa_invites.append((contact, invite_token))
        elif split_in.user_id and split_in.user_id != user.id:
            # Direct member selection — queue WhatsApp notification if they have phone
            pending_wa_notify.append(split_in.user_id)

        is_external = resolved_user_id is None and not invite_token

        split = SharedExpenseSplit(
            shared_expense_id=shared.id,
            user_id=resolved_user_id,
            member_name=resolved_name,
            amount=split_in.amount,
            status="accepted" if (is_creator or is_external) else "pending",
            invite_email=invite_email,
            invite_token=invite_token,
            invite_expires_at=invite_expires_at,
        )
        db.add(split)
        await db.flush()

        if is_creator:
            entry = ExpenseEntry(
                tenant_id=user.tenant_id,
                user_id=user.id,
                category_id=body.category_id,
                amount=split_in.amount,
                description=body.title,
                expense_date=body.expense_date,
                notes=f"Gasto compartido #{shared.id}",
            )
            db.add(entry)
            await db.flush()
            split.expense_entry_id = entry.id

    await db.commit()

    # Send WhatsApp notifications after commit
    creator_name = user.display_name or user.email
    for phone, token in pending_wa_invites:
        await _send_whatsapp_invite(phone, creator_name, body.title, body.total_amount, token)

    # Notify registered members (if they have WhatsApp linked)
    for notify_uid in pending_wa_notify:
        notify_user = await db.get(User, notify_uid)
        if notify_user and notify_user.whatsapp_phone:
            split_row = next(
                (s for s in body.splits if getattr(s, "user_id", None) == notify_uid),
                None,
            )
            split_amt = split_row.amount if split_row else body.total_amount
            await _send_whatsapp_member_notify(
                notify_user.whatsapp_phone, creator_name, body.title, body.total_amount, split_amt
            )

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(SharedExpense.id == shared.id)
    )
    return result


@router.delete("/{shared_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shared_expense(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id, SharedExpense.tenant_id == user.tenant_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")
    if shared.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail="Solo el creador puede eliminar este gasto")

    entry_ids = [s.expense_entry_id for s in shared.splits if s.expense_entry_id is not None]
    for eid in entry_ids:
        entry = await db.get(ExpenseEntry, eid)
        if entry:
            await db.delete(entry)

    await db.delete(shared)
    await db.commit()


@router.post("/{shared_id}/accept", response_model=SharedExpenseOut)
async def accept_split(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")

    split = next(
        (s for s in shared.splits if s.user_id == user.id and s.status == "pending"),
        None,
    )
    if not split:
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    if shared.tenant_id != user.tenant_id:
        category_id = await _get_or_create_shared_category(user.tenant_id, db)
    else:
        category_id = shared.category_id

    entry = ExpenseEntry(
        tenant_id=user.tenant_id,
        user_id=user.id,
        category_id=category_id,
        amount=split.amount,
        description=shared.title,
        expense_date=shared.expense_date,
        notes=f"Gasto compartido #{shared.id}",
    )
    db.add(entry)
    await db.flush()

    split.expense_entry_id = entry.id
    split.status = "accepted"

    if user.id != shared.created_by_user_id and not shared.locked:
        shared.locked = True

    await db.commit()

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(SharedExpense.id == shared_id)
    )
    return result


@router.post("/{shared_id}/reject", response_model=SharedExpenseOut)
async def reject_split(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")

    split = next(
        (s for s in shared.splits if s.user_id == user.id and s.status == "pending"),
        None,
    )
    if not split:
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    split.status = "rejected"
    await db.commit()

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(SharedExpense.id == shared_id)
    )
    return result


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

    return InviteInfoOut(
        shared_expense_id=shared.id,
        title=shared.title,
        total_amount=shared.total_amount,
        split_amount=split.amount,
        expense_date=shared.expense_date,
        creator_name=creator_name,
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

    split.user_id = user.id
    split.member_name = user.display_name or user.email
    split.invite_token = None
    split.invite_expires_at = None

    # Auto-accept: create ExpenseEntry immediately (same as accept flow)
    shared = split.shared_expense
    if shared.tenant_id != user.tenant_id:
        category_id = await _get_or_create_shared_category(user.tenant_id, db)
    else:
        category_id = shared.category_id

    entry = ExpenseEntry(
        tenant_id=user.tenant_id,
        user_id=user.id,
        category_id=category_id,
        amount=split.amount,
        description=shared.title,
        expense_date=shared.expense_date,
        notes=f"Gasto compartido #{shared.id}",
    )
    db.add(entry)
    await db.flush()
    split.expense_entry_id = entry.id
    split.status = "accepted"

    if user.id != shared.created_by_user_id and not shared.locked:
        shared.locked = True

    await db.commit()

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(
            SharedExpense.id == split.shared_expense_id
        )
    )
    return result