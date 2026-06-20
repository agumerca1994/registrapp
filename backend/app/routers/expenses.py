from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, extract
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.mortgage import MortgageRecord
from app.models.shared_expense import SharedExpenseSplit
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


async def _get_or_create_usd_category(tenant_id: int, db: AsyncSession) -> int:
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            ExpenseCategory.name == "Consumo en dólares",
        )
    )
    if not cat:
        cat = ExpenseCategory(
            tenant_id=tenant_id,
            name="Consumo en dólares",
            color="#22c55e",
            is_fixed=False,
        )
        db.add(cat)
        await db.flush()
    return cat.id


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
    year: int | None = None,
    month: int | None = None,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    q = (
        select(ExpenseEntry)
        .where(ExpenseEntry.tenant_id == user.tenant_id)
        .options(selectinload(ExpenseEntry.category))
        .order_by(ExpenseEntry.expense_date.desc())
    )
    if year:
        q = q.where(extract("year", ExpenseEntry.expense_date) == year)
    if month:
        q = q.where(extract("month", ExpenseEntry.expense_date) == month)
    result = await db.scalars(q)
    return result.all()


@router.post("/entries", response_model=ExpenseEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: ExpenseEntryCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    data = body.model_dump()
    if data.get("currency") == "USD":
        data["category_id"] = await _get_or_create_usd_category(user.tenant_id, db)
    elif data.get("category_id") is None:
        raise HTTPException(status_code=422, detail="category_id es requerido para gastos en ARS")
    entry = ExpenseEntry(**data, tenant_id=user.tenant_id, user_id=user.id)
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
    # If a mortgage_record references this expense, delete it first to avoid FK violation
    mortgage_rec = await db.scalar(
        select(MortgageRecord).where(MortgageRecord.expense_entry_id == entry_id)
    )
    if mortgage_rec:
        await db.delete(mortgage_rec)
        await db.flush()
    # Soft link: if a shared expense split references this entry, reset it to pending
    split = await db.scalar(
        select(SharedExpenseSplit).where(SharedExpenseSplit.expense_entry_id == entry_id)
    )
    if split:
        split.expense_entry_id = None
        split.status = "pending"
        await db.flush()

    await db.delete(entry)
    await db.commit()
