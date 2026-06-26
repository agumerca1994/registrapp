import asyncio
import logging
import traceback
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.routers import (
    auth, income, expenses, macro, dashboard, mortgage,
    shared_expenses, whatsapp, credit_cards, contacts,
)
from app.routers.internal_logs import router as internal_logs_router
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


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging()

    # Start log queue consumer before anything else
    asyncio.create_task(log_queue_consumer())

    asyncio.create_task(_daily_sync())
    asyncio.create_task(_daily_mortgage_sync())

    scheduler = AsyncIOScheduler(timezone="UTC")
    scheduler.add_job(_daily_sync, "cron", hour=9, minute=0)
    scheduler.add_job(_daily_mortgage_sync, "cron", hour=9, minute=1)
    scheduler.start()

    yield

    scheduler.shutdown()


app = FastAPI(
    title="RegistrApp API",
    version="1.0.0",
    docs_url="/docs",
    redoc_url="/redoc",
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

    if response.status_code >= 400:
        level_msg = f"HTTP {response.status_code}"
        await log_http_error(
            request_path=request.url.path,
            request_method=request.method,
            status_code=response.status_code,
            message=level_msg,
        )
    return response


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
app.include_router(internal_logs_router)


@app.get("/health")
async def health():
    from app.core.config import settings
    return {"status": "ok", "frontend_url": settings.FRONTEND_URL}
