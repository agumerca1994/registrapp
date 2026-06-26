import traceback as tb_module
from datetime import datetime, timezone, timedelta
from typing import Any

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.config import settings
from app.models.app_log import AppLog

router = APIRouter(prefix="/internal", tags=["internal"])

LEVEL_ORDER = {"DEBUG": 0, "INFO": 1, "WARNING": 2, "ERROR": 3, "CRITICAL": 4}


def _require_internal_key(x_internal_key: str = Header(...)) -> None:
    if not settings.INTERNAL_LOG_KEY or x_internal_key != settings.INTERNAL_LOG_KEY:
        raise HTTPException(status_code=403, detail="Invalid internal key")


@router.get("/logs")
async def get_logs(
    level: str = Query("WARNING", description="Minimum log level"),
    hours: int = Query(24, ge=1, le=720),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None),
    module: str | None = Query(None),
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    min_level = LEVEL_ORDER.get(level.upper(), 2)
    since = datetime.now(timezone.utc) - timedelta(hours=hours)

    conditions = [
        AppLog.created_at >= since,
        AppLog.level.in_([k for k, v in LEVEL_ORDER.items() if v >= min_level]),
    ]
    if search:
        conditions.append(AppLog.message.ilike(f"%{search}%"))
    if module:
        conditions.append(AppLog.logger_name.ilike(f"%{module}%"))

    total = await db.scalar(
        select(func.count()).select_from(AppLog).where(and_(*conditions))
    )
    rows = (await db.execute(
        select(AppLog).where(and_(*conditions))
        .order_by(AppLog.created_at.desc())
        .limit(limit)
    )).scalars().all()

    return {
        "total": total,
        "hours": hours,
        "level": level.upper(),
        "items": [
            {
                "id": r.id,
                "created_at": r.created_at.isoformat(),
                "level": r.level,
                "logger_name": r.logger_name,
                "message": r.message,
                "module": r.module,
                "request_path": r.request_path,
                "request_method": r.request_method,
                "status_code": r.status_code,
                "user_id": r.user_id,
                "tenant_id": r.tenant_id,
                "traceback": r.traceback,
                "extra": r.extra,
            }
            for r in rows
        ],
    }


@router.get("/logs/summary")
async def get_logs_summary(
    hours: int = Query(24, ge=1, le=720),
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    rows = (await db.execute(
        select(AppLog.level, func.count().label("count"))
        .where(AppLog.created_at >= since)
        .group_by(AppLog.level)
    )).all()

    counts = {r.level: r.count for r in rows}
    return {
        "hours": hours,
        "DEBUG": counts.get("DEBUG", 0),
        "INFO": counts.get("INFO", 0),
        "WARNING": counts.get("WARNING", 0),
        "ERROR": counts.get("ERROR", 0),
        "CRITICAL": counts.get("CRITICAL", 0),
    }


@router.post("/logs/frontend-error")
async def log_frontend_error(
    payload: dict[str, Any],
    x_internal_key: str = Header(...),
    db: AsyncSession = Depends(get_db),
) -> dict[str, str]:
    if not settings.INTERNAL_LOG_KEY or x_internal_key != settings.INTERNAL_LOG_KEY:
        raise HTTPException(status_code=403, detail="Invalid internal key")

    db.add(AppLog(
        level="ERROR",
        logger_name="frontend",
        message=str(payload.get("message", ""))[:2000],
        module="browser",
        request_path=str(payload.get("url", ""))[:500] or None,
        extra={
            k: v for k, v in payload.items()
            if k not in ("message", "url") and v is not None
        } or None,
    ))
    await db.commit()
    return {"status": "ok"}
