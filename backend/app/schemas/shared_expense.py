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
    # When None, defaults to expense_date (the common case: paid the same day).
    # Set it explicitly when the real cash movement happens in a different
    # month than the expense's accounting date — e.g. a bill closed at
    # month-end but due the 10th of the next month.
    payment_date: date | None = None
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


class SplitAmountUpdate(BaseModel):
    split_id: int
    amount: Decimal


class SharedExpenseUpdate(BaseModel):
    """Partial update. `splits` (if present) must include every existing
    split's id — no adding/removing participants here, only re-amounting
    the current ones. Field-level permissions (what's allowed once the
    expense is locked) are enforced in the router, not here.
    """
    title: str | None = None
    total_amount: Decimal | None = None
    category_id: int | None = None
    expense_date: date | None = None
    payment_date: date | None = None
    splits: list[SplitAmountUpdate] | None = None

    @model_validator(mode="after")
    def validate_splits(self) -> "SharedExpenseUpdate":
        if self.splits is not None:
            if self.total_amount is None:
                raise ValueError("total_amount es requerido al editar los montos de los participantes")
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
    converted_ars_amount: Decimal | None = None
    converted_ars_rate: Decimal | None = None
    converted_ars_rate_type: str | None = None


class SharedExpenseOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    tenant_id: int
    title: str
    total_amount: Decimal
    currency: str = "ARS"
    category_id: int
    split_type: str
    expense_date: date
    payment_date: date
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
    currency: str = "ARS"
    split_amount: Decimal
    expense_date: date
    creator_name: str
    cuotas_count: int = 1
    cuotas_total_amount: Decimal | None = None


class ShareCreditCardItemBody(BaseModel):
    splits: list[SplitIn]
    split_type: str


RATE_TYPES = ("oficial", "blue", "mayorista", "mep", "ccl")


class ConvertToArsBody(BaseModel):
    """Settlement-time USD→ARS conversion for one or more splits of the same
    USD shared expense — one split (per-person view) or every split
    (bulk 'convertir todo' from the full history card) go through this same
    endpoint. `rate=None` reverts the given splits back to USD.
    """
    split_ids: list[int]
    rate: Decimal | None = None
    rate_type: str | None = None

    @model_validator(mode="after")
    def validate_rate(self) -> "ConvertToArsBody":
        if not self.split_ids:
            raise ValueError("Debe indicarse al menos un participante")
        if self.rate is not None:
            if self.rate <= 0:
                raise ValueError("La cotización debe ser mayor a 0")
            if self.rate_type not in RATE_TYPES:
                raise ValueError(f"rate_type debe ser uno de: {', '.join(RATE_TYPES)}")
        return self
