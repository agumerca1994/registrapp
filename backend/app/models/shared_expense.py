from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Date, DateTime, ForeignKey, Numeric, Boolean, Integer, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class SharedExpense(Base):
    __tablename__ = "shared_expenses"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    title: Mapped[str] = mapped_column(String(255))
    total_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"))
    split_type: Mapped[str] = mapped_column(String(10))
    expense_date: Mapped[date] = mapped_column(Date, index=True)
    locked: Mapped[bool] = mapped_column(Boolean, default=False)
    credit_card_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_card_items.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    splits: Mapped[list["SharedExpenseSplit"]] = relationship(
        back_populates="shared_expense", cascade="all, delete-orphan"
    )
    category: Mapped["ExpenseCategory"] = relationship()
    created_by: Mapped["User"] = relationship(foreign_keys=[created_by_user_id])


class SharedExpenseSplit(Base):
    __tablename__ = "shared_expense_splits"

    id: Mapped[int] = mapped_column(primary_key=True)
    shared_expense_id: Mapped[int] = mapped_column(
        ForeignKey("shared_expenses.id", ondelete="CASCADE"), index=True
    )
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    member_name: Mapped[str] = mapped_column(String(120))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    status: Mapped[str] = mapped_column(String(10), default="pending")
    expense_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("expense_entries.id", ondelete="SET NULL"), nullable=True
    )
    invite_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    invite_token: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    invite_expires_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    shared_expense: Mapped["SharedExpense"] = relationship(back_populates="splits")
    user: Mapped["User | None"] = relationship(foreign_keys=[user_id])
    expense_entry: Mapped["ExpenseEntry | None"] = relationship(foreign_keys=[expense_entry_id])