import secrets
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, exists, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.user import User
from app.schemas.shared_expense import (
    InviteInfoOut,
    SharedExpenseCreate,
    SharedExpenseOut,
)

router = APIRouter(prefix="/shared-expenses", tags=["shared-expenses"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


def _load_q(user_id: int, tenant_id: int):
    """Return shared expenses owned by tenant OR where current user has a split."""
    return (
        select(SharedExpense)
        .where(
            or_(
                SharedExpense.tenant_id == tenant_id,
                exists(
                    select(SharedExpenseSplit.id).where(
                        SharedExpenseSplit.shared_expense_id == SharedExpense.id,
                        SharedExpenseSplit.user_id == user_id,
                    )
                ),
            )
        )
        .options(selectinload(SharedExpense.splits))
        .order_by(SharedExpense.expense_date.desc(), SharedExpense.created_at.desc())
    )


async def _get_or_create_shared_category(tenant_id: int, db: AsyncSession) -> int:
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            ExpenseCategory.name == "Gasto compartido",
        )
    )
    if not cat:
        cat = ExpenseCategory(tenant_id=tenant_id, name="Gasto compartido", color="#6366f1")
        db.add(cat)
        await db.flush()
    return cat.id


@router.get("", response_model=list[SharedExpenseOut])
async def list_shared_expenses(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(_load_q(user.id, user.tenant_id))
    return result.all()


@router.post("", response_model=SharedExpenseOut, status_code=status.HTTP_201_CREATED)
async def create_shared_expense(
    body: SharedExpenseCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    shared = SharedExpense(
        tenant_id=user.tenant_id,
        created_by_user_id=user.id,
        title=body.title,
        total_amount=body.total_amount,
        category_id=body.category_id,
        split_type=body.split_type,
        expense_date=body.expense_date,
    )
    db.add(shared)
    await db.flush()

    for split_in in body.splits:
        is_creator = split_in.user_id == user.id

        resolved_user_id = split_in.user_id
        resolved_name = split_in.member_name
        invite_token = None
        invite_email = None
        invite_expires_at = None

        # If email provided and no user_id, try to find existing user
        if split_in.invite_email and not split_in.user_id:
            found = await db.scalar(
                select(User).where(User.email == split_in.invite_email)
            )
            if found:
                resolved_user_id = found.id
                resolved_name = found.display_name or found.email
            else:
                invite_email = split_in.invite_email
                invite_token = secrets.token_urlsafe(32)
                invite_expires_at = datetime.utcnow() + timedelta(days=30)

        is_external = resolved_user_id is None and not invite_token
        has_invite = invite_token is not None

        split = SharedExpenseSplit(
            shared_expense_id=shared.id,
            user_id=resolved_user_id,
            member_name=resolved_name,
            amount=split_in.amount,
            status="accepted" if (is_creator or is_external) else "pending",
            invite_email=invite_email,
            invite_token=invite_token,
            invite_expires_at=invite_expires_at,
        )
        db.add(split)
        await db.flush()

        if is_creator:
            entry = ExpenseEntry(
                tenant_id=user.tenant_id,
                user_id=user.id,
                category_id=body.category_id,
                amount=split_in.amount,
                description=body.title,
                expense_date=body.expense_date,
                notes=f"Gasto compartido #{shared.id}",
            )
            db.add(entry)
            await db.flush()
            split.expense_entry_id = entry.id

    await db.commit()

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(SharedExpense.id == shared.id)
    )
    return result


@router.delete("/{shared_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_shared_expense(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id, SharedExpense.tenant_id == user.tenant_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")
    if shared.created_by_user_id != user.id:
        raise HTTPException(status_code=403, detail="Solo el creador puede eliminar este gasto")

    entry_ids = [s.expense_entry_id for s in shared.splits if s.expense_entry_id is not None]
    for eid in entry_ids:
        entry = await db.get(ExpenseEntry, eid)
        if entry:
            await db.delete(entry)

    await db.delete(shared)
    await db.commit()


@router.post("/{shared_id}/accept", response_model=SharedExpenseOut)
async def accept_split(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    # No filter by tenant_id — cross-tenant acceptance allowed
    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")

    split = next(
        (s for s in shared.splits if s.user_id == user.id and s.status == "pending"),
        None,
    )
    if not split:
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    # Cross-tenant: use accepting user's category (auto-create "Gasto compartido" if needed)
    if shared.tenant_id != user.tenant_id:
        category_id = await _get_or_create_shared_category(user.tenant_id, db)
    else:
        category_id = shared.category_id

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

    await db.commit()

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(SharedExpense.id == shared_id)
    )
    return result


@router.post("/{shared_id}/reject", response_model=SharedExpenseOut)
async def reject_split(
    shared_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    shared = await db.scalar(
        select(SharedExpense)
        .where(SharedExpense.id == shared_id)
        .options(selectinload(SharedExpense.splits))
    )
    if not shared:
        raise HTTPException(status_code=404, detail="Gasto compartido no encontrado")

    split = next(
        (s for s in shared.splits if s.user_id == user.id and s.status == "pending"),
        None,
    )
    if not split:
        raise HTTPException(status_code=400, detail="No hay un split pendiente para este usuario")

    split.status = "rejected"
    await db.commit()

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(SharedExpense.id == shared_id)
    )
    return result


# ---------------------------------------------------------------------------
# Public invite endpoints (no auth required for GET)
# ---------------------------------------------------------------------------

@router.get("/invite/{token}", response_model=InviteInfoOut)
async def get_invite_info(
    token: str,
    db: AsyncSession = Depends(get_db),
):
    split = await db.scalar(
        select(SharedExpenseSplit)
        .where(
            SharedExpenseSplit.invite_token == token,
            SharedExpenseSplit.user_id.is_(None),
        )
        .options(selectinload(SharedExpenseSplit.shared_expense))
    )
    if not split:
        raise HTTPException(status_code=404, detail="Invitacion no encontrada o ya reclamada")
    if split.invite_expires_at and split.invite_expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="La invitacion ha expirado")

    shared = split.shared_expense
    creator = await db.get(User, shared.created_by_user_id)
    creator_name = creator.display_name or creator.email if creator else "Desconocido"

    return InviteInfoOut(
        shared_expense_id=shared.id,
        title=shared.title,
        total_amount=shared.total_amount,
        split_amount=split.amount,
        expense_date=shared.expense_date,
        creator_name=creator_name,
    )


@router.post("/invite/{token}/claim", response_model=SharedExpenseOut)
async def claim_invite(
    token: str,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    split = await db.scalar(
        select(SharedExpenseSplit)
        .where(
            SharedExpenseSplit.invite_token == token,
            SharedExpenseSplit.user_id.is_(None),
        )
        .options(selectinload(SharedExpenseSplit.shared_expense))
    )
    if not split:
        raise HTTPException(status_code=404, detail="Invitacion no encontrada o ya reclamada")
    if split.invite_expires_at and split.invite_expires_at < datetime.utcnow():
        raise HTTPException(status_code=410, detail="La invitacion ha expirado")

    split.user_id = user.id
    split.member_name = user.display_name or user.email
    split.invite_token = None
    split.invite_expires_at = None
    await db.commit()

    result = await db.scalar(
        _load_q(user.id, user.tenant_id).where(
            SharedExpense.id == split.shared_expense_id
        )
    )
    return result