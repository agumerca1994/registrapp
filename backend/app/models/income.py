from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Date, DateTime, ForeignKey, Numeric, func, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum
from app.core.database import Base


class IncomeType(str, enum.Enum):
    salary = "salary"
    bonus = "bonus"
    aguinaldo = "aguinaldo"
    investment = "investment"
    other = "other"


class IncomeSource(Base):
    __tablename__ = "income_sources"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    income_type: Mapped[IncomeType] = mapped_column(Enum(IncomeType))
    description: Mapped[str | None] = mapped_column(String(255))
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="income_sources")
    entries: Mapped[list["IncomeEntry"]] = relationship(back_populates="source")


class IncomeEntry(Base):
    __tablename__ = "income_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    source_id: Mapped[int] = mapped_column(ForeignKey("income_sources.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    period_date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    source: Mapped["IncomeSource"] = relationship(back_populates="entries")
    user: Mapped["User"] = relationship(back_populates="income_entries")
