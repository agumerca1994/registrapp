from datetime import datetime
from sqlalchemy import String, DateTime, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class Tenant(Base):
    __tablename__ = "tenants"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    users: Mapped[list["User"]] = relationship(back_populates="tenant")
    income_sources: Mapped[list["IncomeSource"]] = relationship(back_populates="tenant")
    expense_categories: Mapped[list["ExpenseCategory"]] = relationship(back_populates="tenant")
    mortgage_loans: Mapped[list["MortgageLoan"]] = relationship(back_populates="tenant")
    mortgage_records: Mapped[list["MortgageRecord"]] = relationship(back_populates="tenant")
