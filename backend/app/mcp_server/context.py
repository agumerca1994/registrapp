"""Who is calling a tool, and how it gets a database session.

The authenticated caller does NOT arrive as a header. The chain is:

    BearerAuthBackend  → verifies the token, puts an AuthenticatedUser in scope
    AuthContextMiddleware → copies it into a contextvar
    get_access_token() → reads that contextvar from inside the tool

The contextvar survives the task hop the streamable-HTTP transport does in
stateless mode (anyio copies the caller's context into the spawned task).

`tenant_id` travels inside `AccessToken.claims`, deliberately: a tool must never
load a `User` row and touch `user.tenant`, since that lazy relationship raises
MissingGreenlet under async.
"""
import logging
from contextlib import asynccontextmanager
from dataclasses import dataclass

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import AsyncSessionLocal
from app.models.user import User

logger = logging.getLogger(__name__)

READ_SCOPE = "registrapp:read"


@dataclass(frozen=True)
class McpCaller:
    user_id: int
    tenant_id: int
    scopes: tuple[str, ...]
    client_name: str | None = None

    def require_read(self) -> None:
        if READ_SCOPE not in self.scopes:
            raise ToolError("El token no tiene permiso de lectura (registrapp:read)")


async def _dev_caller(db: AsyncSession) -> McpCaller:
    """Local-only fallback when MCP_AUTH_DISABLED is on.

    Picks the lowest-id user so the Inspector can drive the tools without
    minting a token. `Settings` forces MCP_AUTH_DISABLED off in production, so
    this can never run there.
    """
    user = await db.scalar(select(User).order_by(User.id).limit(1))
    if user is None:
        raise ToolError("No hay usuarios en la base de datos (modo dev sin auth)")
    logger.warning("MCP running without auth — using dev user %s", user.email)
    return McpCaller(
        user_id=user.id, tenant_id=user.tenant_id, scopes=(READ_SCOPE,), client_name="dev"
    )


async def current_caller(db: AsyncSession) -> McpCaller:
    """The household behind the bearer token of the current request."""
    token = get_access_token()
    if token is None:
        if settings.MCP_AUTH_DISABLED:
            return await _dev_caller(db)
        raise ToolError("No autenticado")

    claims = token.claims or {}
    if "tenant_id" not in claims or "user_id" not in claims:
        raise ToolError("Token sin identidad de hogar")

    caller = McpCaller(
        user_id=int(claims["user_id"]),
        tenant_id=int(claims["tenant_id"]),
        scopes=tuple(token.scopes),
        client_name=claims.get("client_name"),
    )
    caller.require_read()
    return caller


@asynccontextmanager
async def tool_session():
    """A database session for a tool call.

    `get_db()` is a FastAPI dependency and can't be used here — tools run
    outside the request/response dependency graph.
    """
    async with AsyncSessionLocal() as session:
        yield session
