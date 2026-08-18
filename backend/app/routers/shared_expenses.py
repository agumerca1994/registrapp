import logging
import re
import secrets
from datetime import date, datetime, timedelta
from decimal import Decimal

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, or_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.firebase import get_current_user
from app.services import push
from app.models.contact import TenantContact
from app.models.credit_card import CreditCardItem
from app.models.expense import ExpenseCategory, ExpenseEntry
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


def _phone_lookup_values(phone: str | None) -> list[str]:
    """Every spelling `User.whatsapp_phone` might be stored in for this number.

    Rows written before `/auth/me/verify-whatsapp` started normalizing kept the
    raw input, which for most users means no leading `+`. Matching only the
    normalized form silently misses those accounts, and a missed match doesn't
    fail loudly — it downgrades the share into an invite token that lives only
    inside the WhatsApp message, invisible in the recipient's app.
    """
    digits = re.sub(r"\D", "", phone or "")
    if not digits:
        return []
    return [f"+{digits}", digits]


async def _find_user_by_phone(phone: str, db: AsyncSession) -> User | None:
    values = _phone_lookup_values(phone)
    if not values:
        return None
    return await db.scalar(select(User).where(User.whatsapp_phone.in_(values)))


async def _find_user_by_email(email: str, db: AsyncSession) -> User | None:
    """Case-insensitive on purpose — same failure mode as the phone lookup:
    an exact-match miss costs the recipient in-app visibility, not an error.
    """
    return await db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


def _invite_lookup_values(user: User) -> list[str]:
    """What an unclaimed invite's `invite_email` (which holds an email OR a
    normalized phone) could contain for this user. Lowercased — the creator
    typed the address by hand, so its casing is not to be trusted; comparisons
    against this list must lowercase the stored side too. Phone spellings are
    unaffected by `lower()`.
    """
    values = _phone_lookup_values(user.whatsapp_phone)
    if user.email:
        values.append(user.email.strip().lower())
    return values


def _my_split(user: User, splits: list["SharedExpenseSplit"]) -> "SharedExpenseSplit | None":
    """The split that belongs to `user` — either already linked to their
    account, or still an unclaimed invite addressed to their email/phone.
    """
    own = next((s for s in splits if s.user_id == user.id), None)
    if own:
        return own
    values = _invite_lookup_values(user)
    if not values:
        return None
    return next(
        (s for s in splits
         if s.user_id is None and (s.invite_email or "").strip().lower() in values),
        None,
    )


def _consume_invite(user: User, split: SharedExpenseSplit) -> None:
    """Bind an unclaimed invite to `user` without accepting it. Needed on
    reject: leaving the token alive means the WhatsApp link still works and
    silently re-accepts what they just turned down.
    """
    if split.user_id is None:
        split.user_id = user.id
        split.member_name = user.display_name or user.email
    split.invite_token = None
    split.invite_expires_at = None


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


def _load_q(user: User):
    visible = [
        SharedExpense.tenant_id == user.tenant_id,
        exists(
            select(SharedExpenseSplit.id).where(
                SharedExpenseSplit.shared_expense_id == SharedExpense.id,
                SharedExpenseSplit.user_id == user.id,
            )
        ),
    ]
    # Invites addressed to this user that nobody claimed yet. Without this the
    # expense exists for them only inside the WhatsApp link, which is what
    # produces the "nunca me llegó" reports — it did arrive, they just never
    # clicked it, and the app had no way to show them that.
    invite_values = _invite_lookup_values(user)
    if invite_values:
        visible.append(
            exists(
                select(SharedExpenseSplit.id).where(
                    SharedExpenseSplit.shared_expense_id == SharedExpense.id,
                    SharedExpenseSplit.user_id.is_(None),
                    SharedExpenseSplit.invite_token.is_not(None),
                    func.lower(SharedExpenseSplit.invite_email).in_(invite_values),
                )
            )
        )
    return (
        select(SharedExpense)
        .where(or_(*visible))
        .options(selectinload(SharedExpense.splits))
        .order_by(SharedExpense.expense_date.desc(), SharedExpense.created_at.desc())
    )


def _pending_q(user: User):
    """Expenses whose split for `user` is still undecided.

    Same ownership rules as `_load_q` — their own split, or an unclaimed invite
    addressed to their email/phone — narrowed to `status == "pending"`.

    Note what is deliberately *absent*: `_load_q` ORs in
    `tenant_id == user.tenant_id`, so everyone in a household sees every shared
    expense in it. That is right for the list screen and wrong here — a
    housemate's undecided split is not yours to accept, and including it would
    make the nav dot light up for a decision the user cannot take.
    """
    mine_pending = [
        exists(
            select(SharedExpenseSplit.id).where(
                SharedExpenseSplit.shared_expense_id == SharedExpense.id,
                SharedExpenseSplit.user_id == user.id,
                SharedExpenseSplit.status == "pending",
            )
        )
    ]
    invite_values = _invite_lookup_values(user)
    if invite_values:
        mine_pending.append(
            exists(
                select(SharedExpenseSplit.id).where(
                    SharedExpenseSplit.shared_expense_id == SharedExpense.id,
                    SharedExpenseSplit.user_id.is_(None),
                    SharedExpenseSplit.invite_token.is_not(None),
                    SharedExpenseSplit.status == "pending",
                    func.lower(SharedExpenseSplit.invite_email).in_(invite_values),
                )
            )
        )
    return (
        select(SharedExpense)
        .where(or_(*mine_pending))
        .options(selectinload(SharedExpense.splits))
        .order_by(SharedExpense.expense_date.desc(), SharedExpense.created_at.desc())
    )


def _out(shared: SharedExpense, user: User) -> SharedExpenseOut:
    """Serialize for `user`: flag which split is theirs, and hide invite tokens
    they have no business holding. Anyone who can see the expense can see every
    split, and a token alone is enough to claim the split it belongs to — so
    only the creator (who re-sends the links) and the invitee themselves get
    the real value.
    """
    out = SharedExpenseOut.model_validate(shared)
    mine = _my_split(user, shared.splits)
    is_creator = shared.created_by_user_id == user.id
    for split_out in out.splits:
        if mine is not None and split_out.id == mine.id:
            split_out.mine = True
        elif not is_creator:
            split_out.invite_token = None
    return out


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


async def _find_future_group_shared_ids(shared: SharedExpense, db: AsyncSession) -> list[int]:
    """Root + child cuotas in the same installment group as `shared` whose
    expense_date >= today. Includes `shared.id` itself if it qualifies. Keep
    separate from `_find_group_shared_ids` (used by accept/reject/claim, which
    must stay unfiltered by date and excludes the anchor).
    """
    root_id = shared.installment_group_id or shared.id
    rows = await db.scalars(
        select(SharedExpense.id).where(
            or_(SharedExpense.id == root_id, SharedExpense.installment_group_id == root_id),
            SharedExpense.expense_date >= date.today(),
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
        currency=shared.currency,
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

    shared = SharedExpense(
        tenant_id=user.tenant_id,
        created_by_user_id=user.id,
        title=body.title,
        total_amount=body.total_amount,
        category_id=body.category_id,
        split_type=body.split_type,
        expense_date=body.expense_date,
        payment_date=body.payment_date or body.expense_date,
    )
    db.add(shared)
    await db.flush()

    pending_wa_invites = []    # (phone, token) for unregistered externals
    notify_user_ids = []     # user_id for registered members to notify

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
                found = await _find_user_by_email(contact, db)
                if found:
                    resolved_user_id = found.id
                    resolved_name = found.display_name or found.email
                    if found.id != user.id:
                        notify_user_ids.append(found.id)
                else:
                    invite_email = contact
                    invite_token = secrets.token_urlsafe(32)
                    invite_expires_at = datetime.utcnow() + timedelta(days=30)
            elif _is_phone(contact):
                normalized_phone = _normalize_phone(contact)
                # Look up existing user by whatsapp_phone
                found = await _find_user_by_phone(normalized_phone, db)
                if found:
                    resolved_user_id = found.id
                    resolved_name = found.display_name or found.email
                    if found.id != user.id:
                        notify_user_ids.append(found.id)
                else:
                    invite_email = normalized_phone  # store normalized phone in invite_email column
                    invite_token = secrets.token_urlsafe(32)
                    invite_expires_at = datetime.utcnow() + timedelta(days=30)
                    # Queue WhatsApp invite to send after flush
                    pending_wa_invites.append((normalized_phone, invite_token))
                await _save_tenant_contact(user.tenant_id, resolved_name, normalized_phone, db)
        elif split_in.user_id and split_in.user_id != user.id:
            # Direct member selection — queue WhatsApp notification if they have phone
            notify_user_ids.append(split_in.user_id)

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

    # Push a los dispositivos registrados. Va antes que WhatsApp y sin
    # condición: WhatsApp sólo llega a quien vinculó su número, y ese es
    # justamente el agujero por el que un participante no se enteraba de nada.
    if notify_user_ids:
        try:
            await push.send_to_users(
                db,
                notify_user_ids,
                title="Te compartieron un gasto",
                body=f"{creator_name}: {body.title}",
                path="/shared",
            )
        except Exception:
            # send_to_users ya no levanta, pero el gasto está commiteado y no
            # se puede perder por un aviso.
            logger.exception("No se pudo notificar por push el gasto compartido %s", shared.id)

    # Notify registered members (if they have WhatsApp linked)
    for notify_uid in notify_user_ids:
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
        _load_q(user).where(SharedExpense.id == shared.id)
    )
    return _out(result, user)


@router.patch("/{shared_id}", response_model=SharedExpenseOut)
async def update_shared_expense(
    shared_id: int,
    body: SharedExpenseUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Field-level permissions depend on `shared.locked` (set once any
    participant besides the creator accepts their split, see _accept_split):
    - Not locked: everything editable (title, amount, category, existing
      participants' amounts, both dates). No adding/removing participants.
    - Locked: only title/expense_date/payment_date — anything that would
      change what someone already accepted is rejected outright rather than
      silently applied, since another participant may already be relying on
      the numbers they saw when they accepted.
    Credit-card-linked shared expenses aren't editable here at all — their
    payment_date is already correctly derived from the statement's due_date,
    and their amount/date should be corrected from the card item itself so
    the two stay in sync.
    """
    user = await _get_db_user(firebase_user, db)

    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id, SharedExpense.tenant_id == user.tenant_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")
    if shared.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail="Solo el creador puede editar este gasto")
    if shared.credit_card_item_id is not None:
        raise HTTPException(
            status_code=400,
            detail="Este gasto viene de un resumen de tarjeta — editalo desde Tarjetas",
        )

    touches_money = (
        body.total_amount is not None or body.category_id is not None or body.splits is not None
    )
    if touches_money and shared.locked:
        raise HTTPException(
            status_code=400,
            detail="Ya fue aceptado por otro participante — solo se puede editar el título y las fechas",
        )

    splits_by_id = {s.id: s for s in shared.splits}
    if body.splits is not None:
        if {s.split_id for s in body.splits} != set(splits_by_id.keys()):
            raise HTTPException(
                status_code=400,
                detail="Deben incluirse todos los participantes existentes, sin agregar ni quitar",
            )
        for split_update in body.splits:
            splits_by_id[split_update.split_id].amount = split_update.amount

    if body.title is not None:
        shared.title = body.title
    if body.total_amount is not None:
        shared.total_amount = body.total_amount
    if body.category_id is not None:
        shared.category_id = body.category_id
    if body.expense_date is not None:
        shared.expense_date = body.expense_date
    if body.payment_date is not None:
        shared.payment_date = body.payment_date

    # Keep every already-accepted participant's mirrored ExpenseEntry in sync
    # for what it actually copies from the shared expense — payment_date has
    # no ExpenseEntry equivalent, so there's nothing to sync for it.
    if touches_money or body.title is not None or body.expense_date is not None:
        for split in shared.splits:
            if split.expense_entry_id is None:
                continue
            entry = await db.get(ExpenseEntry, split.expense_entry_id)
            if not entry:
                continue
            if body.title is not None:
                entry.description = shared.title
            if body.expense_date is not None:
                entry.expense_date = shared.expense_date
            if body.category_id is not None:
                entry.category_id = shared.category_id
            entry.amount = split.amount

    await db.commit()

    result = await db.scalar(
        _load_q(user).where(SharedExpense.id == shared.id)
    )
    return _out(result, user)


@router.post("/{shared_id}/convert-to-ars", response_model=SharedExpenseOut)
async def convert_to_ars(
    shared_id: int,
    body: ConvertToArsBody,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Settlement-time conversion, not an edit of what's owed: doesn't touch
    `amount`, isn't gated by `locked`, and doesn't propagate to anyone's
    ExpenseEntry — the underlying USD purchase is unchanged, this only
    records what peso value the creator and a participant agreed to settle
    at. Only the creator sets it (mirrors edit/delete), same as any other
    split-level change here.
    """
    user = await _get_db_user(firebase_user, db)

    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id, SharedExpense.tenant_id == user.tenant_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")
    if shared.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail="Solo el creador puede convertir este gasto")
    if shared.currency != "USD":
        raise HTTPException(status_code=400, detail="Solo los gastos en dólares se pueden convertir a pesos")

    splits_by_id = {s.id: s for s in shared.splits}
    unknown_ids = set(body.split_ids) - set(splits_by_id.keys())
    if unknown_ids:
        raise HTTPException(status_code=400, detail="Alguno de los participantes no pertenece a este gasto")

    for split_id in body.split_ids:
        split = splits_by_id[split_id]
        if body.rate is None:
            split.converted_ars_amount = None
            split.converted_ars_rate = None
            split.converted_ars_rate_type = None
        else:
            split.converted_ars_amount = (split.amount * body.rate).quantize(Decimal("0.01"))
            split.converted_ars_rate = body.rate
            split.converted_ars_rate_type = body.rate_type

    await db.commit()

    result = await db.scalar(
        _load_q(user).where(SharedExpense.id == shared.id)
    )
    return _out(result, user)


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

    sibling_ids = await _find_group_shared_ids(shared, shared.id, db)

    if not sibling_ids:
        # Not part of an installment (cuota) group — original single-delete behavior.
        entry_ids = [s.expense_entry_id for s in shared.splits if s.expense_entry_id is not None]
        for eid in entry_ids:
            entry = await db.get(ExpenseEntry, eid)
            if entry:
                await db.delete(entry)

        await db.delete(shared)
        await db.commit()
        return

    future_ids = await _find_future_group_shared_ids(shared, db)
    if not future_ids:
        raise HTTPException(status_code=400, detail="No hay cuotas futuras para eliminar")

    deleted_entry_ids: set[int] = set()
    for sid in future_ids:
        target = await db.scalar(
            select(SharedExpense)
            .where(SharedExpense.id == sid)
            .options(selectinload(SharedExpense.splits))
        )
        if not target:
            continue

        for split in target.splits:
            if split.expense_entry_id is not None and split.expense_entry_id not in deleted_entry_ids:
                entry = await db.get(ExpenseEntry, split.expense_entry_id)
                if entry:
                    await db.delete(entry)
                deleted_entry_ids.add(split.expense_entry_id)

        if target.credit_card_item_id is not None:
            cci = await db.get(CreditCardItem, target.credit_card_item_id)
            if cci:
                if cci.expense_entry_id is not None and cci.expense_entry_id not in deleted_entry_ids:
                    entry = await db.get(ExpenseEntry, cci.expense_entry_id)
                    if entry:
                        await db.delete(entry)
                    deleted_entry_ids.add(cci.expense_entry_id)
                await db.delete(cci)

        await db.delete(target)

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

    # `_my_split` also matches a still-unclaimed invite addressed to this user's
    # email/phone, so accepting from the app does the same job as the invite
    # link — the link is now a shortcut, not the only way in.
    split = _my_split(user, shared.splits)
    if not split or split.status != "pending":
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    await _accept_split(user, shared, split, db)

    # Installment purchases: accepting one cuota accepts the whole plan in one go.
    for sib_id in await _find_group_shared_ids(shared, shared.id, db):
        sib_shared = await db.scalar(
            select(SharedExpense).where(SharedExpense.id == sib_id)
            .options(selectinload(SharedExpense.splits))
        )
        sib_split = _my_split(user, sib_shared.splits)
        if sib_split and sib_split.status == "pending":
            await _accept_split(user, sib_shared, sib_split, db)

    await db.commit()

    result = await db.scalar(
        _load_q(user).where(SharedExpense.id == shared_id)
    )
    return _out(result, user)


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

    split = _my_split(user, shared.splits)
    if not split or split.status != "pending":
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    split.status = "rejected"
    _consume_invite(user, split)

    for sib_id in await _find_group_shared_ids(shared, shared.id, db):
        sib_shared = await db.scalar(
            select(SharedExpense).where(SharedExpense.id == sib_id)
            .options(selectinload(SharedExpense.splits))
        )
        sib_split = _my_split(user, sib_shared.splits)
        if sib_split and sib_split.status == "pending":
            sib_split.status = "rejected"
            _consume_invite(user, sib_split)

    await db.commit()

    result = await db.scalar(
        _load_q(user).where(SharedExpense.id == shared_id)
    )
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