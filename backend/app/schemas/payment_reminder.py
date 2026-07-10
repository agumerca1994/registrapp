from datetime import date, datetime
from pydantic import BaseModel


class ReminderCreate(BaseModel):
    title: str
    remind_date: date
    statement_id: int | None = None


class ReminderOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    title: str
    remind_date: date
    statement_id: int | None
    notified: bool
    created_at: datetime
