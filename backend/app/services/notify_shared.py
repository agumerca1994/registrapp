"""Avisar que se compartió un gasto.

Existe porque los dos caminos que comparten un gasto avisaban distinto:
`POST /shared-expenses` mandaba push y WhatsApp, y
`POST /credit-cards/items/{id}/share` mandaba **sólo WhatsApp** — o sea que
compartir la cuota de una tarjeta no le llegaba a nadie que no hubiera
vinculado su número, que es la mayoría.

Tres reglas, todas heredadas de cómo ya funcionaba `services/push.py`:

- **Push primero y sin condición** para todo usuario resuelto. Es la base: no
  necesita número vinculado y cae dentro de la app.
- **WhatsApp después, y sólo si hay número y el destinatario lo quiere**
  (`users.whatsapp_notifications`). Es un canal secundario y opcional.
- **Mail no existe como canal.** Se decidió no mandar mails: el aviso del
  sistema alcanza para quien tiene cuenta, y WhatsApp cubre a quien no. Invitar
  por mail sigue sirviendo para *identificar* a alguien —el día que se registre
  con esa dirección el gasto lo está esperando— pero no se le envía nada, y la
  pantalla lo dice en vez de simularlo.
- **Nada de esto puede levantar una excepción.** Se llama después del commit:
  el gasto ya existe, y perderlo por un aviso sería el peor intercambio
  posible.
"""

from __future__ import annotations

import logging
from decimal import Decimal

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services import push, whatsapp

logger = logging.getLogger(__name__)


async def notify_share(
    db: AsyncSession,
    *,
    creator_name: str,
    title: str,
    total_amount: Decimal,
    notify: list[tuple[int, Decimal]],
    invites: list[tuple[str, str]],
    cuotas_count: int = 1,
) -> None:
    """Avisa a participantes registrados (`notify`) e invitados (`invites`).

    `notify` es `(user_id, monto de su parte)`; `invites` es `(teléfono, token)`.
    """
    try:
        user_ids = [uid for uid, _ in notify]
        if user_ids:
            await push.send_to_users(
                db,
                user_ids,
                title="Te compartieron un gasto",
                body=f"{creator_name}: {title}",
                path="/shared",
            )
    except Exception:
        logger.exception("notify_share: falló el push de '%s'", title)

    for phone, token in invites:
        try:
            await whatsapp.send_whatsapp_invite(
                phone, creator_name, title, total_amount, token, cuotas_count
            )
        except Exception:
            logger.exception("notify_share: falló la invitación por WhatsApp de '%s'", title)

    for uid, split_amount in notify:
        try:
            member = await db.get(User, uid)
            # Dos condiciones, no una: tener el número vinculado y **querer**
            # recibir por ahí. El push ya salió más arriba y no se puede apagar
            # — es el canal que no depende de nada externo.
            if member and member.whatsapp_phone and member.whatsapp_notifications:
                await whatsapp.send_whatsapp_member_notify(
                    member.whatsapp_phone, creator_name, title,
                    total_amount, split_amount, cuotas_count,
                )
        except Exception:
            logger.exception("notify_share: falló el WhatsApp a user %s", uid)
