from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel
from app.models.income import IncomeType


class IncomeSourceCreate(BaseModel):
    name: str
    income_type: IncomeType
    description: str | None = None


class IncomeSourceOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    income_type: IncomeType
    description: str | None
    is_active: bool


class IncomeEntryCreate(BaseModel):
    source_id: int
    amount: Decimal
    period_date: date
    notes: str | None = None


class IncomeEntryUpdate(BaseModel):
    source_id: int | None = None
    amount: Decimal | None = None
    period_date: date | None = None
    notes: str | None = None


class IncomeEntryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    source_id: int
    amount: Decimal
    period_date: date
    notes: str | None
    created_at: datetime
    source: IncomeSourceOut
