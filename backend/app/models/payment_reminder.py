from datetime import date, datetime
from sqlalchemy import String, Date, DateTime, Boolean, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class PaymentReminder(Base):
    __tablename__ = "payment_reminders"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    title: Mapped[str] = mapped_column(String(200))
    remind_date: Mapped[date] = mapped_column(Date, index=True)
    statement_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_card_statements.id", ondelete="SET NULL"), nullable=True
    )
    notified: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
