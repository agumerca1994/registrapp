from datetime import date, datetime
from decimal import Decimal
from typing import Literal
from pydantic import BaseModel, Field, field_validator
from app.models.income import IncomeType

FieldKind = Literal["add", "subtract", "info"]


class IncomeSourceFieldIn(BaseModel):
    """Un campo tal como lo manda el formulario de la fuente.

    Con `id` es uno existente (se renombra/reordena); sin `id`, uno nuevo. Los
    existentes que no vienen en la lista se archivan, no se borran.
    """
    id: int | None = None
    name: str = Field(min_length=1, max_length=80)
    kind: FieldKind

    @field_validator("name")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("El campo necesita un nombre")
        return v


class IncomeSourceFieldOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    kind: FieldKind
    position: int
    is_active: bool
    # Con ítems cargados el tipo queda fijo: cambiarlo reinterpretaría meses
    # ya cerrados. Lo calcula el router, no es columna.
    has_items: bool = False


class IncomeSourceCreate(BaseModel):
    name: str
    income_type: IncomeType
    description: str | None = None
    fields: list[IncomeSourceFieldIn] = []


class IncomeSourceUpdate(BaseModel):
    name: str | None = None
    income_type: IncomeType | None = None
    # Lista completa: lo que no viene se archiva. None = no tocar los campos.
    fields: list[IncomeSourceFieldIn] | None = None


class IncomeSourceBrief(BaseModel):
    """La fuente embebida en cada ingreso, sin sus campos: el formulario los
    toma de `GET /sources`, y traerlos acá obligaría a cargarlos en cada lista."""
    model_config = {"from_attributes": True}

    id: int
    name: str
    income_type: IncomeType
    description: str | None
    is_active: bool


class IncomeSourceOut(IncomeSourceBrief):
    fields: list[IncomeSourceFieldOut] = []


class IncomeEntryItemIn(BaseModel):
    field_id: int
    amount: Decimal


class IncomeEntryItemOut(BaseModel):
    model_config = {"from_attributes": True}

    field_id: int
    name: str
    kind: FieldKind
    amount: Decimal
    field_active: bool


# `bruto` y `deducciones` ya no se reciben: el servidor los deriva de los ítems
# (Σ add, Σ subtract) para que la analítica y el conector sigan teniendo esos
# totales sin saber nada de campos.
class IncomeEntryCreate(BaseModel):
    source_id: int
    amount: Decimal
    currency: str = "ARS"
    period_date: date
    notes: str | None = None
    items: list[IncomeEntryItemIn] = []


class IncomeEntryUpdate(BaseModel):
    source_id: int | None = None
    amount: Decimal | None = None
    currency: str | None = None
    period_date: date | None = None
    notes: str | None = None
    # None = no tocar el detalle; [] = vaciarlo.
    items: list[IncomeEntryItemIn] | None = None


class IncomeEntryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    source_id: int
    bruto: Decimal | None
    deducciones: Decimal | None
    amount: Decimal
    currency: str = "ARS"
    period_date: date
    notes: str | None
    created_at: datetime
    source: IncomeSourceBrief
    items: list[IncomeEntryItemOut] = []
