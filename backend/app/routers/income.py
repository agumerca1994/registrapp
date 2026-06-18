from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.income import IncomeSource, IncomeEntry
from app.schemas.income import (
    IncomeSourceCreate, IncomeSourceOut,
    IncomeEntryCreate, IncomeEntryUpdate, IncomeEntryOut,
)

router = APIRouter(prefix="/income", tags=["income"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


# ── Sources ────────────────────────────────────────────────────────────────────

@router.get("/sources", response_model=list[IncomeSourceOut])
async def list_sources(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(IncomeSource).where(
            IncomeSource.tenant_id == user.tenant_id,
            IncomeSource.is_active == True,
        )
    )
    return result.all()


@router.post("/sources", response_model=IncomeSourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    body: IncomeSourceCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    source = IncomeSource(**body.model_dump(), tenant_id=user.tenant_id)
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


# ── Entries ────────────────────────────────────────────────────────────────────

@router.get("/entries", response_model=list[IncomeEntryOut])
async def list_entries(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(IncomeEntry)
        .where(IncomeEntry.tenant_id == user.tenant_id)
        .options(selectinload(IncomeEntry.source))
        .order_by(IncomeEntry.period_date.desc())
    )
    return result.all()


@router.post("/entries", response_model=IncomeEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: IncomeEntryCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = IncomeEntry(**body.model_dump(), tenant_id=user.tenant_id, user_id=user.id)
    db.add(entry)
    await db.commit()
    result = await db.scalar(
        select(IncomeEntry)
        .where(IncomeEntry.id == entry.id)
        .options(selectinload(IncomeEntry.source))
    )
    return result


@router.patch("/entries/{entry_id}", response_model=IncomeEntryOut)
async def update_entry(
    entry_id: int,
    body: IncomeEntryUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = await db.get(IncomeEntry, entry_id)
    if not entry or entry.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(entry, field, value)
    await db.commit()
    result = await db.scalar(
        select(IncomeEntry).where(IncomeEntry.id == entry_id).options(selectinload(IncomeEntry.source))
    )
    return result


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = await db.get(IncomeEntry, entry_id)
    if not entry or entry.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    await db.delete(entry)
    await db.commit()
