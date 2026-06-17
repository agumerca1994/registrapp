from datetime import datetime
from pydantic import BaseModel
from app.models.user import UserRole


class UserRegister(BaseModel):
    tenant_name: str
    display_name: str | None = None
    phone_number: str | None = None


class UserJoinTenant(BaseModel):
    tenant_id: int
    display_name: str | None = None
    phone_number: str | None = None


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    firebase_uid: str
    tenant_id: int
    email: str
    display_name: str | None
    phone_number: str | None
    role: UserRole
    created_at: datetime
