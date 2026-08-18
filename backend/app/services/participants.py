"""Resolución de participantes de un gasto compartido.

Un participante puede ser cuatro cosas, y hasta ahora cada router decidía cuál
era por su cuenta:

- **miembro / usuario resuelto** — hay una cuenta detrás (`user_id`). Se le
  notifica y tiene que aceptar o rechazar.
- **invitado** — no hay cuenta todavía; se acuña un token para que el día que se
  registre con ese mail o teléfono el gasto lo esté esperando.
- **externo sin cuenta** (`is_guest`) — no hay contacto ni invitación. Es
  contabilidad de quien lo carga: se crea **aceptado**, porque no hay nadie que
  pueda aceptarlo.

Este módulo existe por la misma razón que `services/currency.py`:
`routers/credit_cards.py` tenía una copia de esta lógica en vez de reusarla, y
esa copia derivó — le faltaba la rama del externo sin cuenta (creaba filas
`pending` con `user_id=NULL` y sin token, que nadie podía aceptar ni rechazar
nunca) y le pasaba un mail al enviador de WhatsApp como si fuera un teléfono.
Los dos bugs vienen de reimplementar, no de equivocarse: por eso lo que varía
entre routers es un parámetro (`mint_token`), no una segunda implementación.
"""

from __future__ import annotations

import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User

# Cuánto vive una invitación sin reclamar.
INVITE_TTL = timedelta(days=30)


def is_email(value: str) -> bool:
    return "@" in value


def is_phone(value: str) -> bool:
    cleaned = re.sub(r"[\s\-().]", "", value)
    return bool(re.match(r"^\+?\d{7,15}$", cleaned))


def normalize_phone(value: str) -> str:
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


def phone_lookup_values(phone: str | None) -> list[str]:
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


async def find_user_by_phone(phone: str, db: AsyncSession) -> User | None:
    values = phone_lookup_values(phone)
    if not values:
        return None
    return await db.scalar(select(User).where(User.whatsapp_phone.in_(values)))


async def find_user_by_email(email: str, db: AsyncSession) -> User | None:
    """Case-insensitive on purpose — same failure mode as the phone lookup:
    an exact-match miss costs the recipient in-app visibility, not an error.
    """
    return await db.scalar(select(User).where(func.lower(User.email) == email.strip().lower()))


def invite_lookup_values(user: User) -> list[str]:
    """What an unclaimed invite's `invite_email` (which holds an email OR a
    normalized phone) could contain for this user. Lowercased — the creator
    typed the address by hand, so its casing is not to be trusted; comparisons
    against this list must lowercase the stored side too. Phone spellings are
    unaffected by `lower()`.
    """
    values = phone_lookup_values(user.whatsapp_phone)
    if user.email:
        values.append(user.email.strip().lower())
    return values


@dataclass
class ResolvedParticipant:
    """Cómo queda un participante después de resolverlo contra la base."""

    member_name: str
    user_id: int | None = None
    invite_email: str | None = None      # guarda mail O teléfono, como la columna
    invite_token: str | None = None
    invite_expires_at: datetime | None = None
    # A quién avisarle por push (sólo usuarios registrados que no sean el creador).
    notify_user_id: int | None = None
    # Canales extra que efectivamente se pueden usar para este participante.
    wa_invite_phone: str | None = None
    email_invite_address: str | None = None
    # Para la agenda: qué contacto guardar, si hay alguno.
    agenda_phone: str | None = None
    agenda_email: str | None = None
    is_creator: bool = False
    is_guest: bool = False

    @property
    def status(self) -> str:
        """El estado con el que nace el split.

        Un externo sin cuenta nace **aceptado** porque no existe nadie que
        pueda aceptarlo: dejarlo `pending` produce una fila que ningún flujo
        puede resolver nunca. Eso es exactamente lo que hacía la copia de
        `credit_cards.py`.
        """
        return "accepted" if (self.is_creator or self.is_guest) else "pending"


async def resolve_participant(
    *,
    creator: User,
    db: AsyncSession,
    member_name: str,
    user_id: int | None = None,
    invite_contact: str | None = None,
    mint_token: bool = True,
) -> ResolvedParticipant:
    """Decide qué es este participante y qué hace falta para avisarle.

    `mint_token=False` es para las cuotas hijas de un plan: se acuña un solo
    token por plan, en la cuota raíz. Es un parámetro y no una rama duplicada
    justamente para que no vuelva a divergir.
    """
    r = ResolvedParticipant(member_name=member_name, user_id=user_id)

    if user_id is not None:
        r.is_creator = user_id == creator.id
        if not r.is_creator:
            r.notify_user_id = user_id
        return r

    contact = (invite_contact or "").strip()
    if not contact:
        # Externo sin cuenta: nadie a quien avisarle, nada que aceptar.
        r.is_guest = True
        return r

    if is_email(contact):
        found = await find_user_by_email(contact, db)
        r.agenda_email = contact.lower()
        if found:
            r.user_id = found.id
            r.member_name = found.display_name or found.email
            r.is_creator = found.id == creator.id
            if not r.is_creator:
                r.notify_user_id = found.id
            return r
        r.invite_email = contact
        r.email_invite_address = contact
    elif is_phone(contact):
        phone = normalize_phone(contact)
        found = await find_user_by_phone(phone, db)
        r.agenda_phone = phone
        if found:
            r.user_id = found.id
            r.member_name = found.display_name or found.email
            r.is_creator = found.id == creator.id
            if not r.is_creator:
                r.notify_user_id = found.id
            return r
        r.invite_email = phone
        r.wa_invite_phone = phone
    else:
        # Ni mail ni teléfono: es un nombre suelto, o sea un externo sin cuenta.
        r.is_guest = True
        return r

    if mint_token:
        r.invite_token = secrets.token_urlsafe(32)
        r.invite_expires_at = datetime.utcnow() + INVITE_TTL
    else:
        # Cuota hija: queda el contacto para que el barrido de hermanas la
        # encuentre, pero sin token propio.
        r.wa_invite_phone = None
        r.email_invite_address = None

    return r
