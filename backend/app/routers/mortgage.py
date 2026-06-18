from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from datetime import date
from decimal import Decimal
from pydantic import BaseModel

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.mortgage import MortgageRecord

router = APIRouter(prefix="/mortgage", tags=["mortgage"])


class MortgageUpsert(BaseModel):
    period_date: date
    payment_amount: Decimal
    capital: Decimal | None = None
    interest: Decimal | None = None
    uva_units: Decimal | None = None


class MortgageOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    period_date: date
    payment_amount: Decimal
    capital: Decimal | None
    interest: Decimal | None
    uva_units: Decimal | None


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


@router.get("", response_model=list[MortgageOut])
async def list_records(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(MortgageRecord)
        .where(MortgageRecord.tenant_id == user.tenant_id)
        .order_by(MortgageRecord.period_date.desc())
    )
    return result.all()


@router.delete("/{record_id}", status_code=204)
async def delete_record(
    record_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    record = await db.get(MortgageRecord, record_id)
    if not record or record.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    await db.delete(record)
    await db.commit()


@router.put("", response_model=MortgageOut)
async def upsert_record(
    body: MortgageUpsert,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    existing = await db.scalar(
        select(MortgageRecord).where(
            MortgageRecord.tenant_id == user.tenant_id,
            MortgageRecord.period_date == body.period_date,
        )
    )
    if existing:
        for field, value in body.model_dump(exclude={"period_date"}).items():
            if value is not None:
                setattr(existing, field, value)
        await db.commit()
        await db.refresh(existing)
        return existing

    record = MortgageRecord(**body.model_dump(), tenant_id=user.tenant_id)
    db.add(record)
    await db.commit()
    await db.refresh(record)
    return record
