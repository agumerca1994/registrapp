from pydantic import BaseModel


class ContactOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    contact_name: str
    contact_phone: str


class ContactCreate(BaseModel):
    contact_name: str
    contact_phone: str
