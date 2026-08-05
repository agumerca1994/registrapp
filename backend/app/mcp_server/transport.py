"""Mounting the MCP server inside the existing FastAPI app.

Three things here are load-bearing and easy to get wrong:

1. **Exact route, not a Mount.** `app.mount("/mcp", ...)` makes Starlette answer
   `POST /mcp` with a 307 to `/mcp/`. Clients mostly follow it, but the RFC 8707
   canonical resource then has two spellings. A plain `Route` with an ASGI app
   as its endpoint is what FastMCP does internally anyway.
2. **`transport_security`** — see `instance.py`.
3. **The session manager has to be started by the app's lifespan** (see
   `app/main.py`). A mounted sub-app's lifespan never runs, and without it the
   first request dies with "Task group is not initialized", stateless or not.
"""
import logging

from mcp.server.auth.middleware.auth_context import AuthContextMiddleware
from mcp.server.auth.middleware.bearer_auth import BearerAuthBackend, RequireAuthMiddleware
from mcp.server.fastmcp.server import StreamableHTTPASGIApp
from starlette.middleware.authentication import AuthenticationMiddleware
from starlette.types import Send

from app.core.config import settings
from app.mcp_server.context import READ_SCOPE
from app.mcp_server.instance import mcp

# Importing these modules is what registers the tools, resources and prompts:
# the decorators run at import time. Nothing else uses these names.
from app.mcp_server import (  # noqa: E402,F401
    resources, tools_expenses, tools_forecast, tools_fx, tools_income, tools_meta,
)

logger = logging.getLogger(__name__)


class _RequireAuth(RequireAuthMiddleware):
    """Adds the `scope` hint the spec asks for to the WWW-Authenticate header.

    The SDK only emits `error`, `error_description` and `resource_metadata`;
    RFC 6750 §3 says the challenge SHOULD also name the scope, which saves the
    client a round-trip on its first connection.
    """

    async def _send_auth_error(
        self, send: Send, status_code: int, error: str, description: str
    ) -> None:
        parts = [
            f'error="{error}"',
            f'error_description="{description}"',
            f'scope="{READ_SCOPE}"',
        ]
        if self.resource_metadata_url:
            parts.append(f'resource_metadata="{self.resource_metadata_url}"')
        challenge = f"Bearer {', '.join(parts)}".encode()

        async def _send(message):
            if message["type"] == "http.response.start":
                headers = [
                    (k, v) for k, v in message["headers"] if k.lower() != b"www-authenticate"
                ]
                headers.append((b"www-authenticate", challenge))
                message = {**message, "headers": headers}
            await send(message)

        await super()._send_auth_error(_send, status_code, error, description)


def build_mcp_asgi():
    """The ASGI app served at `/mcp`, auth chain included."""
    # Calling this is what creates the (lazy) session manager the lifespan runs.
    mcp.streamable_http_app()
    inner = StreamableHTTPASGIApp(mcp.session_manager)

    if settings.MCP_AUTH_DISABLED:
        logger.warning("MCP_AUTH_DISABLED is on — /mcp is unauthenticated. Development only.")
        return inner

    from app.services.mcp_tokens import RegistrappTokenVerifier

    return AuthenticationMiddleware(
        AuthContextMiddleware(
            _RequireAuth(inner, [READ_SCOPE], settings.mcp_resource_metadata_url)
        ),
        backend=BearerAuthBackend(RegistrappTokenVerifier()),
    )
