from datetime import date, datetime
from decimal import Decimal

from pydantic import BaseModel, Field, model_validator

from app.services.credits import (
    ADJUSTMENTS, AMORTIZATIONS, CURRENCIES, KINDS, MAX_CUOTAS, METHODS, PLAN_STATUSES,
)


class CreditCreate(BaseModel):
    kind: str = "hipotecario"
    adjustment: str = "fija"
    currency: str = "ARS"
    amortization: str = "frances"
    method: str = "cuota"
    description: str | None = Field(default=None, max_length=255)
    loan_number: str | None = Field(default=None, max_length=50)
    total_cuotas: int
    first_payment_date: date
    payment_day: int | None = None  # None = primer día hábil, 1-28 = día fijo
    cuota_uva: Decimal | None = None
    cuota_pesos: Decimal | None = None  # la cuota en `currency`
    tna: Decimal | None = None
    original_capital_uva: Decimal | None = None
    capital: Decimal | None = None  # en `currency`; en UVA, los pesos del desembolso
    # En UVA con fórmula, si se da el capital en pesos: la UVA de ese día lo pasa a UVA.
    disbursement_date: date | None = None
    plan_status: str | None = None

    @model_validator(mode="after")
    def check(self):
        if self.kind not in KINDS:
            raise ValueError("Elegí un tipo de crédito de la lista.")
        if self.kind == "plan_ahorro":
            # No tiene tasa ni capital con interés: la cuota sigue el precio del bien.
            self.method, self.adjustment, self.amortization = "manual", "fija", "frances"
            self.plan_status = self.plan_status or "suscripto"
        if self.currency not in CURRENCIES:
            raise ValueError("La moneda tiene que ser pesos o dólares.")
        if self.currency == "USD":
            self.adjustment = "fija"
        if self.adjustment not in ADJUSTMENTS or self.amortization not in AMORTIZATIONS or self.method not in METHODS:
            raise ValueError("Esa combinación de crédito no existe.")
        if self.plan_status is not None and self.plan_status not in PLAN_STATUSES:
            raise ValueError("El plan puede estar suscripto o adjudicado.")
        if not 1 <= self.total_cuotas <= MAX_CUOTAS:
            raise ValueError(f"La cantidad de cuotas va de 1 a {MAX_CUOTAS}.")
        if self.payment_day is not None and not 1 <= self.payment_day <= 28:
            raise ValueError("El día de pago va del 1 al 28.")
        if self.tna is not None and not 0 <= self.tna <= 1000:
            raise ValueError("La TNA tiene que estar entre 0 y 1000%.")
        for v in (self.cuota_uva, self.cuota_pesos, self.capital, self.original_capital_uva):
            if v is not None and v <= 0:
                raise ValueError("Los montos tienen que ser mayores que cero.")

        if self.method == "cuota":
            if self.adjustment == "uva" and not self.cuota_uva:
                raise ValueError("Decime la cuota en UVA.")
            if self.adjustment == "fija" and not self.cuota_pesos:
                raise ValueError("Decime cuánto es la cuota.")
        if self.method == "formula":
            if self.adjustment == "uva" and not self.original_capital_uva and not (self.capital and self.disbursement_date):
                raise ValueError("Decime el capital en UVA, o el capital en pesos y la fecha en que te lo dieron.")
            if self.adjustment == "fija" and not self.capital:
                raise ValueError("Decime el capital que te prestaron.")
        return self


class CreditUpdate(BaseModel):
    """Corregir un crédito: lo que cambia rige para las cuotas que todavía no se
    registraron. Las registradas no se tocan."""
    description: str | None = Field(default=None, max_length=255)
    loan_number: str | None = Field(default=None, max_length=50)
    payment_day: int | None = None
    total_cuotas: int | None = None
    cuota_uva: Decimal | None = None
    cuota_pesos: Decimal | None = None
    tna: Decimal | None = None
    original_capital_uva: Decimal | None = None
    capital: Decimal | None = None
    plan_status: str | None = None
    is_active: bool | None = None

    @model_validator(mode="after")
    def check(self):
        if self.total_cuotas is not None and not 1 <= self.total_cuotas <= MAX_CUOTAS:
            raise ValueError(f"La cantidad de cuotas va de 1 a {MAX_CUOTAS}.")
        if self.payment_day is not None and not 1 <= self.payment_day <= 28:
            raise ValueError("El día de pago va del 1 al 28.")
        if self.plan_status is not None and self.plan_status not in PLAN_STATUSES:
            raise ValueError("El plan puede estar suscripto o adjudicado.")
        return self


class CreditOut(BaseModel):
    id: int
    kind: str
    kind_label: str
    title: str
    adjustment: str
    amortization: str
    method: str
    currency: str
    description: str | None
    loan_number: str | None
    total_cuotas: int
    first_payment_date: date
    payment_day: int | None
    cuota_uva: Decimal | None
    cuota_pesos: Decimal | None
    tna: Decimal | None
    original_capital_uva: Decimal | None
    capital: Decimal | None
    plan_status: str | None
    is_active: bool
    created_at: datetime
    # Calculado
    cuota_numero: int
    cuotas_pagadas: int
    cuotas_restantes: int
    pct_completado: float
    finished: bool
    paid_this_month: bool
    next_payment_date: date | None
    next_amount: Decimal | None
    next_units: Decimal | None
    next_is_estimated: bool
    balance: Decimal | None
    balance_units: Decimal | None
    total_paid: Decimal
    this_month_paid: Decimal
    uva_value: Decimal | None
    uva_date: date | None


class CreditPaymentOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    period_date: date
    payment_amount: Decimal
    capital: Decimal | None
    interest: Decimal | None
    uva_units: Decimal | None
    cuota_number: int | None
    currency: str
    is_manual: bool
    expense_entry_id: int | None
    # El día en que salió: la fecha de su egreso.
    paid_on: date | None = None


class CreditDetail(BaseModel):
    credit: CreditOut
    payments: list[CreditPaymentOut]


class CreditPaymentCreate(BaseModel):
    """Una cuota cargada a mano: plan de ahorro, tasa variable, o la que no se
    registró sola."""
    amount: Decimal
    paid_on: date
    cuota_number: int | None = None

    @model_validator(mode="after")
    def check(self):
        if self.amount <= 0:
            raise ValueError("El monto tiene que ser mayor que cero.")
        return self


class CreditPreview(BaseModel):
    """La primera y la última cuota antes de guardar, para ver si cierra con lo del banco."""
    first_amount: Decimal | None
    first_units: Decimal | None
    last_amount: Decimal | None
    last_units: Decimal | None
    total_units: Decimal | None  # lo que se paga en total, en unidades
    original_capital_uva: Decimal | None
    estimated: bool
