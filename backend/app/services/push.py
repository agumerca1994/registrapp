"""Envío de notificaciones push por Firebase Cloud Messaging.

No agrega ningún proveedor nuevo: `firebase_admin` ya estaba en el proyecto
para verificar los tokens de Auth, y la misma credencial sirve para mandar.

Dos reglas que cumple todo lo de acá:

- **Un fallo mandando nunca tumba el request que lo originó.** Compartir un
  gasto tiene que funcionar aunque FCM esté caído, igual que ya pasa con
  WhatsApp: se loguea y se sigue. Un push que no sale es un aviso perdido; un
  500 al compartir es el gasto perdido.
- **Los tokens muertos se borran solos.** FCM rota tokens y deja de entregar
  sin avisar; si nadie los limpia, la tabla se llena de destinos inválidos y
  cada envío arrastra el error. Cuando FCM responde que un token no existe más,
  esa fila se va.
"""

from __future__ import annotations

import asyncio
import logging

from firebase_admin import messaging
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.device_token import DeviceToken

logger = logging.getLogger(__name__)


async def tokens_for_users(db: AsyncSession, user_ids: list[int]) -> list[DeviceToken]:
    if not user_ids:
        return []
    rows = await db.scalars(
        select(DeviceToken).where(DeviceToken.user_id.in_(user_ids))
    )
    return list(rows.all())


async def register_token(
    db: AsyncSession, *, user_id: int, tenant_id: int, token: str, platform: str | None
) -> DeviceToken:
    """Alta o refresco de un token.

    El mismo navegador devuelve el mismo token siempre, así que registrarse dos
    veces tiene que ser idempotente. Y si el token ya estaba a nombre de otra
    persona — dos cuentas en un mismo navegador — pasa a ser de quien lo
    registra ahora: es esa persona la que está mirando esa pantalla.
    """
    existing = await db.scalar(select(DeviceToken).where(DeviceToken.token == token))
    if existing:
        existing.user_id = user_id
        existing.tenant_id = tenant_id
        existing.platform = platform or existing.platform
        existing.last_seen_at = func.now()
        await db.commit()
        await db.refresh(existing)
        return existing

    row = DeviceToken(user_id=user_id, tenant_id=tenant_id, token=token, platform=platform)
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row


async def unregister_token(db: AsyncSession, token: str) -> None:
    await db.execute(delete(DeviceToken).where(DeviceToken.token == token))
    await db.commit()


async def _drop_tokens(db: AsyncSession, tokens: list[str]) -> None:
    if not tokens:
        return
    await db.execute(delete(DeviceToken).where(DeviceToken.token.in_(tokens)))
    await db.commit()
    logger.info("push: %d token(s) muertos eliminados", len(tokens))


async def send_to_users(
    db: AsyncSession,
    user_ids: list[int],
    *,
    title: str,
    body: str,
    path: str = "/shared",
) -> int:
    """Manda un aviso a todos los dispositivos de esos usuarios.

    Devuelve cuántos envíos salieron bien. Nunca levanta excepción: el que la
    llama está en medio de una operación que ya se commiteó.
    """
    rows = await tokens_for_users(db, user_ids)
    if not rows:
        return 0

    # `data` viaja además del `notification` porque es lo único que el service
    # worker puede leer para saber a dónde llevar al usuario cuando toca el
    # aviso. El `notification` lo pinta el sistema operativo; el `data` es
    # nuestro, y lleva la ruta relativa.
    #
    # `fcm_options.link`, en cambio, exige una URL absoluta y HTTPS: pasarle
    # "/shared" hace que firebase-admin levante ValueError al ARMAR el mensaje,
    # antes de tocar la red — o sea que rompe igual con FCM perfectamente
    # configurado. Por eso se construye desde FRONTEND_URL, y se omite cuando no
    # es https (dev local sobre http): el service worker igual sabe navegar con
    # `data.url`, así que no se pierde nada.
    link = f"{settings.FRONTEND_URL.rstrip('/')}{path}"
    fcm_options = (
        messaging.WebpushFCMOptions(link=link) if link.startswith("https://") else None
    )

    message = messaging.MulticastMessage(
        tokens=[r.token for r in rows],
        notification=messaging.Notification(title=title, body=body),
        data={"url": path},
        webpush=messaging.WebpushConfig(
            notification=messaging.WebpushNotification(
                title=title, body=body, icon="/icon", badge="/icon", tag="registrapp"
            ),
            fcm_options=fcm_options,
        ),
    )

    try:
        # `send_each_for_multicast` es sincrónico y hace I/O de red. Llamarlo
        # derecho desde acá trabaría el event loop de todo el backend mientras
        # habla con Google, así que va a un thread.
        response = await asyncio.to_thread(messaging.send_each_for_multicast, message)
    except Exception:
        # FCM caído, credencial mal, proyecto sin Cloud Messaging habilitado.
        logger.exception("push: no se pudo enviar a %d dispositivo(s)", len(rows))
        return 0

    dead: list[str] = []
    for row, result in zip(rows, response.responses):
        if result.success:
            continue
        err = getattr(result.exception, "code", None) or str(result.exception)
        # Estos dos significan "este destino ya no existe", no "falló ahora".
        if err in ("registration-token-not-registered", "invalid-argument", "NOT_FOUND", "UNREGISTERED"):
            dead.append(row.token)
        else:
            logger.warning("push: fallo enviando a un dispositivo: %s", err)

    await _drop_tokens(db, dead)
    return response.success_count
