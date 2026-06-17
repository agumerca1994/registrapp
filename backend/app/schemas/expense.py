from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel


class ExpenseCategoryCreate(BaseModel):
    name: str
    color: str | None = None
    is_fixed: bool = False


class ExpenseCategoryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    color: str | None
    is_fixed: bool


class ExpenseEntryCreate(BaseModel):
    category_id: int
    amount: Decimal
    description: str | None = None
    expense_date: date
    notes: str | None = None


class ExpenseEntryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    category_id: int
    amount: Decimal
    description: str | None
    expense_date: date
    notes: str | None
    created_at: datetime
    category: ExpenseCategoryOut
