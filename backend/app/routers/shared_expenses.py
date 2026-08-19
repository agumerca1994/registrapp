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
from app.services import contacts as contacts_service
from app.services import notify_shared, participants, push, whatsapp
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


# `_save_tenant_contact` se fue a services/contacts.upsert_contact: guardaba
# sólo teléfonos en `tenant_contacts`, que no tenía dónde poner un mail — y ése
# era el único motivo de que "Elegir de la agenda" nunca mostrara un contacto
# de mail.


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

    # La fila de agenda que lo tenía por teléfono o mail pasa a estar linkeada a
    # su cuenta. Sin esto la misma persona queda como dos contactos el día que
    # se registra, y "Frecuentes" muestra dos veces a la misma.
    await contacts_service.link_contact_to_user(db, user=user)


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

    pending_wa_invites = []    # (phone, token) para externos sin cuenta
    notify_pairs = []          # (user_id, monto de su parte) de los registrados

    for split_in in body.splits:
        r = await participants.resolve_participant(
            creator=user,
            db=db,
            member_name=split_in.member_name,
            user_id=split_in.user_id,
            invite_contact=split_in.invite_contact,
        )
        is_creator = r.is_creator
        if r.notify_user_id is not None:
            notify_pairs.append((r.notify_user_id, split_in.amount))
        if r.wa_invite_phone and r.invite_token:
            pending_wa_invites.append((r.wa_invite_phone, r.invite_token))
        # También para la rama de mail: antes sólo se guardaba agenda cuando el
        # contacto era un teléfono, y ése es el único motivo de que "Elegir de
        # la agenda" nunca haya mostrado un contacto de mail.
        # `not r.is_creator`: no tiene sentido figurar en tu propia agenda.
        if not r.is_creator:
            await contacts_service.upsert_contact(
                db,
                tenant_id=user.tenant_id,
                display_name=r.member_name,
                user_id=r.user_id,
                phone=r.agenda_phone,
                email=r.agenda_email,
            )

        split = SharedExpenseSplit(
            shared_expense_id=shared.id,
            user_id=r.user_id,
            member_name=r.member_name,
            amount=split_in.amount,
            status=r.status,
            invite_email=r.invite_email,
            invite_token=r.invite_token,
            invite_expires_at=r.invite_expires_at,
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

    # Avisos, después del commit. El mismo servicio que usa el compartir de
    # tarjetas, para que las dos vías avisen igual.
    await notify_shared.notify_share(
        db,
        creator=user,
        title=body.title,
        total_amount=body.total_amount,
        notify=notify_pairs,
        invites=pending_wa_invites,
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