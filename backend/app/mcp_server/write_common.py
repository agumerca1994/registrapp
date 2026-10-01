"""What every write tool shares: preview-then-apply, audit, rate limit.

- **Preview by default.** `dry_run=True` runs the *real* write — the same
  service code the app uses — and rolls it back. What the preview shows is
  exactly what `dry_run=False` stores, because it is the same code path, not a
  simulation that could drift from it.
- **Every applied write leaves a trace** in `app_logs` (`logger_name="mcp.write"`),
  written directly because `DBLogHandler` only keeps WARNING and above.
- **A cap per household**, so a confused assistant can't loop on writes.
"""
import unicodedata
from typing import Awaitable, Callable

from fastapi import HTTPException
from mcp.server.fastmcp.exceptions import ToolError
from mcp.types import ToolAnnotations
from sqlalchemy.ext.asyncio import AsyncSession

from app.mcp_server.context import McpCaller
from app.models.app_log import AppLog
from app.services import rate_limit

WRITE_LIMIT_PER_HOUR = 120

PREVIEW_NOTE = (
    "Vista previa: NO se guardó nada. Mostrale este resultado al usuario y, sólo "
    "si lo confirma, volvé a llamar con los mismos argumentos y dry_run=false."
)

WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False)


def fold(s: str) -> str:
    """Accent- and case-insensitive key, the Python twin of `services/search.fold`."""
    nfd = unicodedata.normalize("NFD", s.strip().lower())
    return " ".join("".join(c for c in nfd if unicodedata.category(c) != "Mn").split())


def limit_writes(caller: McpCaller) -> None:
    if not rate_limit.check(f"mcp_write:{caller.tenant_id}", WRITE_LIMIT_PER_HOUR, 3600):
        raise ToolError("Demasiadas escrituras en la última hora; probá más tarde.")


def http_to_tool(exc: HTTPException) -> ToolError:
    return ToolError(str(exc.detail))


async def audit(db: AsyncSession, caller: McpCaller, tool: str, message: str, extra: dict) -> None:
    db.add(AppLog(
        level="INFO",
        logger_name="mcp.write",
        message=f"{tool}: {message}",
        module="mcp_server",
        request_path="/mcp",
        user_id=caller.user_id,
        tenant_id=caller.tenant_id,
        extra={"tool": tool, "client": caller.client_name, **extra},
    ))


async def finish(
    db: AsyncSession, dry_run: bool, result: dict, on_apply: Callable[[], Awaitable[None]],
) -> dict:
    """Rollback for a preview; audit + commit for the real thing."""
    result["dry_run"] = dry_run
    if dry_run:
        await db.rollback()
        result["note"] = PREVIEW_NOTE
    else:
        await on_apply()
        await db.commit()
        result["note"] = "Guardado."
    return result
