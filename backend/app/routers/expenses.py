from datetime import date as _date
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, extract, func, or_
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.mortgage import MortgageRecord
from app.models.shared_expense import SharedExpenseSplit
from app.services.currency import get_or_create_usd_category
from app.services.search import fold, fold_term
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


async def assert_owns_category(category_id: int, tenant_id: int, db: AsyncSession) -> None:
    """La categoría tiene que ser del hogar que la está usando.

    `expense_categories.id` es global, así que cualquier entero resuelve. Los
    endpoints verifican que el *entry* sea del tenant pero escribían el
    `category_id` que mandaba el cliente sin mirarlo, y `ExpenseEntryOut` trae
    la categoría embebida: creando un entry con `category_id: N` y leyéndolo de
    vuelta se enumeraban los nombres de categorías de todos los hogares.
    """
    owned = await db.scalar(
        select(ExpenseCategory.id).where(
            ExpenseCategory.id == category_id,
            ExpenseCategory.tenant_id == tenant_id,
        )
    )
    if owned is None:
        raise HTTPException(status_code=404, detail="Categoría no encontrada")


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

# Amount sorting keeps each currency in its own block instead of interleaving
# them — the list mixes ARS and USD rows and the app never compares amounts
# across currencies.
SORT_COLUMNS = {
    "date": [ExpenseEntry.expense_date],
    "category": [ExpenseCategory.name],
    "amount": [ExpenseEntry.currency, ExpenseEntry.amount],
}


@router.get("/entries", response_model=list[ExpenseEntryOut])
async def list_entries(
    year: int | None = None,
    month: int | None = None,
    q: str | None = Query(None, description="Coincidencia parcial en descripción, categoría, comercio o notas"),
    category_id: int | None = None,
    currency: str | None = None,
    date_from: _date | None = None,
    date_to: _date | None = None,
    sort: Literal["date", "category", "amount"] = "date",
    order: Literal["asc", "desc"] = "desc",
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Expenses for a month, or across all of them when searching.

    Dates are the entry's own `expense_date`, not `cash_out_date()`: this is
    the ledger the user typed, and a row has to be findable by the date printed
    next to it. The dashboard is the one that reports by when the money left.

    `year`/`month` and the filters are alternatives — the frontend drops the
    month as soon as a filter is set, since a search that only looks inside the
    month on screen isn't a search. Nothing here enforces it; both just
    intersect.
    """
    user = await _get_db_user(firebase_user, db)
    stmt = (
        select(ExpenseEntry)
        .join(ExpenseEntry.category)
        .where(ExpenseEntry.tenant_id == user.tenant_id)
        .options(selectinload(ExpenseEntry.category))
    )
    if year:
        stmt = stmt.where(extract("year", ExpenseEntry.expense_date) == year)
    if month:
        stmt = stmt.where(extract("month", ExpenseEntry.expense_date) == month)
    if category_id:
        stmt = stmt.where(ExpenseEntry.category_id == category_id)
    if currency:
        stmt = stmt.where(ExpenseEntry.currency == currency.upper())
    if date_from:
        stmt = stmt.where(ExpenseEntry.expense_date >= date_from)
    if date_to:
        stmt = stmt.where(ExpenseEntry.expense_date <= date_to)
    if q and q.strip():
        # A row shows `description or category.name` and, for card charges, the
        # card alias in `entity`. All three are what the user reads on screen,
        # so all three have to be searchable — plus `notes`, which is where the
        # detail they half-remember usually ended up.
        term = fold_term(q)
        stmt = stmt.where(or_(
            fold(func.coalesce(ExpenseEntry.description, "")).like(term),
            fold(func.coalesce(ExpenseEntry.notes, "")).like(term),
            fold(func.coalesce(ExpenseEntry.entity, "")).like(term),
            fold(ExpenseCategory.name).like(term),
        ))

    cols = SORT_COLUMNS[sort]
    # `id` breaks ties so equal dates/amounts keep a stable order.
    stmt = stmt.order_by(
        *[c.asc() if order == "asc" else c.desc() for c in cols],
        ExpenseEntry.id.desc(),
    )
    result = await db.scalars(stmt)
    return result.all()


@router.post("/entries", response_model=ExpenseEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: ExpenseEntryCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    data = body.model_dump()
    # USD expenses can be categorised like any other now — a trip paid in
    # dollars belongs in "Viajes", not in a currency bucket. "Consumo en
    # dólares" stays as the fallback when the user doesn't pick one.
    if data.get("category_id") is None:
        if data.get("currency") == "USD":
            data["category_id"] = await get_or_create_usd_category(user.tenant_id, db)
        else:
            raise HTTPException(status_code=422, detail="category_id es requerido para gastos en ARS")
    else:
        await assert_owns_category(data["category_id"], user.tenant_id, db)
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
    updates = body.model_dump(exclude_none=True)
    if "category_id" in updates:
        await assert_owns_category(updates["category_id"], user.tenant_id, db)
    for field, value in updates.items():
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
