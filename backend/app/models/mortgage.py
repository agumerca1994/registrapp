from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Date, DateTime, ForeignKey, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class MortgageRecord(Base):
    __tablename__ = "mortgage_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    period_date: Mapped[date] = mapped_column(Date, index=True)

    payment_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    capital: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    interest: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    uva_units: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="mortgage_records")
