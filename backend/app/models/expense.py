from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Date, DateTime, ForeignKey, Numeric, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[str | None] = mapped_column(String(7))
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="expense_categories")
    entries: Mapped[list["ExpenseEntry"]] = relationship(back_populates="category")


class ExpenseEntry(Base):
    __tablename__ = "expense_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    description: Mapped[str | None] = mapped_column(String(255))
    expense_date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(String(500))
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    entity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    category: Mapped["ExpenseCategory"] = relationship(back_populates="entries")
    user: Mapped["User"] = relationship(back_populates="expense_entries")
