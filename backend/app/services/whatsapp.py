"""Envío de mensajes por WhatsApp (Evolution API).

Vive en `services/` y no en un router porque lo usan cosas que no tienen nada
que ver entre sí: los gastos compartidos, el OTP de vinculación en `auth.py` y
los recordatorios diarios de pago en `reminders.py`.

La regla que cumple todo lo de acá: **nunca levanta excepción**. Un mensaje que
no sale es un aviso perdido; una excepción es la operación entera perdida.
"""

from __future__ import annotations

import asyncio
import base64
import logging
import re
from decimal import Decimal

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


async def send_wa_msg(phone: str, msg: str) -> str | None:
    """Manda el texto y devuelve el id del mensaje enviado (`key.id` de
    Evolution), o None. El bot lo guarda para que responder citando su
    confirmación apunte al gasto que confirma."""
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        logger.info("Evolution API not configured, skipping WhatsApp send")
        return None
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
                return None
            logger.info(f"WhatsApp sent to {phone} (resolved {target}): {resp.status_code}")
            try:
                return ((resp.json() or {}).get("key") or {}).get("id")
            except ValueError:
                return None
    except Exception as e:
        logger.warning(f"WhatsApp send error to {phone}: {e}")
        return None


_sticker_cache: dict[str, str] = {}


async def _sticker_base64(client: httpx.AsyncClient, url: str) -> str | None:
    if url not in _sticker_cache:
        resp = await client.get(url)
        if resp.status_code != 200 or not resp.content.startswith(b"RIFF"):
            logger.warning(f"Sticker no disponible {resp.status_code}: {url}")
            return None
        _sticker_cache[url] = base64.b64encode(resp.content).decode()
    return _sticker_cache[url]


async def send_wa_sticker(phone: str, url: str) -> str | None:
    """Manda un sticker (WebP animado, 512×512, menos de 500 KB) desde una URL pública. Igual que el texto:
    nunca levanta excepción y deja en el log por qué no salió.

    Va en base64 con `notConvertSticker`: desde una URL, Evolution lo vuelve a codificar cuadro por cuadro,
    unos 4 s por sticker, aunque ya venga en el formato justo. La URL queda de respaldo."""
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        return None
    try:
        async with httpx.AsyncClient(timeout=20) as client:
            resolved = await resolve_whatsapp_jid(client, phone)
            target = resolved or phone.lstrip("+")
            encoded = await _sticker_base64(client, url)
            attempts = [{"sticker": encoded, "notConvertSticker": True}] if encoded else []
            for body in [*attempts, {"sticker": url}]:
                resp = await client.post(
                    f"{settings.EVOLUTION_API_URL}/message/sendSticker/{settings.EVOLUTION_INSTANCE}",
                    json={"number": target, **body},
                    headers={"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"},
                )
                if resp.status_code < 400:
                    try:
                        return ((resp.json() or {}).get("key") or {}).get("id")
                    except ValueError:
                        return None
                logger.warning(f"WhatsApp sticker failed {resp.status_code} to {phone}: {resp.text[:300]}")
            return None
    except Exception as e:
        logger.warning(f"WhatsApp sticker error to {phone}: {e}")
        return None


async def download_media_base64(message_key: dict, raw_message: dict | None = None) -> bytes | None:
    """Baja el adjunto de un mensaje entrante vía Evolution
    (`/chat/getBase64FromMediaMessage/{instance}`) y devuelve los bytes.

    Nunca levanta excepción: None significa "no se pudo", y el cuerpo de la
    respuesta queda en el log — la lección de siempre con Evolution es que un
    2xx a medias o un rechazo sin loguear deja el reporte "no me anda" sin un
    solo rastro. Se manda la key entera y el message crudo porque las
    versiones de Evolution difieren en cuál de los dos exigen.

    Reintenta: cuando Evolution no alcanza el CDN de WhatsApp contesta 400
    "fetch failed", y es pasajero (2026-11-05: dos fotos y un audio seguidos
    en un minuto, y antes y después todo anduvo). A la primera ya le
    pedíamos a la persona que lo mandara de nuevo.
    """
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        logger.info("Evolution API not configured, skipping media download")
        return None
    body: dict = {"message": {"key": message_key}, "convertToMp4": False}
    if raw_message:
        body["message"]["message"] = raw_message
    for attempt, wait in enumerate(MEDIA_RETRY_WAITS):
        if wait:
            await asyncio.sleep(wait)
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                resp = await client.post(
                    f"{settings.EVOLUTION_API_URL}/chat/getBase64FromMediaMessage/{settings.EVOLUTION_INSTANCE}",
                    json=body,
                    headers={"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"},
                )
            if resp.status_code >= 400:
                logger.warning(
                    "WhatsApp media download failed %s (intento %s): %s",
                    resp.status_code, attempt + 1, resp.text[:300],
                )
                # Un 401/404 no se arregla esperando; un 400 de "fetch failed" o un 5xx sí.
                if resp.status_code in (401, 403, 404):
                    return None
                continue
            data = resp.json()
            b64 = data.get("base64") or data.get("media")
            if not b64:
                logger.warning("WhatsApp media download sin base64 en la respuesta: %s",
                               str(data)[:300])
                continue
            if attempt:
                logger.info("WhatsApp media download ok en el intento %s", attempt + 1)
            return base64.b64decode(b64)
        except Exception as e:
            logger.warning("WhatsApp media download error (intento %s): %s", attempt + 1, e)
    return None


# Esperas antes de cada intento. Suman ~6 s: con el audio, el sticker de
# "escuchando" ya salió, así que la espera no se ve como un bot colgado.
MEDIA_RETRY_WAITS = (0, 2, 4)


def fmt_number(amount) -> str:
    """12000 → "12.000", 20.5 → "20,50". Sin ",00": en un chat nadie lo escribe."""
    text = f"{Decimal(str(amount)):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return text[:-3] if text.endswith(",00") else text


def _money(amount, currency: str = "ARS") -> str:
    """Un monto con su símbolo. Antes todo salía con "$", también los gastos en
    dólares, y el invitado leía un importe en pesos que no era. Un número se
    formatea acá; un texto ya formateado pasa tal cual."""
    shown = amount if isinstance(amount, str) else fmt_number(amount)
    return f"U$D {shown}" if currency == "USD" else f"${shown}"


async def send_whatsapp_invite(phone: str, creator_name: str, title: str, amount, token: str, cuotas_count: int = 1, currency: str = "ARS") -> None:
    link = f"{settings.FRONTEND_URL}/invite/{token}"
    if cuotas_count > 1:
        msg = (
            f"¡Hola! {creator_name} te invitó a compartir un gasto: *{title}*, "
            f"en {cuotas_count} cuotas de {_money(amount, currency)}.\n\nEntrá al link para ver el detalle y aceptarlas:\n{link}"
        )
    else:
        msg = (
            f"¡Hola! {creator_name} te invitó a compartir un gasto: *{title}*, "
            f"por {_money(amount, currency)}.\n\nEntrá al link para verlo y aceptarlo:\n{link}"
        )
    await send_wa_msg(phone, msg)


async def send_whatsapp_member_notify(phone: str, creator_name: str, title: str, total_amount, split_amount, cuotas_count: int = 1, currency: str = "ARS") -> None:
    app_url = f"{settings.FRONTEND_URL}/shared"
    if cuotas_count > 1:
        msg = (
            f"¡Hola! {creator_name} compartió con vos el gasto *{title}*, "
            f"en {cuotas_count} cuotas de {_money(total_amount, currency)}.\nTu parte por cuota: {_money(split_amount, currency)}.\n"
            f"Aceptalas en la app: {app_url}"
        )
    else:
        msg = (
            f"¡Hola! {creator_name} compartió con vos el gasto *{title}*, "
            f"por {_money(total_amount, currency)}.\nTu parte: {_money(split_amount, currency)}.\n"
            f"Aceptalo en la app: {app_url}"
        )
    await send_wa_msg(phone, msg)
