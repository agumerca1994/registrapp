from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, model_validator


class SplitIn(BaseModel):
    user_id: int | None = None
    member_name: str
    amount: Decimal
    invite_contact: str | None = None  # email or phone number


class SharedExpenseCreate(BaseModel):
    title: str
    total_amount: Decimal
    category_id: int
    split_type: str
    expense_date: date
    splits: list[SplitIn]

    @model_validator(mode="after")
    def validate_splits(self) -> "SharedExpenseCreate":
        if not self.splits:
            raise ValueError("Debe haber al menos un participante")
        total_splits = sum(s.amount for s in self.splits)
        if abs(total_splits - self.total_amount) > Decimal("0.01"):
            raise ValueError(
                f"La suma de los montos ({total_splits}) no coincide con el total ({self.total_amount})"
            )
        return self


class SplitOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    user_id: int | None
    member_name: str
    amount: Decimal
    status: str
    expense_entry_id: int | None
    invite_email: str | None
    invite_token: str | None


class SharedExpenseOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    title: str
    total_amount: Decimal
    category_id: int
    split_type: str
    expense_date: date
    locked: bool
    created_by_user_id: int
    credit_card_item_id: int | None = None
    installment_group_id: int | None = None
    created_at: datetime
    splits: list[SplitOut]


class InviteInfoOut(BaseModel):
    shared_expense_id: int
    title: str
    total_amount: Decimal
    split_amount: Decimal
    expense_date: date
    creator_name: str
    cuotas_count: int = 1
    cuotas_total_amount: Decimal | None = None


class ShareCreditCardItemBody(BaseModel):
    splits: list[SplitIn]
    split_type: str
