from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, model_validator


class CreditCardCreate(BaseModel):
    bank: str
    alias: str
    last_4_digits: str | None = None


class CreditCardUpdate(BaseModel):
    bank: str | None = None
    alias: str | None = None
    last_4_digits: str | None = None


class CreditCardOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    bank: str
    alias: str
    last_4_digits: str | None
    created_at: datetime


class StatementCreate(BaseModel):
    year: int
    month: int
    closing_date: date | None = None
    due_date: date | None = None


class StatementUpdate(BaseModel):
    closing_date: date | None = None
    due_date: date | None = None


class CreditCardItemCreate(BaseModel):
    description: str
    category_id: int | None = None
    item_date: date
    item_type: str  # "single" | "installment" | "recurring"
    amount: Decimal
    currency: str = "ARS"
    # Installment fields
    installment_count: int | None = None
    installment_number: int = 1
    purchase_total: Decimal | None = None

    @model_validator(mode="after")
    def compute_installment_amounts(self) -> "CreditCardItemCreate":
        if self.currency == "USD" and self.item_type != "single":
            raise ValueError("Los gastos en USD solo pueden ser de tipo único")
        if self.item_type == "installment":
            if not self.installment_count or self.installment_count < 2:
                raise ValueError("installment_count debe ser al menos 2")
            if self.purchase_total is None and self.amount:
                self.purchase_total = self.amount * self.installment_count
            elif self.purchase_total and not self.amount:
                self.amount = (self.purchase_total / self.installment_count).quantize(Decimal("0.01"))
        return self


class CreditCardItemUpdate(BaseModel):
    description: str | None = None
    category_id: int | None = None
    item_date: date | None = None
    amount: Decimal | None = None


class CategoryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    color: str | None


class CreditCardItemOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    description: str
    category_id: int
    item_date: date
    item_type: str
    amount: Decimal
    installment_count: int | None
    installment_number: int | None
    purchase_total: Decimal | None
    installment_group_id: int | None
    expense_entry_id: int | None
    installment_root_statement_id: int | None = None
    shared_expense_id: int | None = None
    currency: str = "ARS"
    category: CategoryOut


class StatementOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    card_id: int
    year: int
    month: int
    closing_date: date | None
    due_date: date | None
    status: str
    created_at: datetime
    items: list[CreditCardItemOut] = []
    total: Decimal = Decimal("0")

    @classmethod
    def from_orm_with_total(cls, stmt) -> "StatementOut":
        obj = cls.model_validate(stmt)
        obj.total = sum(i.amount for i in obj.items)
        for pydantic_item, orm_item in zip(obj.items, stmt.items):
            if orm_item.installment_group_id and orm_item.installment_group:
                pydantic_item.installment_root_statement_id = orm_item.installment_group.statement_id
            if orm_item.shared_expense:
                pydantic_item.shared_expense_id = orm_item.shared_expense.id
        return obj


class ForExpenseOut(BaseModel):
    card_id: int
    statement_id: int
    card_alias: str
    card_bank: str
    year: int
    month: int
