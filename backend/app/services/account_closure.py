"""Pausar y eliminar una cuenta.

**Pausar** congela a una persona, no a su hogar ni a su negocio: no entra a la
app (todo endpoint da 423 salvo ver su perfil, reactivar y eliminar; ver
`core/access.py`), el bot le contesta que la cuenta está en pausa, el conector
no le lee nada y no le llega ningún aviso ni recordatorio. No se borra ni se
revoca nada, así reactivar deja todo como estaba. Los demás miembros siguen.

**Eliminar** es irreversible y no borra filas: las seudonimiza. Borrarlas
rompería otras que las referencian (los gastos que cargó en un hogar que sigue,
los splits en hogares ajenos, las cuotas de un plan), y dejaría huecos en los
totales de quien se queda. En lugar de eso, cada texto que identifica a alguien
se reemplaza por un HMAC-SHA256 con una clave aleatoria que se genera para esa
eliminación y **no se guarda en ningún lado**: sin la clave no hay forma de
volver al texto, ni de comprobar si un texto candidato era el original (con un
hash sin clave, "Supermercado Día" se verificaría probándolo). La misma clave
para toda la eliminación hace que dos valores iguales sigan siendo iguales, así
los índices únicos (nombre de categoría, de proveedor…) no chocan.

Qué se seudonimiza:
- Siempre, la fila del usuario: mail, nombre, alias, teléfonos, uid de
  Firebase. Se borran sus dispositivos, sus tokens del conector, los links del
  bot y su memoria de chat, y se borra su usuario de Firebase Auth.
- Si quedan otras personas en el hogar o negocio, lo cargado se queda con
  ellas sin tocar: es de ellas también. La cuenta sale a un tenant vacío.
- Si era la última, se seudonimiza el tenant entero: cada texto libre
  (descripciones, notas, nombres de categorías, fuentes, tarjetas, proveedores,
  productos, contactos…). Montos, fechas, monedas y tipos se quedan: no
  identifican a nadie y son lo que mantiene coherente lo que referencia.

Lo que no se toca: en un gasto compartido con otra cuenta, el título y los
nombres son también de esa persona, y se quedan como están en su lista.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import logging
import secrets
from datetime import datetime

from fastapi import HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.app_log import AppLog
from app.models.auth_link_token import AuthLinkToken
from app.models.business import Payee, Product, Sale, SaleLine, StockMovement
from app.models.contact import SharedContact, TenantContact
from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.currency_operation import CurrencyOperation
from app.models.device_token import DeviceToken
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource, IncomeSourceField
from app.models.mcp_auth import McpAuthCode, McpToken
from app.models.mortgage import MortgageLoan
from app.models.payment_reminder import PaymentReminder
from app.models.savings import SavingsContribution, SavingsGoal
from app.models.reconciliation import CaptureRule, ReconciliationAction, ReconciliationSession
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.wa_message import WaMessage

logger = logging.getLogger(__name__)

# Lo que hay que escribir para confirmar la eliminación.
DELETE_CONFIRMATION = "eliminar"


def utcnow() -> datetime:
    return datetime.utcnow()


# ── Pausa ────────────────────────────────────────────────────────────────────

def is_active(user: User) -> bool:
    """Le llegan avisos y puede usar la app, el bot y el conector."""
    return user.paused_at is None and user.deleted_at is None


async def pause(db: AsyncSession, user: User) -> None:
    if user.paused_at is None:
        user.paused_at = utcnow()


async def unpause(db: AsyncSession, user: User) -> None:
    user.paused_at = None


# ── Herencia del rol de dueño ────────────────────────────────────────────────

async def hand_over_ownership(db: AsyncSession, user: User) -> None:
    """Antes de que un dueño (admin) deje el tenant, el rol pasa al socio más
    antiguo, nunca a un empleado: heredaría todo lo que su rol no le deja ver.
    Si sólo quedan empleados, primero hay que hacer socio a alguien (400)."""
    if user.role != UserRole.admin:
        return
    others = (await db.scalars(
        select(User)
        .where(User.tenant_id == user.tenant_id, User.id != user.id, User.deleted_at.is_(None))
        .order_by(User.created_at)
    )).all()
    heir = next((u for u in others if u.role != UserRole.employee), None)
    if others and heir is None:
        raise HTTPException(
            status_code=400,
            detail="Sos el único dueño o socio: antes de irte, hacé socio a alguien.",
        )
    if heir is not None:
        heir.role = UserRole.admin


# ── Eliminación ──────────────────────────────────────────────────────────────

class _Shredder:
    """HMAC con una clave que vive sólo mientras dura la eliminación."""

    def __init__(self) -> None:
        self._key = secrets.token_bytes(32)

    def __call__(self, value: str | None, length: int) -> str | None:
        if value is None:
            return None
        digest = hmac.new(self._key, value.encode("utf-8"), hashlib.sha256).hexdigest()
        return digest[:length]


def _tenant_text_columns(tenant_id: int):
    """(modelo, columnas de texto, filtro) de todo lo que un tenant escribió."""
    statements = select(CreditCardStatement.id).where(CreditCardStatement.tenant_id == tenant_id)
    sources = select(IncomeSource.id).where(IncomeSource.tenant_id == tenant_id)
    sales = select(Sale.id).where(Sale.tenant_id == tenant_id)
    return [
        (ExpenseEntry, ("description", "notes", "entity"), ExpenseEntry.tenant_id == tenant_id),
        (ExpenseCategory, ("name",), ExpenseCategory.tenant_id == tenant_id),
        (IncomeEntry, ("notes",), IncomeEntry.tenant_id == tenant_id),
        (IncomeSource, ("name", "description"), IncomeSource.tenant_id == tenant_id),
        (IncomeSourceField, ("name",), IncomeSourceField.source_id.in_(sources)),
        (CreditCard, ("bank", "alias", "titular", "last_4_digits"), CreditCard.tenant_id == tenant_id),
        (CreditCardItem, ("description", "bank_description", "bank_coupon"),
         CreditCardItem.statement_id.in_(statements)),
        (CurrencyOperation, ("entity", "notes"), CurrencyOperation.tenant_id == tenant_id),
        (MortgageLoan, ("description", "loan_number"), MortgageLoan.tenant_id == tenant_id),
        (PaymentReminder, ("title",), PaymentReminder.tenant_id == tenant_id),
        (SavingsGoal, ("name",), SavingsGoal.tenant_id == tenant_id),
        (SavingsContribution, ("note",), SavingsContribution.tenant_id == tenant_id),
        (Payee, ("name", "name_key", "notes"), Payee.tenant_id == tenant_id),
        (Product, ("name", "name_key"), Product.tenant_id == tenant_id),
        (Sale, ("notes",), Sale.tenant_id == tenant_id),
        (SaleLine, ("description",), SaleLine.sale_id.in_(sales)),
        (StockMovement, ("notes",), StockMovement.tenant_id == tenant_id),
        (SharedContact, ("display_name", "contact_email", "contact_phone", "person_key"),
         SharedContact.tenant_id == tenant_id),
        (TenantContact, ("contact_name", "contact_phone"), TenantContact.tenant_id == tenant_id),
        (ReconciliationSession, ("cardholder",), ReconciliationSession.tenant_id == tenant_id),
    ]


async def _shred_rows(db: AsyncSession, shred: _Shredder, model, columns, where) -> None:
    cols = [getattr(model, c) for c in columns]
    rows = (await db.execute(select(model.id, *cols).where(where))).all()
    if not rows:
        return
    lengths = {c: getattr(model, c).type.length for c in columns}
    await db.execute(update(model), [
        {"id": row.id, **{c: shred(getattr(row, c), lengths[c]) for c in columns}}
        for row in rows
    ])


async def _shred_shared_expenses(db: AsyncSession, shred: _Shredder, tenant_id: int, user_id: int) -> None:
    """Los compartidos del tenant: el título y los nombres se seudonimizan sólo
    si no hay otra cuenta en el gasto. Las invitaciones mueren siempre: un link
    que siga andando reclamaría un gasto de una cuenta que ya no existe."""
    owned = select(SharedExpense.id).where(SharedExpense.tenant_id == tenant_id)
    await db.execute(
        update(SharedExpenseSplit)
        .where(SharedExpenseSplit.shared_expense_id.in_(owned))
        .values(invite_token=None, invite_expires_at=None)
    )
    with_others = select(SharedExpenseSplit.shared_expense_id).where(
        SharedExpenseSplit.shared_expense_id.in_(owned),
        SharedExpenseSplit.user_id.is_not(None),
        SharedExpenseSplit.user_id != user_id,
    )
    alone = SharedExpense.id.in_(owned.where(SharedExpense.id.not_in(with_others)))
    await _shred_rows(db, shred, SharedExpense, ("title",), alone)
    await _shred_rows(
        db, shred, SharedExpenseSplit, ("member_name", "invite_email"),
        SharedExpenseSplit.shared_expense_id.in_(select(SharedExpense.id).where(alone)),
    )


async def _shred_tenant(db: AsyncSession, shred: _Shredder, tenant: Tenant, user_id: int) -> None:
    for model, columns, where in _tenant_text_columns(tenant.id):
        await _shred_rows(db, shred, model, columns, where)
    await _shred_shared_expenses(db, shred, tenant.id, user_id)
    # Lo que la conciliación guardó del PDF (comercios, montos, titular) y los
    # cambios propuestos: es una copia del resumen, no algo que otra fila use.
    sessions = select(ReconciliationSession.id).where(ReconciliationSession.tenant_id == tenant.id)
    await db.execute(
        update(ReconciliationSession).where(ReconciliationSession.tenant_id == tenant.id)
        .values(parsed=None, totals=None, choices=None)
    )
    await db.execute(
        update(ReconciliationAction).where(ReconciliationAction.session_id.in_(sessions))
        .values(payload=None, before=None)
    )
    # Reglas aprendidas (comercio → categoría…) y logs: ninguna otra fila los
    # referencia, y son texto del hogar.
    await db.execute(delete(CaptureRule).where(CaptureRule.tenant_id == tenant.id))
    await db.execute(delete(AppLog).where(AppLog.tenant_id == tenant.id))
    await db.execute(delete(McpToken).where(McpToken.tenant_id == tenant.id))
    await db.execute(delete(McpAuthCode).where(McpAuthCode.tenant_id == tenant.id))
    tenant.name = shred(tenant.name, 120) or ""
    tenant.code = None


async def _shred_user(db: AsyncSession, shred: _Shredder, user: User) -> None:
    for model in (DeviceToken, McpToken, McpAuthCode, AuthLinkToken, WaMessage, AppLog):
        await db.execute(delete(model).where(model.user_id == user.id))
    user.firebase_uid = f"deleted:{shred(user.firebase_uid, 64)}"
    user.email = shred(user.email, 64)
    user.first_name = shred(user.first_name, 60)
    user.last_name = shred(user.last_name, 60)
    user.display_name = shred(user.display_name, 120)
    user.alias = shred(user.alias, 30)
    user.phone_number = shred(user.phone_number, 30)
    user.whatsapp_phone = shred(user.whatsapp_phone, 20)
    user.whatsapp_pending_phone = None
    user.whatsapp_verify_code = None
    user.whatsapp_verify_expires = None
    user.whatsapp_gate_pending = False
    user.discoverable = False
    user.whatsapp_notifications = False
    user.paused_at = None
    user.deleted_at = utcnow()


async def delete_account(db: AsyncSession, user: User) -> str:
    """Seudonimiza la cuenta (y el tenant, si era la última persona). No
    commitea. Devuelve el uid de Firebase a borrar después del commit."""
    firebase_uid = user.firebase_uid
    others = await db.scalar(
        select(User.id).where(
            User.tenant_id == user.tenant_id, User.id != user.id, User.deleted_at.is_(None),
        ).limit(1)
    )
    shred = _Shredder()
    if others is not None:
        await hand_over_ownership(db, user)
        # Fuera del hogar que sigue, a un tenant sin código: nadie se puede sumar.
        placeholder = Tenant(name="", code=None)
        db.add(placeholder)
        await db.flush()
        user.tenant_id = placeholder.id
        user.role = UserRole.admin
    else:
        tenant = await db.get(Tenant, user.tenant_id)
        await _shred_tenant(db, shred, tenant, user.id)
    await _shred_user(db, shred, user)
    await db.flush()
    return firebase_uid


async def delete_firebase_user(uid: str) -> None:
    """Después del commit. Si falla, la cuenta igual quedó eliminada: esa
    persona entraría con Google a un alta nueva, sin nada de lo anterior."""
    try:
        from firebase_admin import auth as firebase_auth

        await asyncio.to_thread(firebase_auth.delete_user, uid)
    except Exception as e:  # noqa: BLE001
        logger.warning("No se pudo borrar el usuario de Firebase al eliminar la cuenta: %s", e)
