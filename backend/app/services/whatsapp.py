"""Envío de mensajes por WhatsApp (Evolution API).

Vive en `services/` y no en un router porque lo usan cosas que no tienen nada
que ver entre sí: los gastos compartidos, el OTP de vinculación en `auth.py` y
los recordatorios diarios de pago en `reminders.py`.

La regla que cumple todo lo de acá: **nunca levanta excepción**. Un mensaje que
no sale es un aviso perdido; una excepción es la operación entera perdida.
"""

from __future__ import annotations

import logging
import re

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)


async def resolve_whatsapp_jid(client: httpx.AsyncClient, phone: str) -> str | None:
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


async def send_wa_msg(phone: str, msg: str) -> None:
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        logger.info("Evolution API not configured, skipping WhatsApp send")
        return
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resolved = await resolve_whatsapp_jid(client, phone)
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


async def send_whatsapp_invite(phone: str, creator_name: str, title: str, amount, token: str, cuotas_count: int = 1) -> None:
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
    await send_wa_msg(phone, msg)


async def send_whatsapp_member_notify(phone: str, creator_name: str, title: str, total_amount, split_amount, cuotas_count: int = 1) -> None:
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
    await send_wa_msg(phone, msg)
