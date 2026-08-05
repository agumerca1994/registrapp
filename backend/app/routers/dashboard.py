from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.services import analytics
# Re-exported so `from app.routers.dashboard import MonthSummary` keeps working;
# the real definitions live in services/analytics.py alongside the queries.
from app.services.analytics import CategorySummary, HistoryPoint, MonthSummary  # noqa: F401

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


@router.get("/summary/{year}/{month}", response_model=MonthSummary)
async def monthly_summary(
    year: int,
    month: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    return await analytics.month_summary(db, user.tenant_id, year, month)


@router.get("/history", response_model=list[HistoryPoint])
async def history(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    return await analytics.history_series(db, user.tenant_id)
