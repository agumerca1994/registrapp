from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel, model_validator


LOAN_TYPES = {"uva_frances", "uva_aleman", "tasa_fija", "tasa_variable"}
UVA_LOAN_TYPES = {"uva_frances", "uva_aleman"}


class MortgageLoanCreate(BaseModel):
    loan_type: str
    description: str | None = None
    loan_number: str | None = None
    total_cuotas: int
    first_payment_date: date
    payment_day: int | None = None  # None = primer día hábil, 1-28 = día fijo
    cuota_uva: Decimal | None = None
    cuota_pesos: Decimal | None = None
    tna: Decimal | None = None
    original_capital_uva: Decimal | None = None

    @model_validator(mode="after")
    def check_required_fields(self):
        if self.loan_type not in LOAN_TYPES:
            raise ValueError(f"loan_type debe ser uno de: {', '.join(LOAN_TYPES)}")
        if self.loan_type in UVA_LOAN_TYPES and not self.cuota_uva:
            raise ValueError("cuota_uva es requerido para préstamos UVA")
        if self.loan_type == "tasa_fija" and not self.cuota_pesos:
            raise ValueError("cuota_pesos es requerido para tasa fija")
        return self


class MortgageLoanUpdate(BaseModel):
    description: str | None = None
    loan_number: str | None = None
    payment_day: int | None = None
    cuota_uva: Decimal | None = None
    cuota_pesos: Decimal | None = None
    tna: Decimal | None = None
    original_capital_uva: Decimal | None = None
    is_active: bool | None = None


class MortgageLoanOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    loan_type: str
    description: str | None
    loan_number: str | None
    total_cuotas: int
    first_payment_date: date
    payment_day: int | None
    cuota_uva: Decimal | None
    cuota_pesos: Decimal | None
    tna: Decimal | None
    original_capital_uva: Decimal | None
    is_active: bool
    created_at: datetime


class MortgageSummary(BaseModel):
    loan: MortgageLoanOut
    cuota_numero: int
    cuotas_restantes: int
    pct_completado: float
    cuota_uva: Decimal | None
    latest_uva_value: Decimal | None
    latest_uva_date: date | None
    cuota_pesos_calculado: Decimal | None
    paid_this_month: bool
    mortgage_record_id: int | None
    next_payment_date: date


class MortgageRecordCreate(BaseModel):
    period_date: date
    payment_amount: Decimal
    capital: Decimal | None = None
    interest: Decimal | None = None
    uva_units: Decimal | None = None


class MortgageRecordOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    period_date: date
    payment_amount: Decimal
    capital: Decimal | None
    interest: Decimal | None
    uva_units: Decimal | None
    mortgage_loan_id: int | None
    expense_entry_id: int | None
