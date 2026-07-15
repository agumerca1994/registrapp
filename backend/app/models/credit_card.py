from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Date, DateTime, ForeignKey, Numeric, func, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class CreditCard(Base):
    __tablename__ = "credit_cards"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    bank: Mapped[str] = mapped_column(String(100))
    alias: Mapped[str] = mapped_column(String(100))
    titular: Mapped[str | None] = mapped_column(String(100), nullable=True)
    last_4_digits: Mapped[str | None] = mapped_column(String(4), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    statements: Mapped[list["CreditCardStatement"]] = relationship(
        back_populates="card", cascade="all, delete-orphan"
    )
    user: Mapped["User"] = relationship(foreign_keys=[user_id])


class CreditCardStatement(Base):
    __tablename__ = "credit_card_statements"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    card_id: Mapped[int] = mapped_column(ForeignKey("credit_cards.id", ondelete="CASCADE"), index=True)
    year: Mapped[int] = mapped_column(Integer)
    month: Mapped[int] = mapped_column(Integer)
    closing_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    due_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    status: Mapped[str] = mapped_column(String(10), default="open")  # "open" | "closed"
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    __table_args__ = (UniqueConstraint("card_id", "year", "month", name="uq_statement_card_period"),)

    card: Mapped["CreditCard"] = relationship(back_populates="statements")
    items: Mapped[list["CreditCardItem"]] = relationship(
        back_populates="statement", cascade="all, delete-orphan"
    )


class CreditCardItem(Base):
    __tablename__ = "credit_card_items"

    id: Mapped[int] = mapped_column(primary_key=True)
    statement_id: Mapped[int] = mapped_column(
        ForeignKey("credit_card_statements.id", ondelete="CASCADE"), index=True
    )
    description: Mapped[str] = mapped_column(String(255))
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"))
    item_date: Mapped[date] = mapped_column(Date)
    item_type: Mapped[str] = mapped_column(String(20))  # "single" | "installment" | "recurring"
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))

    # Installment fields (nullable for single/recurring)
    installment_count: Mapped[int | None] = mapped_column(Integer, nullable=True)
    installment_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    purchase_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)

    # Points to the first installment item (cuota 1) for cuotas 2..N
    installment_group_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_card_items.id", ondelete="SET NULL", use_alter=True, name="fk_item_group"),
        nullable=True,
    )

    # Link to the generated expense entry (SET NULL if entry is deleted externally)
    expense_entry_id: Mapped[int | None] = mapped_column(
        ForeignKey("expense_entries.id", ondelete="SET NULL"), nullable=True
    )
    currency: Mapped[str] = mapped_column(String(3), default="ARS", server_default="ARS")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    statement: Mapped["CreditCardStatement"] = relationship(back_populates="items")
    category: Mapped["ExpenseCategory"] = relationship()
    expense_entry: Mapped["ExpenseEntry | None"] = relationship(foreign_keys=[expense_entry_id])
    installment_group: Mapped["CreditCardItem | None"] = relationship(
        foreign_keys=[installment_group_id], remote_side="CreditCardItem.id"
    )
    shared_expense: Mapped["SharedExpense | None"] = relationship(
        "SharedExpense", foreign_keys="SharedExpense.credit_card_item_id",
        primaryjoin="CreditCardItem.id == foreign(SharedExpense.credit_card_item_id)",
        uselist=False,
    )
