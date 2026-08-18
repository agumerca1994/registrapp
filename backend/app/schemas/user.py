from datetime import datetime
from pydantic import BaseModel
from app.models.user import UserRole


class UserRegister(BaseModel):
    tenant_name: str
    first_name: str | None = None
    last_name: str | None = None
    alias: str | None = None
    display_name: str | None = None
    phone_number: str | None = None


class UserJoinTenant(BaseModel):
    tenant_code: str
    first_name: str | None = None
    last_name: str | None = None
    alias: str | None = None
    display_name: str | None = None
    phone_number: str | None = None


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    firebase_uid: str
    tenant_id: int
    tenant_code: str | None = None
    tenant_name: str | None = None
    email: str
    first_name: str | None = None
    last_name: str | None = None
    display_name: str | None
    phone_number: str | None
    whatsapp_phone: str | None
    whatsapp_gate_pending: bool
    alias: str | None = None
    discoverable: bool = True
    whatsapp_notifications: bool = True
    role: UserRole
    created_at: datetime
