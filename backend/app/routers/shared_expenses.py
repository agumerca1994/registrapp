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
from app.models.contact import TenantContact
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


def _normalize_phone(value: str) -> str:
    """Normalize phone to international format with + prefix.
    Handles: +549351234567, 9351234567, 351234567, +54 9 351 234567, etc.
    Returns: +549351234567 (for Argentina examples)
    """
    digits = re.sub(r"\D", "", value)

    # Common country code prefixes: 54 (AR), 598 (UY), 56 (CL), 55 (BR), 595 (PY)
    known_prefixes = ["595", "598", "54", "56", "55"]

    for prefix in known_prefixes:
        if digits.startswith(prefix):
            remainder = digits[len(prefix):]
            # Argentina mobile numbers require a 9 right after the country code
            # for WhatsApp — insert it if the caller didn't already include it.
            if prefix == "54" and not remainder.startswith("9"):
                remainder = "9" + remainder
            return f"+{prefix}{remainder}"

    # No recognized prefix — assume a bare Argentine local number
    if len(digits) >= 9:
        return f"+549{digits}"

    # Fallback: just add + prefix
    return f"+{digits}" if digits else ""


async def _save_tenant_contact(tenant_id: int, name: str, phone: str, db: AsyncSession) -> None:
    """Save a phone contact to the household agenda, skipping if that phone is already saved."""
    existing = await db.scalar(
        select(TenantContact).where(
            TenantContact.tenant_id == tenant_id,
            TenantContact.contact_phone == phone,
        )
    )
    if existing:
        return
    db.add(TenantContact(tenant_id=tenant_id, contact_name=name.strip() or phone, contact_phone=phone))


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


async def _find_group_shared_ids(shared: SharedExpense, exclude_id: int, db: AsyncSession) -> list[int]:
    """All SharedExpense ids in the same installment-cuota group as `shared`
    (root + every child cuota), excluding `exclude_id` (the one already handled).
    """
    root_id = shared.installment_group_id or shared.id
    rows = await db.scalars(
        select(SharedExpense.id).where(
            or_(SharedExpense.id == root_id, SharedExpense.installment_group_id == root_id),
            SharedExpense.id != exclude_id,
        )
    )
    return list(rows.all())


async def _accept_split(user: User, shared: SharedExpense, split: SharedExpenseSplit, db: AsyncSession) -> None:
    """Accept a single split: create its ExpenseEntry, mark accepted, lock the
    shared expense. Assumes the caller already validated the split is claimable
    by `user` (pending + belongs to them, or an unclaimed invite by phone/email).
    """
    category_id = (
        shared.category_id if shared.tenant_id == user.tenant_id
        else await _get_or_create_shared_category(user.tenant_id, db)
    )
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

    split.user_id = user.id
    split.member_name = user.display_name or user.email
    split.invite_token = None
    split.invite_expires_at = None
    split.expense_entry_id = entry.id
    split.status = "accepted"

    if user.id != shared.created_by_user_id and not shared.locked:
        shared.locked = True


async def _resolve_whatsapp_jid(client: httpx.AsyncClient, phone: str) -> str | None:
    """Ask Evolution's dedicated /chat/whatsappNumbers lookup for the canonical
    number before sending. sendText's own internal existence check is stricter
    (and buggier) than this endpoint — it rejects numbers this lookup happily
    resolves, e.g. Argentine mobiles that already include the required 9.
    """
    digits = re.sub(r"\D", "", phone)
    try:
        resp = await client.post(
            f"{settings.EVOLUTION_API_URL}/chat/whatsappNumbers/{settings.EVOLUTION_INSTANCE}",
            json={"numbers": [digits]},
            headers={"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"},
        )
        if resp.status_code < 400:
            data = resp.json()
            if data and data[0].get("exists"):
                return data[0]["jid"].split("@")[0]
    except Exception:
        pass
    return None


async def _send_wa_msg(phone: str, msg: str) -> None:
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        logger.info("Evolution API not configured, skipping WhatsApp send")
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resolved = await _resolve_whatsapp_jid(client, phone)
            target = resolved or phone.lstrip("+")
            resp = await client.post(
                f"{settings.EVOLUTION_API_URL}/message/sendText/{settings.EVOLUTION_INSTANCE}",
                json={"number": target, "text": msg},
                headers={"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"},
            )
            if resp.status_code >= 400:
                logger.warning(f"WhatsApp send failed {resp.status_code} to {phone} (resolved {target}): {resp.text[:300]}")
            else:
                logger.info(f"WhatsApp sent to {phone} (resolved {target}): {resp.status_code}")
    except Exception as e:
        logger.warning(f"WhatsApp send error to {phone}: {e}")


async def _send_whatsapp_invite(phone: str, creator_name: str, title: str, amount, token: str, cuotas_count: int = 1) -> None:
    link = f"{settings.FRONTEND_URL}/invite/{token}"
    if cuotas_count > 1:
        msg = (
            f"Hola! {creator_name} te invito a compartir un gasto: '{title}' "
            f"en {cuotas_count} cuotas de ${amount} c/u.\n\nEntra al link para ver el detalle y aceptarlas:\n{link}"
        )
    else:
        msg = (
            f"Hola! {creator_name} te invito a compartir un gasto: '{title}' "
            f"por ${amount}.\n\nEntra al link para verlo y aceptarlo:\n{link}"
        )
    await _send_wa_msg(phone, msg)


async def _send_whatsapp_member_notify(phone: str, creator_name: str, title: str, total_amount, split_amount, cuotas_count: int = 1) -> None:
    app_url = f"{settings.FRONTEND_URL}/shared"
    if cuotas_count > 1:
        msg = (
            f"Hola! {creator_name} te compartio el gasto '{title}' "
            f"en {cuotas_count} cuotas de ${total_amount} c/u.\nTu parte por cuota: ${split_amount}.\n"
            f"Ingresa a la app para aceptarlas: {app_url}"
        )
    else:
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
                normalized_phone = _normalize_phone(contact)
                # Look up existing user by whatsapp_phone
                found = await db.scalar(select(User).where(User.whatsapp_phone == normalized_phone))
                if found:
                    resolved_user_id = found.id
                    resolved_name = found.display_name or found.email
                    if found.id != user.id:
                        pending_wa_notify.append(found.id)
                else:
                    invite_email = normalized_phone  # store normalized phone in invite_email column
                    invite_token = secrets.token_urlsafe(32)
                    invite_expires_at = datetime.utcnow() + timedelta(days=30)
                    # Queue WhatsApp invite to send after flush
                    pending_wa_invites.append((normalized_phone, invite_token))
                await _save_tenant_contact(user.tenant_id, resolved_name, normalized_phone, db)
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

    await _accept_split(user, shared, split, db)

    # Installment purchases: accepting one cuota accepts the whole plan in one go.
    for sib_id in await _find_group_shared_ids(shared, shared.id, db):
        sib_shared = await db.scalar(
            select(SharedExpense).where(SharedExpense.id == sib_id)
            .options(selectinload(SharedExpense.splits))
        )
        sib_split = next(
            (s for s in sib_shared.splits if s.user_id == user.id and s.status == "pending"),
            None,
        )
        if sib_split:
            await _accept_split(user, sib_shared, sib_split, db)

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

    for sib_id in await _find_group_shared_ids(shared, shared.id, db):
        sib_split = await db.scalar(
            select(SharedExpenseSplit).where(
                SharedExpenseSplit.shared_expense_id == sib_id,
                SharedExpenseSplit.user_id == user.id,
                SharedExpenseSplit.status == "pending",
            )
        )
        if sib_split:
            sib_split.status = "rejected"

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
        _load_q(user.id, user.tenant_id).where(
            SharedExpense.id == split.shared_expense_id
        )
    )
    return result