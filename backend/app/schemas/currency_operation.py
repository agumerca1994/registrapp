from datetime import date
from decimal import Decimal
from pydantic import BaseModel, ConfigDict, model_validator

from app.services.currency import RATE_TYPES

OP_TYPES = ("buy", "sell", "initial", "adjustment")

# Expected sign of `foreign_amount` per op type. None = any non-zero sign.
_SIGN_RULES: dict[str, int | None] = {
    "buy": 1,
    "sell": -1,
    "initial": 1,
    "adjustment": None,
}


def _validate_operation(op_type: str, foreign_amount: Decimal, ars_amount: Decimal | None,
                        rate: Decimal | None, rate_type: str | None) -> None:
    if op_type not in OP_TYPES:
        raise ValueError(f"op_type debe ser uno de: {', '.join(OP_TYPES)}")
    if foreign_amount == 0:
        raise ValueError("El monto no puede ser cero")

    expected = _SIGN_RULES[op_type]
    if expected == 1 and foreign_amount < 0:
        raise ValueError("El monto debe ser positivo para una compra o tenencia inicial")
    if expected == -1 and foreign_amount > 0:
        raise ValueError("El monto de una venta debe ser negativo (sale divisa)")

    if op_type in ("buy", "sell"):
        if ars_amount is None or ars_amount <= 0:
            raise ValueError("Una compra o venta necesita el monto en pesos")
    else:
        # A starting balance or a correction has no peso leg — it never moved
        # pesos, so letting one through would corrupt the available-pesos math.
        if ars_amount is not None:
            raise ValueError("La tenencia inicial y los ajustes no llevan monto en pesos")

    if rate is not None and rate <= 0:
        raise ValueError("La cotización debe ser mayor a 0")
    if rate_type is not None and rate_type not in RATE_TYPES:
        raise ValueError(f"rate_type debe ser uno de: {', '.join(RATE_TYPES)}")


class CurrencyOperationCreate(BaseModel):
    op_type: str
    operation_date: date
    currency: str = "USD"
    foreign_amount: Decimal
    ars_amount: Decimal | None = None
    rate: Decimal | None = None
    rate_type: str | None = None
    entity: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_all(self) -> "CurrencyOperationCreate":
        _validate_operation(
            self.op_type, self.foreign_amount, self.ars_amount, self.rate, self.rate_type
        )
        # Derive the rate when the client sent both legs but no explicit rate.
        if self.rate is None and self.ars_amount is not None and self.foreign_amount != 0:
            self.rate = (self.ars_amount / abs(self.foreign_amount)).quantize(Decimal("0.0001"))
        return self


class CurrencyOperationUpdate(BaseModel):
    """Full replacement of the editable fields — same rules as create."""
    op_type: str
    operation_date: date
    foreign_amount: Decimal
    ars_amount: Decimal | None = None
    rate: Decimal | None = None
    rate_type: str | None = None
    entity: str | None = None
    notes: str | None = None

    @model_validator(mode="after")
    def validate_all(self) -> "CurrencyOperationUpdate":
        _validate_operation(
            self.op_type, self.foreign_amount, self.ars_amount, self.rate, self.rate_type
        )
        if self.rate is None and self.ars_amount is not None and self.foreign_amount != 0:
            self.rate = (self.ars_amount / abs(self.foreign_amount)).quantize(Decimal("0.0001"))
        return self


class CurrencyOperationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    op_type: str
    operation_date: date
    currency: str
    foreign_amount: Decimal
    ars_amount: Decimal | None
    rate: Decimal | None
    rate_type: str | None
    entity: str | None
    notes: str | None


class CurrencySettingsOut(BaseModel):
    fx_rate_type: str
    rate: Decimal | None


class CurrencySettingsUpdate(BaseModel):
    fx_rate_type: str

    @model_validator(mode="after")
    def validate_rate_type(self) -> "CurrencySettingsUpdate":
        # "personalizado" is a per-operation escape hatch, not a valuation
        # source — there's no MacroVariable column behind it.
        valid = [r for r in RATE_TYPES if r != "personalizado"]
        if self.fx_rate_type not in valid:
            raise ValueError(f"fx_rate_type debe ser uno de: {', '.join(valid)}")
        return self


class CurrencySummaryOut(BaseModel):
    """Stock and flow in one response — they answer different questions.

    Stock (`holding_*`) carries across months: dollars bought in August to pay a
    September card statement stay on the books. Flow (`bought_*`/`spent_usd`) is
    what happened inside the selected month.
    """
    currency: str
    period: str

    # Stock, plus the all-time flows that add up to it. Without these the
    # holding is an unexplainable number: the month tiles below only cover the
    # selected month, but the holding accumulates since `start_date`.
    holding: Decimal
    holding_start: Decimal
    initial: Decimal
    start_date: date | None
    total_bought: Decimal
    total_sold: Decimal
    total_spent: Decimal
    total_adjustments: Decimal
    # Billed to a card but not paid yet — the dollars are still held, and this
    # is what the next statement will take.
    pending_usd: Decimal
    next_due_date: date | None

    # Flow for the selected month
    bought_usd: Decimal
    bought_ars: Decimal
    sold_usd: Decimal
    sold_ars: Decimal
    spent_usd: Decimal
    adjustments_usd: Decimal
    net_usd: Decimal

    # Valuation
    rate: Decimal | None
    rate_type: str
    valuation_ars: Decimal | None
