from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.schemas.expense import (
    ExpenseCategoryCreate, ExpenseCategoryOut,
    ExpenseEntryCreate, ExpenseEntryUpdate, ExpenseEntryOut,
)

router = APIRouter(prefix="/expenses", tags=["expenses"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


# ── Categories ────────────────────────────────────────────────────────────────

@router.get("/categories", response_model=list[ExpenseCategoryOut])
async def list_categories(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )
    return result.all()


@router.post("/categories", response_model=ExpenseCategoryOut, status_code=status.HTTP_201_CREATED)
async def create_category(
    body: ExpenseCategoryCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    cat = ExpenseCategory(**body.model_dump(), tenant_id=user.tenant_id)
    db.add(cat)
    await db.commit()
    await db.refresh(cat)
    return cat


# ── Entries ────────────────────────────────────────────────────────────────────

@router.get("/entries", response_model=list[ExpenseEntryOut])
async def list_entries(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(ExpenseEntry)
        .where(ExpenseEntry.tenant_id == user.tenant_id)
        .options(selectinload(ExpenseEntry.category))
        .order_by(ExpenseEntry.expense_date.desc())
    )
    return result.all()


@router.post("/entries", response_model=ExpenseEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: ExpenseEntryCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = ExpenseEntry(**body.model_dump(), tenant_id=user.tenant_id, user_id=user.id)
    db.add(entry)
    await db.commit()
    result = await db.scalar(
        select(ExpenseEntry)
        .where(ExpenseEntry.id == entry.id)
        .options(selectinload(ExpenseEntry.category))
    )
    return result


@router.patch("/entries/{entry_id}", response_model=ExpenseEntryOut)
async def update_entry(
    entry_id: int,
    body: ExpenseEntryUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = await db.get(ExpenseEntry, entry_id)
    if not entry or entry.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(entry, field, value)
    await db.commit()
    result = await db.scalar(
        select(ExpenseEntry).where(ExpenseEntry.id == entry_id).options(selectinload(ExpenseEntry.category))
    )
    return result


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = await db.get(ExpenseEntry, entry_id)
    if not entry or entry.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    await db.delete(entry)
    await db.commit()
