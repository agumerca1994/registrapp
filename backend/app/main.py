import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import date

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from apscheduler.schedulers.asyncio import AsyncIOScheduler

from app.routers import auth, income, expenses, macro, dashboard, mortgage, shared_expenses, whatsapp, credit_cards

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
    # Run syncs on startup (non-blocking)
    asyncio.create_task(_daily_sync())
    asyncio.create_task(_daily_mortgage_sync())

    # Schedule daily jobs at 06:00 Argentina time (UTC-3 â†’ 09:00 UTC)
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

app.include_router(auth.router)
app.include_router(income.router)
app.include_router(expenses.router)
app.include_router(macro.router)
app.include_router(dashboard.router)
app.include_router(mortgage.router)
app.include_router(shared_expenses.router)
app.include_router(credit_cards.router)
app.include_router(whatsapp.router)


@app.get("/health")
async def health():
    return {"status": "ok"}

