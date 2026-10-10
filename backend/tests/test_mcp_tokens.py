"""Un token del MCP vale mientras su titular siga siendo de ese hogar.

El token lleva grabado el `tenant_id` con el que se creó, y sacar a alguien del
hogar lo mueve de tenant sin tocar sus tokens. Sin el chequeo, su conector
seguía leyendo y escribiendo el hogar viejo.
"""
from types import SimpleNamespace

import pytest
from mcp.server.auth.provider import TokenError
from sqlalchemy import select

from app.models.mcp_auth import McpToken
from app.models.tenant import Tenant
from app.models.user import User
from app.services import mcp_tokens, oauth_provider
from app.services.mcp_tokens import (
    RegistrappTokenVerifier, create_pat, create_token, token_holder_valid,
)
from app.services.oauth_provider import RegistrappOAuthProvider, RegistrappRefreshToken


class _SameSession:
    """Context manager de clase y no `asynccontextmanager`: ese reasigna
    `exc.__traceback__` al propagar, y `TokenError` del SDK es una dataclass
    congelada — el test fallaría por el helper y no por el código."""

    def __init__(self, db):
        self.db = db

    async def __aenter__(self):
        return self.db

    async def __aexit__(self, *_exc):
        return False


@pytest.fixture
def shared_session(monkeypatch, db):
    """El verificador y el provider abren su propia sesión; acá usan la del test."""
    monkeypatch.setattr(mcp_tokens, "AsyncSessionLocal", lambda: _SameSession(db))
    monkeypatch.setattr(oauth_provider, "AsyncSessionLocal", lambda: _SameSession(db))
    return db


async def _setup(db):
    old, new = Tenant(name="Casa vieja"), Tenant(name="Casa nueva")
    db.add_all([old, new])
    await db.flush()
    user = User(firebase_uid="uid-1", tenant_id=old.id, email="ana@example.com")
    db.add(user)
    await db.flush()
    return old, new, user


async def test_holder_valid_until_the_user_moves(db):
    old, new, user = await _setup(db)
    _, row = await create_pat(db, user_id=user.id, tenant_id=old.id, name="test", expires_in_days=None)

    assert await token_holder_valid(db, row)
    user.tenant_id = new.id
    await db.flush()
    assert not await token_holder_valid(db, row)


async def test_verify_rejects_a_pat_of_someone_who_left(shared_session):
    db = shared_session
    old, new, user = await _setup(db)
    raw, _ = await create_pat(db, user_id=user.id, tenant_id=old.id, name="test", expires_in_days=None)

    ok = await RegistrappTokenVerifier().verify_token(raw)
    assert ok is not None and ok.claims["tenant_id"] == old.id

    # Lo sacan del hogar: el PAT no vence nunca, pero deja de servir ya.
    user.tenant_id = new.id
    await db.flush()
    assert await RegistrappTokenVerifier().verify_token(raw) is None


async def test_refresh_of_someone_who_left_kills_the_grant(shared_session):
    db = shared_session
    old, new, user = await _setup(db)
    raw, row = await create_token(
        db, kind="oauth_refresh", user_id=user.id, tenant_id=old.id,
        grant_id="g1", client_id="c1", resource=mcp_tokens.settings.MCP_RESOURCE_URL,
    )
    user.tenant_id = new.id
    await db.flush()

    refresh = RegistrappRefreshToken(
        token=raw, client_id="c1", scopes=["registrapp:read"], expires_at=None,
        row_id=row.id, user_id=user.id, tenant_id=old.id, grant_id="g1",
    )
    with pytest.raises(TokenError):
        await RegistrappOAuthProvider().exchange_refresh_token(
            SimpleNamespace(client_id="c1"), refresh, []
        )

    # No se emitió un par nuevo, y la concesión quedó revocada con el motivo.
    rows = (await db.scalars(select(McpToken).where(McpToken.grant_id == "g1"))).all()
    assert len(rows) == 1
    assert rows[0].revoked_at is not None
    assert rows[0].revoked_reason == "holder_moved"
