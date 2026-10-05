"""Tokens de auto-login para los links que el bot manda por WhatsApp.

El problema que resuelven: WhatsApp abre los links en su navegador interno,
que no comparte sesión con nada — y ahí el login de Google directamente no
funciona. El bot ya sabe quién es el destinatario (número vinculado), así que
el link lleva un token de un solo uso que la página canjea por un *custom
token* de Firebase: la sesión se abre sin Google, sin popup y sin redirect.

El token es una credencial temporal dentro del chat del usuario con el bot —
el mismo modelo de confianza que los links de invitación de gastos
compartidos. Lo que lo mantiene acotado:
- **un solo uso** (`used_at`), 15 minutos de vida;
- sólo se guarda el **sha256**, nunca el token (como `mcp_tokens`);
- se emite únicamente hacia el número vinculado del usuario;
- canjearlo no revela por qué falló (inválido, usado y vencido son el mismo
  401) — un código distinto por causa sería un oráculo.
"""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.auth_link_token import AuthLinkToken

TTL_MINUTES = 15
TOKEN_PREFIX = "wat_"


def _hash(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


async def mint_token(db: AsyncSession, user_id: int, purpose: str = "wa_link") -> str:
    """Crea un token y devuelve el valor en claro (única vez que existe).
    Sólo flush — el commit es del caller."""
    raw = TOKEN_PREFIX + secrets.token_urlsafe(32)
    db.add(AuthLinkToken(
        user_id=user_id,
        token_hash=_hash(raw),
        purpose=purpose,
        expires_at=datetime.now() + timedelta(minutes=TTL_MINUTES),
    ))
    await db.flush()
    return raw


async def redeem_token(db: AsyncSession, raw: str) -> int | None:
    """Canjea un token: lo marca usado y devuelve el user_id, o None.
    Sólo flush — el commit es del caller."""
    if not raw or not raw.startswith(TOKEN_PREFIX):
        return None
    row = await db.scalar(
        select(AuthLinkToken).where(AuthLinkToken.token_hash == _hash(raw))
    )
    if row is None or row.used_at is not None or row.expires_at < datetime.now():
        return None
    row.used_at = datetime.now()
    await db.flush()
    return row.user_id


async def purge_expired(db: AsyncSession) -> int:
    """Borra tokens vencidos hace más de un día. Lo llama el job diario."""
    cutoff = datetime.now() - timedelta(days=1)
    rows = (await db.scalars(
        select(AuthLinkToken).where(AuthLinkToken.expires_at < cutoff)
    )).all()
    for r in rows:
        await db.delete(r)
    await db.flush()
    return len(rows)
