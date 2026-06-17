from datetime import datetime
from pydantic import BaseModel


class TenantCreate(BaseModel):
    name: str


class TenantOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    name: str
    created_at: datetime
