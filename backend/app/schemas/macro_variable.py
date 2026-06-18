from datetime import date, datetime
from decimal import Decimal
from pydantic import BaseModel


class MacroVariableOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    period_date: date
    uva_value: Decimal | None
    inflation_monthly_pct: Decimal | None
    inflation_interanual_pct: Decimal | None
    usd_official: Decimal | None
    usd_blue: Decimal | None
    usd_mayorista: Decimal | None
    ripte: Decimal | None
    smvm: Decimal | None
    canasta_basica_total: Decimal | None
    source: str | None
    updated_at: datetime
