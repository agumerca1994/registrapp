from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel


class MacroVariableUpsert(BaseModel):
    period_date: date
    uva_value: Decimal | None = None
    inflation_monthly_pct: Decimal | None = None
    inflation_interanual_pct: Decimal | None = None
    usd_official: Decimal | None = None
    usd_blue: Decimal | None = None
    source: str | None = "manual"


class MacroVariableOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    period_date: date
    uva_value: Decimal | None
    inflation_monthly_pct: Decimal | None
    inflation_interanual_pct: Decimal | None
    usd_official: Decimal | None
    usd_blue: Decimal | None
    source: str | None
    updated_at: datetime
