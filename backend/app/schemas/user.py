from datetime import datetime
from pydantic import BaseModel
from app.models.user import UserRole


class UserRegister(BaseModel):
    tenant_name: str
    display_name: str | None = None
    phone_number: str | None = None


class UserJoinTenant(BaseModel):
    tenant_code: str
    display_name: str | None = None
    phone_number: str | None = None


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    firebase_uid: str
    tenant_id: int
    tenant_code: str | None = None
    email: str
    display_name: str | None
    phone_number: str | None
    whatsapp_phone: str | None
    whatsapp_gate_pending: bool
    role: UserRole
    created_at: datetime
