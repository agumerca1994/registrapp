"""Minting, verifying and revoking the credentials that reach `/mcp`.

Only hashes are stored. A token is shown to the user exactly once, at creation;
after that the only trace is its `token_prefix`, which is enough for Settings to
say *which* token you are about to revoke and nothing more.

The readable prefixes (`rap_pat_`, `rap_at_`, `rap_rt_`) are not decoration:
they let secret scanners recognise a leaked token, and they let the verifier
reject junk before touching the database.
"""
import hashlib
import secrets
from datetime import datetime, timedelta

from mcp.server.auth.provider import AccessToken, TokenVerifier
from sqlalchemy import delete, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.mcp_auth import McpAuthCode, McpOAuthAuthorization, McpOAuthClient, McpToken

READ_SCOPE = "registrapp:read"

PAT_PREFIX = "rap_pat_"
ACCESS_PREFIX = "rap_at_"
REFRESH_PREFIX = "rap_rt_"

KIND_PREFIX = {
    "pat": PAT_PREFIX,
    "oauth_access": ACCESS_PREFIX,
    "oauth_refresh": REFRESH_PREFIX,
}

# How stale `last_used_at` is allowed to get. Without this every single MCP
# request would issue an UPDATE.
LAST_USED_THROTTLE = timedelta(minutes=1)


def utcnow() -> datetime:
    """Naive UTC, matching the DateTime columns everywhere else in this app."""
    return datetime.utcnow()


def hash_token(raw: str) -> str:
    return hashlib.sha256(raw.encode()).hexdigest()


def generate_token(kind: str) -> tuple[str, str, str]:
    """Return `(raw, hash, display_prefix)` for a brand-new token."""
    prefix = KIND_PREFIX[kind]
    raw = prefix + secrets.token_urlsafe(32)
    return raw, hash_token(raw), raw[: len(prefix) + 4]


async def create_token(
    db: AsyncSession,
    *,
    kind: str,
    user_id: int,
    tenant_id: int,
    grant_id: str,
    scopes: str = READ_SCOPE,
    expires_at: datetime | None = None,
    client_id: str | None = None,
    client_name: str | None = None,
    name: str | None = None,
    resource: str | None = None,
    parent_id: int | None = None,
) -> tuple[str, McpToken]:
    """Insert a token row and hand back the raw secret — the only time it exists."""
    raw, digest, display = generate_token(kind)
    row = McpToken(
        tenant_id=tenant_id,
        user_id=user_id,
        kind=kind,
        token_hash=digest,
        token_prefix=display,
        grant_id=grant_id,
        parent_id=parent_id,
        client_id=client_id,
        client_name=client_name,
        name=name,
        scopes=scopes,
        resource=resource,
        expires_at=expires_at,
    )
    db.add(row)
    await db.flush()
    return raw, row


async def create_pat(
    db: AsyncSession,
    *,
    user_id: int,
    tenant_id: int,
    name: str,
    expires_in_days: int | None,
) -> tuple[str, McpToken]:
    """A personal access token, for clients that can send their own header."""
    expires_at = utcnow() + timedelta(days=expires_in_days) if expires_in_days else None
    return await create_token(
        db,
        kind="pat",
        user_id=user_id,
        tenant_id=tenant_id,
        # A PAT is its own grant, so revoking it by grant_id works like any other.
        grant_id=f"pat_{secrets.token_urlsafe(12)}",
        expires_at=expires_at,
        name=name,
        client_name="Token personal",
        resource=settings.MCP_RESOURCE_URL,
    )


async def load_token(db: AsyncSession, raw: str, kinds: tuple[str, ...]) -> McpToken | None:
    """A live (not revoked, not expired) token row matching `raw`."""
    if not raw.startswith(("rap_at_", "rap_pat_", "rap_rt_")):
        return None
    row = await db.scalar(
        select(McpToken).where(
            McpToken.token_hash == hash_token(raw),
            McpToken.kind.in_(kinds),
        )
    )
    if row is None or row.revoked_at is not None:
        return None
    if row.expires_at is not None and row.expires_at < utcnow():
        return None
    return row


async def revoke_grant(db: AsyncSession, grant_id: str, reason: str) -> int:
    """Kill an access token, its refresh token and every rotation of it."""
    result = await db.execute(
        update(McpToken)
        .where(McpToken.grant_id == grant_id, McpToken.revoked_at.is_(None))
        .values(revoked_at=utcnow(), revoked_reason=reason)
    )
    return result.rowcount or 0


class RegistrappTokenVerifier(TokenVerifier):
    """Resolves a bearer token into the household it belongs to.

    Runs on every MCP request, so it stays deliberately cheap: one indexed
    lookup by hash, and a write only when `last_used_at` is actually stale.
    """

    async def verify_token(self, token: str) -> AccessToken | None:
        if not token.startswith((ACCESS_PREFIX, PAT_PREFIX)):
            return None

        async with AsyncSessionLocal() as db:
            row = await load_token(db, token, ("oauth_access", "pat"))
            if row is None:
                return None

            # Audience check (RFC 8707). A token minted for some other resource
            # must not work here — this is the confused-deputy defence, and it's
            # the third place it gets enforced.
            if row.resource and row.resource != settings.MCP_RESOURCE_URL:
                return None

            now = utcnow()
            if row.last_used_at is None or now - row.last_used_at > LAST_USED_THROTTLE:
                row.last_used_at = now
                await db.commit()

            return AccessToken(
                token=token,
                client_id=row.client_id or "pat",
                scopes=row.scopes.split(),
                expires_at=int(row.expires_at.timestamp()) if row.expires_at else None,
                resource=row.resource,
                subject=f"user:{row.user_id}",
                claims={
                    "iss": settings.OAUTH_ISSUER_URL,
                    "user_id": row.user_id,
                    "tenant_id": row.tenant_id,
                    "client_name": row.client_name,
                },
            )


async def cleanup_expired() -> int:
    """Daily housekeeping: drop what can no longer be used.

    Kept conservative — revoked/expired tokens stick around for 30 days so the
    user can still see "revoked yesterday" in Settings, and dynamically
    registered clients only go once nothing references them.
    """
    now = utcnow()
    cutoff = now - timedelta(days=30)
    removed = 0

    async with AsyncSessionLocal() as db:
        r = await db.execute(delete(McpAuthCode).where(McpAuthCode.expires_at < now))
        removed += r.rowcount or 0

        r = await db.execute(
            delete(McpOAuthAuthorization).where(McpOAuthAuthorization.expires_at < now)
        )
        removed += r.rowcount or 0

        r = await db.execute(
            delete(McpToken).where(
                or_(
                    McpToken.revoked_at < cutoff,
                    McpToken.expires_at < cutoff,
                )
            )
        )
        removed += r.rowcount or 0

        live_clients = select(McpToken.client_id).where(McpToken.client_id.is_not(None))
        r = await db.execute(
            delete(McpOAuthClient).where(
                McpOAuthClient.created_at < cutoff,
                McpOAuthClient.client_id.not_in(live_clients),
            )
        )
        removed += r.rowcount or 0

        await db.commit()

    return removed
