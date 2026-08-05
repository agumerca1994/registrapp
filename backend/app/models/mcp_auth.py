"""Tables behind the MCP connector's authentication.

Four tables, one per stage of the OAuth flow plus the tokens themselves:

    mcp_oauth_clients        an app that registered itself (RFC 7591 DCR)
    mcp_oauth_authorizations a consent request waiting for the user to approve
    mcp_auth_codes           a one-shot code, already approved, not yet exchanged
    mcp_tokens               every live credential — OAuth *and* personal tokens

`mcp_tokens` holds both kinds on purpose: the verifier does one lookup by hash
and doesn't care which it found, Settings lists both with one query, and
revoking anything is always "set revoked_at".
"""
from datetime import datetime

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class McpOAuthClient(Base):
    """An OAuth client, almost always created by dynamic registration."""

    __tablename__ = "mcp_oauth_clients"

    client_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    # Stored in the clear: the SDK's ClientAuthenticator compares it with
    # hmac.compare_digest against what get_client() returns, so a hash can't be
    # used without reimplementing that. Safe enough here — PKCE S256 is
    # mandatory, so the secret alone buys an attacker nothing, and most MCP
    # clients register as public (token_endpoint_auth_method="none").
    client_secret: Mapped[str | None] = mapped_column(String(128), nullable=True)
    client_secret_expires_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    client_id_issued_at: Mapped[int | None] = mapped_column(BigInteger, nullable=True)

    client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    client_uri: Mapped[str | None] = mapped_column(String(500), nullable=True)
    logo_uri: Mapped[str | None] = mapped_column(String(500), nullable=True)

    redirect_uris: Mapped[list] = mapped_column(JSONB, default=list)
    grant_types: Mapped[list] = mapped_column(JSONB, default=list)
    response_types: Mapped[list] = mapped_column(JSONB, default=list)
    scope: Mapped[str | None] = mapped_column(String(200), nullable=True)
    token_endpoint_auth_method: Mapped[str | None] = mapped_column(String(40), nullable=True)

    software_id: Mapped[str | None] = mapped_column(String(100), nullable=True)
    software_version: Mapped[str | None] = mapped_column(String(50), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class McpOAuthAuthorization(Base):
    """A pending consent screen: everything needed to mint a code once approved.

    The user's identity is deliberately absent — it only exists after they log
    in with Google and press "Autorizar".
    """

    __tablename__ = "mcp_oauth_authorizations"

    txn_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    redirect_uri: Mapped[str] = mapped_column(String(700))
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(default=False)
    state: Mapped[str | None] = mapped_column(String(500), nullable=True)
    scopes: Mapped[str] = mapped_column(String(300))
    code_challenge: Mapped[str] = mapped_column(String(200))
    resource: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class McpAuthCode(Base):
    """An authorization code, stored hashed and burned on first exchange."""

    __tablename__ = "mcp_auth_codes"

    code_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    client_id: Mapped[str] = mapped_column(String(64), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"))
    scopes: Mapped[str] = mapped_column(String(300))
    code_challenge: Mapped[str] = mapped_column(String(200))
    redirect_uri: Mapped[str] = mapped_column(String(700))
    redirect_uri_provided_explicitly: Mapped[bool] = mapped_column(default=False)
    resource: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class McpToken(Base):
    """A credential that can reach /mcp: personal token or OAuth access/refresh.

    Only the sha256 of the token is stored — `token_prefix` exists purely so
    Settings can show something recognisable next to the "revoke" button.
    """

    __tablename__ = "mcp_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    kind: Mapped[str] = mapped_column(String(20))  # pat | oauth_access | oauth_refresh
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    token_prefix: Mapped[str] = mapped_column(String(24))

    # Ties an access token to its refresh token and to every later rotation, so
    # "disconnect this app" is a single UPDATE by grant_id.
    grant_id: Mapped[str] = mapped_column(String(64), index=True)
    parent_id: Mapped[int | None] = mapped_column(
        ForeignKey("mcp_tokens.id", ondelete="SET NULL"), nullable=True
    )

    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    client_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    name: Mapped[str | None] = mapped_column(String(100), nullable=True)  # user label, PAT only

    scopes: Mapped[str] = mapped_column(String(300))
    resource: Mapped[str | None] = mapped_column(String(300), nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # user | rotated | reuse_detected | grant_revoked
    revoked_reason: Mapped[str | None] = mapped_column(String(40), nullable=True)
