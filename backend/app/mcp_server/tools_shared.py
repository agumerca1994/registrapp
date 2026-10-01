"""Shared expenses from the assistant: read, create, edit, accept/reject, settle, delete.

All the rules live in `services/shared_expenses.py` — the same functions the
router calls — so who may touch what doesn't depend on where the request came
from: only the creator edits/deletes/converts, a `locked` expense (someone else
already accepted) only takes title and dates, a card-linked one is edited from
the card, deleting a cuota plan only removes the future cuotas.

What's specific to this module:
- **The preview lists who would be notified, and how.** Creating a shared
  expense reaches other people (push, WhatsApp, an invite to someone without an
  account). That's the one write here that can't be rolled back, so the dry run
  says exactly what would go out before anything does.
- **Notifications go after the commit**, never in a preview: `finish()` commits,
  then `notify_share` runs — same order as the router.
- The caller is loaded as a `User` row because visibility (`load_q`) and the
  invite matching use its email/phone. Only columns are read, never
  `user.tenant` (MissingGreenlet).
"""
from decimal import Decimal
from typing import Any, Literal

from fastapi import HTTPException
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field, ValidationError
from sqlalchemy import select

from app.core.config import settings
from app.mcp_server.context import McpCaller, current_caller, tool_session
from app.mcp_server.instance import READ_ONLY, mcp
from app.mcp_server.params import MAX_LIMIT, clamp, parse_date
from app.mcp_server.serialize import f, f0, guard
from app.mcp_server.write_common import (
    DESTRUCTIVE, WRITE, audit, finish, fold, http_to_tool, limit_writes,
)
from app.models.contact import SharedContact
from app.models.expense import ExpenseCategory
from app.models.shared_expense import SharedExpense
from app.models.user import User
from app.schemas.shared_expense import (
    ConvertToArsBody, SharedExpenseCreate, SharedExpenseUpdate, SplitAmountUpdate, SplitIn,
)
from app.services import notify_shared, user_directory
from app.services import participants as participants_svc
from app.services import shared_expenses as svc


class ParticipantArg(BaseModel):
    name: str = Field(description="Nombre a mostrar del participante.")
    amount: float = Field(description="Su parte, positiva. La suma de todos tiene que dar el total.")
    me: bool = Field(False, description="true para la parte de quien comparte (vos).")
    contact: str | None = Field(
        None,
        description="Alias, mail o teléfono. Si corresponde a una cuenta, se le comparte a esa "
                    "cuenta; si no, mail/teléfono generan una invitación. Sin contacto: "
                    "participante sin cuenta, que no recibe nada.",
    )
    user_id: int | None = Field(None, description="Cuenta exacta (de list_share_contacts).")


class SplitAmountArg(BaseModel):
    split_id: int
    amount: float


# ── helpers ────────────────────────────────────────────────────────────────────

def _dec(v: float) -> Decimal:
    return Decimal(str(round(v, 2)))


async def _me(db, caller: McpCaller) -> User:
    user = await db.get(User, caller.user_id)
    if user is None:
        raise ToolError("Usuario inexistente")
    return user


def _shared_dict(s: SharedExpense, me: User) -> dict[str, Any]:
    mine = svc.my_split(me, s.splits)
    return {
        "id": s.id,
        "title": s.title,
        "total_amount": f0(s.total_amount),
        "currency": s.currency,
        "expense_date": s.expense_date.isoformat(),
        "payment_date": s.payment_date.isoformat(),
        "created_by_me": s.created_by_user_id == me.id,
        "locked": s.locked,
        "from_card_item_id": s.credit_card_item_id,
        "installment_root_id": s.installment_group_id,
        "my_split_id": mine.id if mine else None,
        "my_status": mine.status if mine else None,
        "splits": [
            {
                "id": sp.id,
                "name": sp.member_name,
                "amount": f0(sp.amount),
                "status": sp.status,
                "has_account": sp.user_id is not None,
                "invite_pending": sp.user_id is None and sp.invite_token is not None,
                "mine": mine is not None and sp.id == mine.id,
                "converted_ars_amount": f(sp.converted_ars_amount),
                "converted_ars_rate": f(sp.converted_ars_rate),
            }
            for sp in sorted(s.splits, key=lambda x: x.id)
        ],
    }


async def _reload(db, me: User, shared_id: int) -> SharedExpense | None:
    return await db.scalar(
        svc.load_q(me).where(SharedExpense.id == shared_id)
        .execution_options(populate_existing=True)
    )


def _require_creator(shared: SharedExpense | None, me: User, shared_id: int, action: str) -> SharedExpense:
    if shared is None:
        raise ToolError(f"No existe el compartido {shared_id} (o no es visible para vos)")
    if shared.created_by_user_id != me.id:
        raise ToolError(f"Sólo quien creó el gasto puede {action}lo; vos sos participante.")
    return shared


async def _resolve_category(db, caller: McpCaller, name: str | None) -> int | None:
    if name is None:
        return None
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == caller.tenant_id)
    )).all()
    match = [c for c in cats if fold(c.name) == fold(name)]
    if not match:
        raise ToolError(
            f"No hay una categoría «{name}». Categorías: {', '.join(sorted(c.name for c in cats))}"
        )
    return match[0].id


def _validation(exc: ValidationError) -> ToolError:
    return ToolError("; ".join(e["msg"].removeprefix("Value error, ") for e in exc.errors()))


# ── read ───────────────────────────────────────────────────────────────────────

@mcp.tool(annotations=READ_ONLY)
async def list_shared_expenses(
    date_from: str | None = None,
    date_to: str | None = None,
    person: str | None = None,
    only: Literal["all", "pending_mine", "created_by_me", "shared_with_me"] = "all",
    limit: int = 50,
) -> dict[str, Any]:
    """Gastos compartidos visibles para vos: los del hogar, los que te compartieron
    y las invitaciones dirigidas a tu mail/teléfono.

    Cada uno trae sus participantes (splits) con id, monto y estado
    (pending/accepted/rejected), cuál es el tuyo, y si está bloqueado (`locked`:
    otro participante ya aceptó, sólo se editan título y fechas).

    Args:
        date_from: Desde (fecha del gasto), YYYY-MM-DD.
        date_to: Hasta (fecha del gasto), YYYY-MM-DD inclusive.
        person: Nombre (o parte) de un participante.
        only: "pending_mine" = esperando que vos aceptes/rechaces; "created_by_me";
            "shared_with_me" = creados por otros; "all" (default).
        limit: Máximo de resultados.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        me = await _me(db, caller)
        q = svc.pending_q(me) if only == "pending_mine" else svc.load_q(me)
        if date_from:
            q = q.where(SharedExpense.expense_date >= parse_date(date_from, "date_from"))
        if date_to:
            q = q.where(SharedExpense.expense_date <= parse_date(date_to, "date_to"))
        if only == "created_by_me":
            q = q.where(SharedExpense.created_by_user_id == me.id)
        elif only == "shared_with_me":
            q = q.where(SharedExpense.created_by_user_id != me.id)
        rows = (await db.scalars(q)).all()
        if person:
            key = fold(person)
            rows = [r for r in rows if any(key in fold(sp.member_name) for sp in r.splits)]
        total = len(rows)
        rows = rows[: clamp(limit, 1, MAX_LIMIT)]
        return guard({
            "count": total,
            "shared_expenses": [_shared_dict(r, me) for r in rows],
            "truncated": total > len(rows),
            "notes": [
                "Montos por moneda: un compartido en USD no se suma con uno en ARS.",
                "from_card_item_id: viene de un resumen de tarjeta; monto y fecha se corrigen desde la tarjeta.",
            ],
        })


@mcp.tool(annotations=READ_ONLY)
async def list_share_contacts() -> dict[str, Any]:
    """Con quién se puede compartir: los miembros del hogar y la agenda de contactos.

    Usá el `user_id` (si tiene cuenta) o el contacto en `create_shared_expense`.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        members = (await db.scalars(
            select(User).where(User.tenant_id == caller.tenant_id).order_by(User.id)
        )).all()
        contacts = (await db.scalars(
            select(SharedContact)
            .where(SharedContact.tenant_id == caller.tenant_id)
            .order_by(SharedContact.use_count.desc(), SharedContact.display_name)
            .limit(100)
        )).all()
        return guard({
            "household": [
                {"user_id": u.id, "name": u.display_name or u.email, "alias": u.alias,
                 "me": u.id == caller.user_id}
                for u in members
            ],
            "contacts": [
                {"name": c.display_name, "user_id": c.contact_user_id,
                 "phone": c.contact_phone, "email": c.contact_email, "times_used": c.use_count}
                for c in contacts
            ],
        })


# ── create ─────────────────────────────────────────────────────────────────────

@mcp.tool(annotations=WRITE)
async def create_shared_expense(
    title: str,
    total_amount: float,
    expense_date: str,
    participants: list[ParticipantArg],
    category: str | None = None,
    currency: Literal["ARS", "USD"] = "ARS",
    payment_date: str | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Crea un gasto compartido. AVISA A LOS PARTICIPANTES al guardarlo.

    Igual que en la app: a quien tiene cuenta le llega un push (y WhatsApp si los
    dos lo permiten); a quien se invita por teléfono sin cuenta, un WhatsApp con
    el link. La vista previa (dry_run=true, default) lista exactamente quién
    recibiría qué — mostrásela al usuario y guardá sólo si confirma.

    Incluí tu propia parte con `me: true`. La suma de las partes tiene que dar el
    total. Para elegir personas, list_share_contacts.

    Args:
        title: Descripción, ej. "Cena cumple Juan".
        total_amount: Total del gasto.
        expense_date: Fecha del gasto, YYYY-MM-DD.
        participants: [{name, amount, me?, contact?, user_id?}].
        category: Nombre de la categoría (obligatoria en ARS).
        currency: "ARS" (default) o "USD".
        payment_date: Cuándo sale la plata si no es la fecha del gasto, YYYY-MM-DD.
        dry_run: true = vista previa (default). false = crear y avisar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        me = await _me(db, caller)
        try:
            mes = [p for p in participants if p.me]
            if len(mes) != 1:
                raise ToolError("Marcá exactamente un participante con me=true (tu parte)")
            splits: list[SplitIn] = []
            for p in participants:
                if p.amount < 0:
                    raise ToolError(f"«{p.name}»: el monto no puede ser negativo")
                user_id, invite = (me.id, None) if p.me else (p.user_id, None)
                if not p.me and user_id is None and p.contact:
                    found = await user_directory.lookup_exact(db, p.contact)
                    if found is not None:
                        user_id = found.id
                    elif participants_svc.is_email(p.contact) or participants_svc.is_phone(p.contact):
                        invite = p.contact
                    else:
                        raise ToolError(f"«{p.contact}» no es un alias de RegistrApp ni un mail o teléfono")
                splits.append(SplitIn(
                    user_id=user_id,
                    member_name=(me.display_name or me.email) if p.me else p.name.strip(),
                    amount=_dec(p.amount), invite_contact=invite,
                ))
            amounts = {s.amount for s in splits}
            try:
                body = SharedExpenseCreate(
                    title=title.strip(), total_amount=_dec(total_amount),
                    category_id=await _resolve_category(db, caller, category),
                    currency=currency, split_type="equal" if len(amounts) == 1 else "custom",
                    expense_date=parse_date(expense_date, "expense_date"),
                    payment_date=parse_date(payment_date, "payment_date") if payment_date else None,
                    splits=splits,
                )
            except ValidationError as exc:
                raise _validation(exc)

            created = await svc.create_shared(me, body, db)
            await db.flush()

            # Recargado con sus splits: en el objeto recién creado la relación no
            # está cargada y leerla dispara un lazy load (MissingGreenlet).
            shared = await _reload(db, me, created.shared.id)

            # Qué saldría, y por dónde. Las reglas son las de notify_share.
            names = {u.id: (u.display_name or u.email) for u in (await db.scalars(
                select(User).where(User.id.in_([uid for uid, _ in created.notify] or [0]))
            )).all()}
            invited_phones = {phone for phone, _ in created.invites}
            notices = [
                {"name": names.get(uid, f"usuario {uid}"), "channel": "push en la app (y WhatsApp si ambos lo permiten)"}
                for uid, _ in created.notify
            ]
            for sp in shared.splits:
                if sp.user_id is None and sp.invite_token:
                    if participants_svc.is_phone(sp.invite_email or "") or (sp.invite_email or "") in invited_phones:
                        channel = ("WhatsApp con el link de invitación" if me.whatsapp_notifications
                                   else "NADA: tenés los avisos por WhatsApp apagados; pasale el link vos")
                    else:
                        channel = "NADA (no hay envío por mail): pasale el link de invitación vos"
                    notices.append({"name": sp.member_name, "channel": channel,
                                    "invite_link": None if dry_run else f"{settings.FRONTEND_URL}/invite/{sp.invite_token}"})
                elif sp.user_id is None and sp.status == "accepted":
                    notices.append({"name": sp.member_name, "channel": "nada (participante sin cuenta ni contacto)"})

            out = _shared_dict(shared, me)
            if dry_run:
                # Ids de una fila que se va a deshacer: que nadie los use después.
                out["id"] = out["my_split_id"] = None
                for sp in out["splits"]:
                    sp["id"] = None
            result = {"action": "create", "shared_expense": out, "notifications": notices}

            async def apply():
                await audit(db, caller, "create_shared_expense",
                            f"compartido {shared.id} «{shared.title}» {out['total_amount']} {currency}",
                            {"shared_id": shared.id, "after": out, "notifications": notices})

            result = await finish(db, dry_run, result, apply)
            if not dry_run:
                await notify_shared.notify_share(
                    db, creator=me, title=body.title, total_amount=body.total_amount,
                    notify=created.notify, invites=created.invites, currency=currency,
                )
                result["note"] = "Guardado y avisado."
            return result
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


# ── edit / respond / settle / delete ───────────────────────────────────────────

@mcp.tool(annotations=WRITE)
async def update_shared_expense(
    shared_id: int,
    title: str | None = None,
    total_amount: float | None = None,
    category: str | None = None,
    expense_date: str | None = None,
    payment_date: str | None = None,
    split_amounts: list[SplitAmountArg] | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Edita un gasto compartido que creaste vos.

    - Si ya lo aceptó otro participante (`locked`), sólo título y fechas.
    - Para cambiar montos pasá `total_amount` Y `split_amounts` con TODOS los
      participantes (no se agregan ni quitan personas).
    - Los que vienen de una tarjeta se corrigen desde la tarjeta (save_card_item).
    Los egresos espejo de quienes ya aceptaron se actualizan solos.

    Args:
        shared_id: Gasto compartido.
        title: Nuevo título.
        total_amount: Nuevo total (con split_amounts).
        category: Nueva categoría, por nombre.
        expense_date: Nueva fecha del gasto, YYYY-MM-DD.
        payment_date: Nueva fecha de pago, YYYY-MM-DD.
        split_amounts: [{split_id, amount}] para todos los participantes.
        dry_run: true = vista previa (default). false = guardar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        me = await _me(db, caller)
        try:
            current = _require_creator(await _reload(db, me, shared_id), me, shared_id, "editar")
            before = _shared_dict(current, me)
            try:
                body = SharedExpenseUpdate(
                    title=title,
                    total_amount=_dec(total_amount) if total_amount is not None else None,
                    category_id=await _resolve_category(db, caller, category),
                    expense_date=parse_date(expense_date, "expense_date") if expense_date else None,
                    payment_date=parse_date(payment_date, "payment_date") if payment_date else None,
                    splits=[SplitAmountUpdate(split_id=s.split_id, amount=_dec(s.amount)) for s in split_amounts]
                    if split_amounts is not None else None,
                )
            except ValidationError as exc:
                raise _validation(exc)
            if body.model_dump(exclude_none=True) == {}:
                raise ToolError("No hay nada para cambiar")
            if body.total_amount is not None and body.splits is None:
                raise ToolError("Para cambiar el total pasá también split_amounts con todos los participantes")
            await svc.update_shared(me, shared_id, body, db)
            await db.flush()
            after = _shared_dict(await _reload(db, me, shared_id), me)
            result = {"action": "update", "shared_expense": after, "before": before}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "update_shared_expense", f"editado compartido {shared_id}",
                {"shared_id": shared_id, "before": before, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=WRITE)
async def respond_shared_expense(
    shared_id: int, action: Literal["accept", "reject"], dry_run: bool = True,
) -> dict[str, Any]:
    """Acepta o rechaza un gasto que te compartieron (ver list_shared_expenses only="pending_mine").

    Aceptar crea tu egreso por tu parte; en un plan en cuotas acepta todas las
    cuotas. Rechazar no se deshace desde acá.

    Args:
        shared_id: Gasto compartido.
        action: "accept" o "reject".
        dry_run: true = vista previa (default). false = aplicar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        me = await _me(db, caller)
        try:
            if action == "accept":
                await svc.accept_shared(me, shared_id, db)
            else:
                await svc.reject_shared(me, shared_id, db)
            await db.flush()
            after = _shared_dict(await _reload(db, me, shared_id), me)
            result = {"action": action, "shared_expense": after}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "respond_shared_expense", f"{action} compartido {shared_id}",
                {"shared_id": shared_id, "action": action, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=WRITE)
async def convert_shared_to_ars(
    shared_id: int,
    rate: float | None = None,
    split_ids: list[int] | None = None,
    rate_type: str | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Registra a qué cotización se liquida en pesos un compartido en dólares.

    No cambia lo que se debe (sigue en USD): anota el equivalente en pesos
    acordado con cada participante. `rate` = null revierte a USD. Para usar la
    cotización del día, consultá get_macro primero.

    Args:
        shared_id: Gasto compartido en USD que creaste vos.
        rate: Pesos por dólar, ej. 1250. null = revertir.
        split_ids: Participantes a convertir (default: todos menos vos).
        rate_type: Etiqueta de la cotización: "oficial", "blue", "mep", "ccl", "mayorista" o "personalizado".
        dry_run: true = vista previa (default). false = guardar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        me = await _me(db, caller)
        try:
            current = _require_creator(await _reload(db, me, shared_id), me, shared_id, "convertir")
            ids = split_ids or [sp.id for sp in current.splits if sp.user_id != me.id]
            try:
                body = ConvertToArsBody(
                    split_ids=ids, rate=_dec(rate) if rate is not None else None,
                    rate_type=(rate_type or "personalizado") if rate is not None else None,
                )
            except ValidationError as exc:
                raise _validation(exc)
            await svc.convert_shared(me, shared_id, body, db)
            await db.flush()
            after = _shared_dict(await _reload(db, me, shared_id), me)
            result = {"action": "convert" if rate is not None else "revert", "shared_expense": after}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "convert_shared_to_ars", f"conversión compartido {shared_id} a {rate}",
                {"shared_id": shared_id, "rate": rate, "split_ids": ids},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_shared_expense(shared_id: int, dry_run: bool = True) -> dict[str, Any]:
    """Elimina un gasto compartido que creaste vos, con los egresos de todos los participantes.

    Si es de un plan en cuotas, borra sólo las cuotas de hoy en adelante (y sus
    ítems de tarjeta); las pasadas quedan. La vista previa dice cuáles.

    Args:
        shared_id: Gasto compartido.
        dry_run: true = vista previa (default). false = borrar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        me = await _me(db, caller)
        try:
            current = _require_creator(await _reload(db, me, shared_id), me, shared_id, "borrar")
            snapshot = _shared_dict(current, me)
            deleted = await svc.delete_shared(me, shared_id, db)
            await db.flush()
            warnings = []
            others = [sp for sp in current.splits if sp.status == "accepted" and sp.user_id not in (None, me.id)]
            if others:
                warnings.append(
                    "Ya lo aceptaron: " + ", ".join(sp.member_name for sp in others)
                    + ". Se les borra su egreso sin aviso."
                )
            result = {"action": "delete", "shared_expense": snapshot,
                      "deleted_shared_ids": deleted, "warnings": warnings}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "delete_shared_expense",
                f"borrado compartido {shared_id} «{snapshot['title']}» ({len(deleted)} cuota/s)",
                {"shared_id": shared_id, "deleted": deleted, "before": snapshot},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)
