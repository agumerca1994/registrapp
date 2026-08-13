import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from starlette.routing import Route

from app.routers import (
    auth, income, expenses, macro, dashboard, mortgage,
    shared_expenses, whatsapp, credit_cards, contacts, reminders, currency,
)
from app.routers.internal_logs import router as internal_logs_router
from app.core.config import settings
from app.core.logging_config import setup_logging, log_queue_consumer, log_http_error

logger = logging.getLogger(__name__)


async def _daily_sync():
    from app.routers.macro import sync_macro_for_date
    try:
        await sync_macro_for_date(date.today().isoformat())
        logger.info("Daily macro sync completed")
    except Exception as e:
        logger.error(f"Daily macro sync failed: {e}")


async def _daily_mortgage_sync():
    from app.routers.mortgage import sync_all_active_loans
    try:
        await sync_all_active_loans()
    except Exception as e:
        logger.error(f"Daily mortgage sync failed: {e}")


async def _daily_reminder_check():
    from app.routers.reminders import send_due_reminders
    try:
        await send_due_reminders()
    except Exception as e:
        logger.error(f"Daily reminder check failed: {e}")


async def _daily_mcp_cleanup():
    from app.services.mcp_tokens import cleanup_expired
    try:
        removed = await cleanup_expired()
        logger.info(f"MCP cleanup removed {removed} rows")
    except Exception as e:
        logger.error(f"MCP cleanup failed: {e}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()

    # Start log queue consumer before anything else
    asyncio.create_task(log_queue_consumer())

    asyncio.create_task(_daily_sync())
    asyncio.create_task(_daily_mortgage_sync())
    asyncio.create_task(_daily_reminder_check())

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(_daily_sync, "cron", hour=9, minute=0)
    scheduler.add_job(_daily_mortgage_sync, "cron", hour=9, minute=1)
    scheduler.add_job(_daily_reminder_check, "cron", hour=9, minute=2)
    if settings.MCP_ENABLED:
        scheduler.add_job(_daily_mcp_cleanup, "cron", hour=9, minute=3)
    scheduler.start()

    if settings.MCP_ENABLED:
        # A mounted sub-app's lifespan never runs, so the streamable-HTTP
        # session manager has to be started from here. Without it the first
        # /mcp request fails with "Task group is not initialized" — even in
        # stateless mode. It can only be entered once per process.
        from app.mcp_server.instance import mcp as mcp_server
        async with mcp_server.session_manager.run():
            yield
    else:
        yield

    scheduler.shutdown()


# El esquema completo de la API — incluidos /internal/* y /oauth/* — es el mapa
# que necesita cualquiera que quiera atacarla. Fuera de producción sigue estando,
# que es donde sirve.
_is_prod = settings.ENVIRONMENT == "production"

app = FastAPI(
    title="RegistrApp API",
    version="1.0.0",
    docs_url=None if _is_prod else "/docs",
    redoc_url=None if _is_prod else "/redoc",
    openapi_url=None if _is_prod else "/openapi.json",
    lifespan=lifespan,
)

import os

_raw = os.getenv("ALLOWED_ORIGINS", "http://localhost:3000,http://localhost:3001")
_origins = [o.strip() for o in _raw.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Connector paths need their own CORS rules. The middleware above sends
# `allow_credentials=True`, and a browser refuses to pair that with `*` — but
# claude.ai and the MCP Inspector probe the discovery documents from arbitrary
# origins with no cookies at all. This runs *after* the one above in the request
# path (middleware is applied bottom-up) and answers those preflights itself.
_MCP_CORS_PATHS = ("/mcp", "/oauth/", "/.well-known/")
_MCP_CORS_HEADERS = (
    "authorization, content-type, mcp-session-id, mcp-protocol-version, "
    "last-event-id, accept"
)


@app.middleware("http")
async def mcp_cors_middleware(request: Request, call_next):
    path = request.url.path
    if not (path == "/mcp" or path.startswith(_MCP_CORS_PATHS)):
        return await call_next(request)

    if request.method == "OPTIONS":
        response = Response(status_code=204)
    else:
        response = await call_next(request)

    response.headers["access-control-allow-origin"] = "*"
    response.headers["access-control-allow-methods"] = "GET, POST, DELETE, OPTIONS"
    response.headers["access-control-allow-headers"] = _MCP_CORS_HEADERS
    response.headers["access-control-expose-headers"] = "mcp-session-id, www-authenticate"
    response.headers["access-control-max-age"] = "3600"
    # Credentials are never allowed together with a wildcard origin; the
    # connector authenticates with a bearer token, so it never needs cookies.
    if "access-control-allow-credentials" in response.headers:
        del response.headers["access-control-allow-credentials"]
    return response


@app.middleware("http")
async def log_http_errors_middleware(request: Request, call_next):
    try:
        response = await call_next(request)
    except Exception as exc:
        tb = traceback.format_exc()
        await log_http_error(
            request_path=request.url.path,
            request_method=request.method,
            status_code=500,
            message=f"Unhandled exception: {exc}",
            traceback=tb,
        )
        return JSONResponse(status_code=500, content={"detail": "Internal server error"})

    if response.status_code >= 400 and not _is_expected_auth_noise(request, response):
        level_msg = f"HTTP {response.status_code}"
        await log_http_error(
            request_path=request.url.path,
            request_method=request.method,
            status_code=response.status_code,
            message=level_msg,
        )
    return response


def _is_expected_auth_noise(request: Request, response) -> bool:
    """Whether a 4xx here is just the OAuth discovery handshake doing its job.

    Every MCP client starts by hitting /mcp with no token to learn where the
    authorization server lives, so those 401s are the protocol working, not an
    incident. Logging them fills AppLog with one row per connection attempt.
    """
    path = request.url.path
    if path == "/mcp" and response.status_code in (401, 403):
        return True
    if (path.startswith("/oauth/") or path.startswith("/.well-known/")) and response.status_code < 500:
        return True
    return False


app.include_router(auth.router)
app.include_router(income.router)
app.include_router(expenses.router)
app.include_router(macro.router)
app.include_router(dashboard.router)
app.include_router(mortgage.router)
app.include_router(shared_expenses.router)
app.include_router(credit_cards.router)
app.include_router(whatsapp.router)
app.include_router(contacts.router)
app.include_router(reminders.router)
app.include_router(currency.router)
app.include_router(internal_logs_router)

if settings.MCP_ENABLED:
    from app.mcp_server.transport import build_mcp_asgi
    from app.routers import oauth as mcp_oauth

    app.include_router(mcp_oauth.router)

    # A plain Route with an ASGI app as its endpoint, not app.mount(): mounting
    # would answer POST /mcp with a 307 to /mcp/, giving the RFC 8707 canonical
    # resource two spellings.
    app.router.routes.append(
        Route("/mcp", endpoint=build_mcp_asgi(), methods=["GET", "POST", "DELETE"])
    )


@app.get("/health")
async def health():
    # Sin auth y público: devuelve liveness y nada más. Devolvía FRONTEND_URL,
    # que es configuración interna que no le sirve a un health check.
    return {"status": "ok"}
