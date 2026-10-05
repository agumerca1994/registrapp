"""Webhook del bot de WhatsApp (Evolution API).

El router sólo hace tres cosas: autenticar el webhook, normalizar el payload
y mandar las respuestas DESPUÉS del commit. Todo lo que el bot entiende y
hace vive en `services/wa_bot.py`, que llama a los mismos servicios que la
app y el MCP (`quick_capture`, `reconcile`) — el canal traduce, el motor
decide.

Qué entiende el bot hoy:
- texto libre ("12 lucas verdu", "usd 20 regalo ayer") y el formato
  histórico `monto categoria` (que conserva su semántica, categoría nueva
  incluida);
- el PDF del resumen de la tarjeta → conciliación completa con veredicto;
- *deshacer*, *editar monto …*, *editar categoría …*, respuestas "1"/"2" y
  responder citando un mensaje anterior;
- imagen/audio → se registra en el embudo (`capture_events`) y se ofrece el
  plan Pro — es la medición de la IA de respaldo, no una promesa.
"""
import logging
import secrets

from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.services import wa_bot
from app.services.participants import find_user_by_phone
from app.services.whatsapp import send_wa_msg

router = APIRouter(prefix="/webhook", tags=["webhook"])
logger = logging.getLogger(__name__)

# Re-exports: el service de captura rápida es el dueño de estas constantes,
# pero este módulo fue su casa histórica y hay quien las importa de acá.
from app.services.quick_capture import CATEGORY_COLORS as COLORS  # noqa: E402,F401
from app.services.quick_capture import MAX_AMOUNT  # noqa: E402,F401
from app.services.wa_bot import MSG_ERROR, MSG_NOT_LINKED  # noqa: E402,F401


@router.post("/whatsapp")
async def whatsapp_webhook(
    payload: dict,
    x_webhook_secret: str = Header(default=""),
    secret: str = "",
    db: AsyncSession = Depends(get_db),
):
    # Accept the shared secret via header (x-webhook-secret) or query string
    # (?secret=) — some Evolution API panels don't support custom webhook
    # headers, so the query param is the fallback that always works.
    #
    # Fails *closed* when the secret isn't configured. It used to log a warning
    # and keep going, and docker-compose.prod.yml passes
    # `${WHATSAPP_WEBHOOK_SECRET:-}` — so forgetting the env var in Easypanel
    # left this endpoint unauthenticated on the public internet, and the handler
    # below picks the household straight out of the attacker-supplied remoteJid.
    if not settings.WHATSAPP_WEBHOOK_SECRET:
        logger.error("WHATSAPP_WEBHOOK_SECRET no configurado — /webhook/whatsapp deshabilitado")
        raise HTTPException(status_code=503, detail="Webhook no configurado")
    if not any(
        secrets.compare_digest(settings.WHATSAPP_WEBHOOK_SECRET, candidate)
        for candidate in (x_webhook_secret or "", secret or "")
    ):
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        inbound = wa_bot.parse_evolution_payload(payload)
    except Exception as e:
        logger.error(f"WA webhook parse error: {e}")
        return {"status": "error"}
    if inbound is None:
        return {"status": "ignored"}

    # `find_user_by_phone` y NO `==`: el JID entrante viene sin `+`
    # ("5493834373344@s.whatsapp.net"), mientras que `verify_whatsapp` guarda el
    # número normalizado CON `+`. La comparación exacta no matcheaba nunca, así
    # que el bot contestaba "número no vinculado" a gente que sí lo tenía
    # vinculado — recibía los avisos de gastos compartidos (esos sí usan la
    # búsqueda tolerante) pero no podía cargar un gasto por chat.
    #
    # Es exactamente lo que el CLAUDE.md advierte que no se haga, y el motivo es
    # el mismo de siempre: el fallo no da error, sólo no encuentra.
    user = await find_user_by_phone(inbound.phone, db)
    if not user:
        # Se registra a propósito: este rechazo devuelve 200, así que el
        # middleware de errores no lo ve y no dejaba ningún rastro. Un usuario
        # que sí estaba vinculado y recibía este mensaje era invisible en los
        # logs — que es justo lo que hizo tan difícil encontrar el bug del `==`.
        logger.warning("WhatsApp: mensaje de %s, sin usuario vinculado con ese número", inbound.phone)
        await send_wa_msg(inbound.phone, MSG_NOT_LINKED)
        return {"status": "not_linked"}

    # Idempotencia: Evolution reintenta el webhook y un reintento no puede
    # crear el gasto (ni aplicar la conciliación) dos veces.
    if await wa_bot.already_seen(db, user.id, inbound.wa_id):
        return {"status": "duplicate"}

    # El bot escribe y commitea; las respuestas salen recién después — un
    # mensaje nunca anuncia algo que no quedó guardado.
    replies = await wa_bot.handle(db, user, inbound)
    for reply in replies:
        await send_wa_msg(inbound.phone, reply)
    return {"status": "ok", "replies": len(replies)}
