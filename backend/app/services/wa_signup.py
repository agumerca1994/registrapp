"""Alguien sin cuenta le escribe al bot: link para crearla, y lo que mandó lo espera.

Es la puerta de entrada que más convierte: la persona ya está en el chat, con
un gasto en la mano. Antes recibía "este número no está vinculado" y el gasto
se perdía; ahora recibe un link y, al crear la cuenta, ese gasto ya está.

Tres decisiones:
- **El link prueba el número.** Llegó por WhatsApp a ese número, así que
  canjearlo vincula el número sin el código de verificación (y apaga el paso
  obligatorio del alta). Es el mismo modelo de confianza que `auth_links`:
  quien tiene el chat tiene el número.
- **Sólo se guarda lo que parece una carga** (un gasto o un ingreso escrito),
  los últimos `MAX_MESSAGES`, durante `TTL_DAYS`. Un "hola" no se guarda, y la
  media tampoco: la persona la vuelve a mandar con la cuenta hecha.
- **Un link por día y por número.** Cada mensaje no rota el token: si lo
  hiciera, el link del mensaje anterior dejaría de andar mientras la persona
  todavía lo está abriendo. Uno nuevo sale recién cuando el anterior tiene más
  de `LINK_EVERY`.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.wa_signup_intent import WaSignupIntent
from app.services import income_capture, quick_capture
from app.services.participants import find_user_by_phone

TTL_DAYS = 7
MAX_MESSAGES = 5
LINK_EVERY = timedelta(hours=24)
TOKEN_PREFIX = "was_"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def _phone(jid_digits: str) -> str:
    digits = "".join(c for c in jid_digits if c.isdigit())
    return f"+{digits}"


# Lo que sólo tiene sentido en un negocio. Una compra o un pago también los
# carga un hogar (como gasto), así que no cuentan.
_BUSINESS_OPS = {"sale", "close", "production", "count", "ambiguous"}

HOME, BUSINESS, BUSINESS_HINT = "home", "biz", "biz_hint"


def classify(text: str) -> str | None:
    """Qué es el texto para el alta: HOME (gasto o ingreso, se guarda),
    BUSINESS (venta, cierre, producción o conteo, se guarda para un negocio),
    BUSINESS_HINT (parece del negocio pero no se puede cargar: sólo cambia la
    respuesta) o None. El negocio va primero: "3 empanadas 4500" también
    parsea como un gasto de $3."""
    from app.services.business import capture as business_capture
    from app.services.wa_bot import _BUSINESS_TEXT_RE

    text = (text or "").strip()
    if not text:
        return None
    intent = business_capture.parse_business_text(text)
    if intent is not None and intent.op in _BUSINESS_OPS:
        return BUSINESS
    if income_capture.parse_income_text(text) is not None or quick_capture.parse_quick_text(text) is not None:
        return HOME
    if intent is not None or _BUSINESS_TEXT_RE.search(text):
        return BUSINESS_HINT
    return None


def looks_like_capture(text: str) -> bool:
    return classify(text) in (HOME, BUSINESS)


def signup_link(raw: str) -> str:
    return f"{settings.FRONTEND_URL}/login?wa={raw}"


async def record(db: AsyncSession, phone: str, text: str) -> tuple[str | None, str | None]:
    """Anota el mensaje. Devuelve (token nuevo o None, `classify` del texto).
    Sólo flush."""
    now = datetime.now()
    row = await db.scalar(select(WaSignupIntent).where(WaSignupIntent.phone == _phone(phone)))
    if row is None:
        row = WaSignupIntent(phone=_phone(phone), messages=[], created_at=now, updated_at=now)
        db.add(row)
    elif row.claimed_at is not None or row.updated_at < now - timedelta(days=TTL_DAYS):
        # Ya se usó (la persona después desvinculó el número) o quedó viejo: de cero.
        row.messages, row.claimed_at, row.claimed_user_id, row.token_hash = [], None, None, None

    kind = classify(text)
    if kind in (HOME, BUSINESS):
        msgs = list(row.messages or [])
        msgs.append({"text": text.strip()[:500], "at": now.isoformat(timespec="seconds"),
                     **({"biz": True} if kind == BUSINESS else {})})
        row.messages = msgs[-MAX_MESSAGES:]
    row.updated_at = now

    raw = None
    if row.token_hash is None or row.link_sent_at is None or row.link_sent_at < now - LINK_EVERY:
        raw = TOKEN_PREFIX + secrets.token_urlsafe(24)
        row.token_hash = _hash(raw)
        row.link_sent_at = now
    await db.flush()
    return raw, kind


async def claim(db: AsyncSession, user, raw: str) -> tuple[list[str], int]:
    """Vincula el número del link a `user` y devuelve (los textos guardados
    para que el bot los procese, cuántos se dejaron afuera). Una venta sólo se
    carga en un negocio: en un hogar "vendí 3 empanadas 4500" sería un gasto de
    $3. Inválido, usado y vencido son el mismo 404 (sin oráculo). Sólo flush."""
    row = None
    if raw and raw.startswith(TOKEN_PREFIX):
        row = await db.scalar(select(WaSignupIntent).where(WaSignupIntent.token_hash == _hash(raw)))
    now = datetime.now()
    if row is None or row.claimed_at is not None or row.updated_at < now - timedelta(days=TTL_DAYS):
        raise HTTPException(status_code=404, detail="Ese link ya no sirve. Escribile de nuevo a tood y te manda otro.")

    if len(row.phone) > 20:  # no entra en users.whatsapp_phone: no es un número común
        raise HTTPException(status_code=404, detail="Ese link ya no sirve. Escribile de nuevo a tood y te manda otro.")
    other = await find_user_by_phone(row.phone, db)
    if other is not None and other.id != user.id:
        raise HTTPException(status_code=409, detail="Ese número ya está vinculado a otra cuenta de tood.")

    user.whatsapp_phone = row.phone
    user.whatsapp_pending_phone = None
    user.whatsapp_verify_code = None
    user.whatsapp_gate_pending = False
    from app.models.tenant import TENANT_KIND_BUSINESS, Tenant

    is_business = await db.scalar(select(Tenant.kind).where(Tenant.id == user.tenant_id)) == TENANT_KIND_BUSINESS
    msgs = [m for m in (row.messages or []) if m.get("text")]
    texts = [m["text"] for m in msgs if is_business or not m.get("biz")]
    row.claimed_at = now
    row.claimed_user_id = user.id
    row.token_hash = None
    row.messages = []
    await db.flush()
    return texts, len(msgs) - len(texts)


async def purge_old(db: AsyncSession) -> int:
    """Borra lo que tiene más de TTL_DAYS. Lo llama el job diario del bot."""
    rows = (await db.scalars(
        select(WaSignupIntent).where(WaSignupIntent.updated_at < datetime.now() - timedelta(days=TTL_DAYS))
    )).all()
    for r in rows:
        await db.delete(r)
    await db.flush()
    return len(rows)
