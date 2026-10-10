from typing import Literal

from pydantic import BaseModel

PayeeKind = Literal["proveedor", "empleado", "otro"]


class PayeeCreate(BaseModel):
    name: str
    kind: PayeeKind = "proveedor"
    default_category_id: int | None = None
    notes: str | None = None


class PayeeUpdate(BaseModel):
    """Sólo se aplica lo que viene en el body: un `null` explícito en
    `default_category_id` o `notes` los borra."""
    name: str | None = None
    kind: PayeeKind | None = None
    default_category_id: int | None = None
    notes: str | None = None
    is_active: bool | None = None


class PayeeOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    kind: str
    default_category_id: int | None = None
    notes: str | None = None
    is_active: bool = True
