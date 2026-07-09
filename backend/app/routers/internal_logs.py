import re
import traceback as tb_module
from datetime import datetime, timezone, timedelta
from typing import Any

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

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


@router.get("/pending-shared-invites")
async def pending_shared_invites(
    creator_email: str | None = Query(None, description="Filter to shared expenses created by this user's email"),
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Diagnostic: lists shared-expense splits (excluding the creator's own) so we can
    tell apart already-registered recipients (visible in-app, split.user_id set) from
    external unclaimed invites (invite_token set, user_id NULL) whose WhatsApp never sent.
    """
    from app.models.shared_expense import SharedExpense, SharedExpenseSplit
    from app.models.user import User

    conditions = []
    if creator_email:
        creator = await db.scalar(select(User).where(User.email == creator_email))
        if not creator:
            raise HTTPException(status_code=404, detail="Creator not found")
        conditions.append(SharedExpense.created_by_user_id == creator.id)

    rows = (await db.execute(
        select(SharedExpense, SharedExpenseSplit)
        .join(SharedExpenseSplit, SharedExpenseSplit.shared_expense_id == SharedExpense.id)
        .where(*conditions)
        .order_by(SharedExpense.created_at.desc())
    )).all()

    all_phone_users = (await db.execute(
        select(User).where(User.whatsapp_phone.isnot(None))
    )).scalars().all()

    def _loose_match(phone: str | None) -> User | None:
        if not phone:
            return None
        digits = re.sub(r"\D", "", phone)
        for u in all_phone_users:
            if re.sub(r"\D", "", u.whatsapp_phone or "") == digits:
                return u
        return None

    items = []
    for se, sp in rows:
        if sp.user_id == se.created_by_user_id:
            continue  # skip the creator's own split
        target_user = await db.get(User, sp.user_id) if sp.user_id else None
        loose_match = None if sp.user_id else _loose_match(sp.invite_email)
        items.append({
            "shared_expense_id": se.id,
            "title": se.title,
            "total_amount": float(se.total_amount),
            "expense_date": se.expense_date.isoformat(),
            "from_credit_card": se.credit_card_item_id is not None,
            "created_at": se.created_at.isoformat(),
            "split_id": sp.id,
            "member_name": sp.member_name,
            "split_amount": float(sp.amount),
            "status": sp.status,
            "user_id": sp.user_id,
            "target_user_email": target_user.email if target_user else None,
            "invite_token_present": sp.invite_token is not None,
            "invite_phone_or_email": sp.invite_email,
            "loose_match_existing_user_email": loose_match.email if loose_match else None,
        })

    return {"total": len(items), "items": items}


class SplitAssignment(BaseModel):
    split_id: int
    user_id: int


class BackfillBody(BaseModel):
    assignments: list[SplitAssignment]


@router.post("/backfill-shared-invite-claims")
async def backfill_shared_invite_claims(
    body: BackfillBody,
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """One-off data fix: directly claims shared-expense splits on behalf of a known
    user_id, replicating POST /shared-expenses/invite/{token}/claim exactly (assigns
    user_id, creates the ExpenseEntry in the target user's tenant, marks accepted),
    for splits whose WhatsApp invite never arrived (bug already fixed) but whose
    identity is confidently known from other records.
    """
    from app.models.expense import ExpenseEntry
    from app.models.shared_expense import SharedExpense, SharedExpenseSplit
    from app.models.user import User
    from app.routers.shared_expenses import _get_or_create_shared_category

    results = []
    for a in body.assignments:
        split = await db.scalar(
            select(SharedExpenseSplit)
            .where(SharedExpenseSplit.id == a.split_id)
            .options(selectinload(SharedExpenseSplit.shared_expense))
        )
        if not split:
            results.append({"split_id": a.split_id, "status": "not_found"})
            continue
        if split.user_id is not None:
            results.append({"split_id": a.split_id, "status": "skipped_already_assigned", "user_id": split.user_id})
            continue

        user = await db.get(User, a.user_id)
        if not user:
            results.append({"split_id": a.split_id, "status": "user_not_found"})
            continue

        shared = split.shared_expense
        split.user_id = user.id
        split.member_name = user.display_name or user.email
        split.invite_token = None
        split.invite_expires_at = None

        category_id = (
            shared.category_id if shared.tenant_id == user.tenant_id
            else await _get_or_create_shared_category(user.tenant_id, db)
        )
        entry = ExpenseEntry(
            tenant_id=user.tenant_id,
            user_id=user.id,
            category_id=category_id,
            amount=split.amount,
            description=shared.title,
            expense_date=shared.expense_date,
            notes=f"Gasto compartido #{shared.id}",
        )
        db.add(entry)
        await db.flush()
        split.expense_entry_id = entry.id
        split.status = "accepted"

        if user.id != shared.created_by_user_id and not shared.locked:
            shared.locked = True

        results.append({"split_id": a.split_id, "status": "claimed", "user_id": user.id, "user_email": user.email})

    await db.commit()
    return {"results": results}


@router.get("/tenant-contacts")
async def list_tenant_contacts(
    creator_email: str | None = Query(None, description="Filter to the agenda of this user's household"),
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Diagnostic: read-only dump of the household agenda (TenantContact)."""
    from app.models.contact import TenantContact
    from app.models.user import User

    conditions = []
    if creator_email:
        creator = await db.scalar(select(User).where(User.email == creator_email))
        if not creator:
            raise HTTPException(status_code=404, detail="Creator not found")
        conditions.append(TenantContact.tenant_id == creator.tenant_id)

    rows = (await db.execute(
        select(TenantContact).where(*conditions).order_by(TenantContact.contact_name)
    )).scalars().all()

    return {
        "total": len(rows),
        "items": [
            {
                "id": r.id,
                "tenant_id": r.tenant_id,
                "contact_name": r.contact_name,
                "contact_phone": r.contact_phone,
                "created_at": r.created_at.isoformat(),
            }
            for r in rows
        ],
    }


@router.delete("/tenant-contacts/{contact_id}")
async def delete_tenant_contact(
    contact_id: int,
    _: None = Depends(_require_internal_key),
    db: AsyncSession = Depends(get_db),
) -> dict[str, Any]:
    """Diagnostic: delete a stale/duplicate household agenda entry."""
    from app.models.contact import TenantContact

    contact = await db.get(TenantContact, contact_id)
    if not contact:
        raise HTTPException(status_code=404, detail="Contact not found")
    await db.delete(contact)
    await db.commit()
    return {"status": "deleted", "id": contact_id}


@router.get("/whatsapp-check")
async def whatsapp_check(
    phone: str = Query(..., description="Bare local digits, e.g. 3834721576"),
    _: None = Depends(_require_internal_key),
) -> dict[str, Any]:
    """Diagnostic: ask Evolution API's own number-check endpoint (no message sent)
    whether a number exists on WhatsApp, trying several plausible AR formats so we
    can tell a genuine 'no WhatsApp account' from a formatting mismatch.
    """
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        raise HTTPException(status_code=503, detail="Evolution API no configurado")

    digits = re.sub(r"\D", "", phone)
    variants = {
        "with_9": f"549{digits}",
        "without_9": f"54{digits}",
        "bare_local": digits,
        "raw_with_plus": f"+549{digits}",  # exactly what _send_wa_msg sends today
    }

    url = f"{settings.EVOLUTION_API_URL}/chat/whatsappNumbers/{settings.EVOLUTION_INSTANCE}"
    headers = {"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"}

    results = {}
    async with httpx.AsyncClient(timeout=15) as client:
        for label, number in variants.items():
            try:
                resp = await client.post(url, json={"numbers": [number]}, headers=headers)
                results[label] = {"number_sent": number, "status_code": resp.status_code, "body": resp.json() if resp.content else None}
            except Exception as e:
                results[label] = {"number_sent": number, "error": str(e)}

    return results


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
