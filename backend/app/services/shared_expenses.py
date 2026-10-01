"""Gastos compartidos: consultas y escrituras, compartidas por el router y el conector MCP.

Mismo motivo que `services/income.py` y `services/credit_cards.py`: que crear,
editar, aceptar o borrar un compartido desde la app y desde una IA sea el mismo
código — quién puede tocar qué (`locked`, sólo el creador, los de tarjeta se
editan desde Tarjetas), el espejo en el egreso de cada participante, las cuotas.

**Nada de esto hace commit ni avisa a nadie.** El que llama confirma y recién
después manda los avisos (`notify_shared.notify_share`) con lo que devuelve
`create_shared`: un aviso que sale por un compartido que después falló es peor
que ningún aviso.
"""
from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, or_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.credit_card import CreditCardItem
from app.models.expense import EXPENSE_SOURCE_SHARED_SPLIT, ExpenseCategory, ExpenseEntry
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.user import User
from app.routers.expenses import assert_owns_category
from app.schemas.shared_expense import (
    ConvertToArsBody, SharedExpenseCreate, SharedExpenseOut, SharedExpenseUpdate,
)
from app.services import contacts as contacts_service
from app.services import participants
from app.services.currency import get_or_create_usd_category


@dataclass
class CreatedShared:
    shared: SharedExpense
    notify: list = field(default_factory=list)    # (user_id, monto) de los registrados
    invites: list = field(default_factory=list)   # (teléfono, token) de externos sin cuenta


def my_split(user: User, splits: list["SharedExpenseSplit"]) -> "SharedExpenseSplit | None":
    """The split that belongs to `user` — either already linked to their
    account, or still an unclaimed invite addressed to their email/phone.
    """
    own = next((s for s in splits if s.user_id == user.id), None)
    if own:
        return own
    values = participants.invite_lookup_values(user)
    if not values:
        return None
    return next(
        (s for s in splits
         if s.user_id is None and (s.invite_email or "").strip().lower() in values),
        None,
    )


def consume_invite(user: User, split: SharedExpenseSplit) -> None:
    """Bind an unclaimed invite to `user` without accepting it. Needed on
    reject: leaving the token alive means the WhatsApp link still works and
    silently re-accepts what they just turned down.
    """
    if split.user_id is None:
        split.user_id = user.id
        split.member_name = user.display_name or user.email
    split.invite_token = None
    split.invite_expires_at = None



def load_q(user: User):
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
    invite_values = participants.invite_lookup_values(user)
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


def pending_q(user: User):
    """Expenses whose split for `user` is still undecided.

    Same ownership rules as `load_q` — their own split, or an unclaimed invite
    addressed to their email/phone — narrowed to `status == "pending"`.

    Note what is deliberately *absent*: `load_q` ORs in
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
    invite_values = participants.invite_lookup_values(user)
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


def out(shared: SharedExpense, user: User) -> SharedExpenseOut:
    """Serialize for `user`: flag which split is theirs, and hide invite tokens
    they have no business holding. Anyone who can see the expense can see every
    split, and a token alone is enough to claim the split it belongs to — so
    only the creator (who re-sends the links) and the invitee themselves get
    the real value.
    """
    out = SharedExpenseOut.model_validate(shared)
    mine = my_split(user, shared.splits)
    is_creator = shared.created_by_user_id == user.id
    for split_out in out.splits:
        if mine is not None and split_out.id == mine.id:
            split_out.mine = True
        elif not is_creator:
            split_out.invite_token = None
    return out


async def get_or_create_shared_category(tenant_id: int, db: AsyncSession) -> int:
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


async def find_group_shared_ids(shared: SharedExpense, exclude_id: int, db: AsyncSession) -> list[int]:
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


async def find_future_group_shared_ids(shared: SharedExpense, db: AsyncSession) -> list[int]:
    """Root + child cuotas in the same installment group as `shared` whose
    expense_date >= today. Includes `shared.id` itself if it qualifies. Keep
    separate from `find_group_shared_ids` (used by accept/reject/claim, which
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


async def accept_one_split(user: User, shared: SharedExpense, split: SharedExpenseSplit, db: AsyncSession) -> None:
    """Accept a single split: create its ExpenseEntry, mark accepted, lock the
    shared expense. Assumes the caller already validated the split is claimable
    by `user` (pending + belongs to them, or an unclaimed invite by phone/email).
    """
    category_id = (
        shared.category_id if shared.tenant_id == user.tenant_id
        else await get_or_create_shared_category(user.tenant_id, db)
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
        source=EXPENSE_SOURCE_SHARED_SPLIT,
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

# ── Operaciones (sin commit) ───────────────────────────────────────────────────
# Lo que hacía cada endpoint, salvo cargar al usuario, confirmar y avisar. El
# router y el conector MCP llaman a esto; los avisos van siempre DESPUÉS del
# commit y los manda quien llama, con lo que devuelve `create_shared`.

async def load_owned(user: User, shared_id: int, db: AsyncSession, action: str) -> SharedExpense:
    """Un compartido del hogar de `user` que `user` creó (editar/borrar/convertir)."""
    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id, SharedExpense.tenant_id == user.tenant_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")
    if shared.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail=f"Solo el creador puede {action} este gasto")
    return shared


async def create_shared(user: User, body: SharedExpenseCreate, db: AsyncSession) -> CreatedShared:
    # La categoría se resuelve igual que en `POST /expenses/entries`: en dólares
    # es opcional y cae en "Consumo en dólares", en pesos es obligatoria, y la
    # que venga tiene que ser del hogar. Antes este endpoint escribía el
    # `category_id` del cliente sin mirarlo, y como el egreso del creador trae la
    # categoría embebida, se podían leer categorías de otros hogares.
    if body.category_id is None:
        if body.currency == "USD":
            category_id = await get_or_create_usd_category(user.tenant_id, db)
        else:
            raise HTTPException(status_code=422, detail="category_id es requerido para gastos en ARS")
    else:
        await assert_owns_category(body.category_id, user.tenant_id, db)
        category_id = body.category_id

    shared = SharedExpense(
        tenant_id=user.tenant_id,
        created_by_user_id=user.id,
        title=body.title,
        total_amount=body.total_amount,
        currency=body.currency,
        category_id=category_id,
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
                category_id=category_id,
                amount=split_in.amount,
                currency=body.currency,
                description=body.title,
                expense_date=body.expense_date,
                notes=f"Gasto compartido #{shared.id}",
                source=EXPENSE_SOURCE_SHARED_SPLIT,
            )
            db.add(entry)
            await db.flush()
            split.expense_entry_id = entry.id
    return CreatedShared(shared=shared, notify=notify_pairs, invites=pending_wa_invites)


async def update_shared(user: User, shared_id: int, body: SharedExpenseUpdate, db: AsyncSession) -> SharedExpense:
    """Field-level permissions depend on `shared.locked` (set once any
    participant besides the creator accepts their split, see accept_one_split):
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
    shared = await load_owned(user, shared_id, db, "editar")
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
    # Mismo agujero que tenía el alta: el egreso de cada participante embebe la
    # categoría, así que un id ajeno se leía de vuelta. Antes de tocar nada.
    if body.category_id is not None:
        await assert_owns_category(body.category_id, user.tenant_id, db)

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
    return shared


async def convert_shared(user: User, shared_id: int, body: ConvertToArsBody, db: AsyncSession) -> SharedExpense:
    """Settlement-time conversion, not an edit of what's owed: doesn't touch
    `amount`, isn't gated by `locked`, and doesn't propagate to anyone's
    ExpenseEntry — the underlying USD purchase is unchanged, this only
    records what peso value the creator and a participant agreed to settle at.
    """
    shared = await load_owned(user, shared_id, db, "convertir")
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
    return shared


async def delete_shared(user: User, shared_id: int, db: AsyncSession) -> list[int]:
    """Borra un compartido; si es de un plan en cuotas, sólo las cuotas futuras
    (con su ítem de tarjeta). Devuelve los ids de compartidos borrados."""
    shared = await load_owned(user, shared_id, db, "eliminar")
    sibling_ids = await find_group_shared_ids(shared, shared.id, db)

    if not sibling_ids:
        # Not part of an installment (cuota) group — original single-delete behavior.
        entry_ids = [s.expense_entry_id for s in shared.splits if s.expense_entry_id is not None]
        for eid in entry_ids:
            entry = await db.get(ExpenseEntry, eid)
            if entry:
                await db.delete(entry)

        await db.delete(shared)
        return [shared.id]

    future_ids = await find_future_group_shared_ids(shared, db)
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
    return future_ids


async def accept_shared(user: User, shared_id: int, db: AsyncSession) -> SharedExpense:
    """Acepta el split de `user` (o la invitación dirigida a su mail/teléfono);
    en un plan en cuotas, todas las cuotas."""
    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")

    # `my_split` also matches a still-unclaimed invite addressed to this user's
    # email/phone, so accepting from the app does the same job as the invite
    # link — the link is now a shortcut, not the only way in.
    split = my_split(user, shared.splits)
    if not split or split.status != "pending":
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    await accept_one_split(user, shared, split, db)

    # Installment purchases: accepting one cuota accepts the whole plan in one go.
    for sib_id in await find_group_shared_ids(shared, shared.id, db):
        sib_shared = await db.scalar(
            select(SharedExpense).where(SharedExpense.id == sib_id)
            .options(selectinload(SharedExpense.splits))
        )
        sib_split = my_split(user, sib_shared.splits)
        if sib_split and sib_split.status == "pending":
            await accept_one_split(user, sib_shared, sib_split, db)
    return shared


async def reject_shared(user: User, shared_id: int, db: AsyncSession) -> SharedExpense:
    """Rechaza el split de `user` y mata el token: si no, el link de WhatsApp
    re-aceptaría en silencio lo que acaba de rechazar."""
    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")

    split = my_split(user, shared.splits)
    if not split or split.status != "pending":
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    split.status = "rejected"
    consume_invite(user, split)

    for sib_id in await find_group_shared_ids(shared, shared.id, db):
        sib_shared = await db.scalar(
            select(SharedExpense).where(SharedExpense.id == sib_id)
            .options(selectinload(SharedExpense.splits))
        )
        sib_split = my_split(user, sib_shared.splits)
        if sib_split and sib_split.status == "pending":
            sib_split.status = "rejected"
            consume_invite(user, sib_split)
    return shared
