from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Date, DateTime, ForeignKey, Numeric, func, String
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class MacroVariable(Base):
    __tablename__ = "macro_variables"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    period_date: Mapped[date] = mapped_column(Date, index=True)

    uva_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    inflation_monthly_pct: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    usd_official: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    usd_mep: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))

    source: Mapped[str | None] = mapped_column(String(50))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="macro_variables")
