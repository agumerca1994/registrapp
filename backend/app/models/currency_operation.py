from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Date, DateTime, ForeignKey, Numeric, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class CurrencyOperation(Base):
    """A move of foreign currency in or out of the household's holding.

    Deliberately *not* an income or an expense: buying dollars doesn't change
    net worth, it moves money between pockets. It never enters the
    income/expense totals, but it does change the holding and the pesos left.

    `foreign_amount` is **signed** — positive means currency came in, negative
    means it went out. That keeps the holding a flat SUM() instead of a CASE
    per op_type, and lets a manual adjustment go either way without inventing
    two op types. The sign is validated against `op_type` in the schema layer.

      buy         foreign_amount > 0,  ars_amount > 0   (pesos out)
      sell        foreign_amount < 0,  ars_amount > 0   (pesos in)
      initial     foreign_amount > 0,  ars_amount NULL  (declared starting balance)
      adjustment  foreign_amount != 0, ars_amount NULL  (correction, either way)
    """

    __tablename__ = "currency_operations"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    op_type: Mapped[str] = mapped_column(String(20))
    operation_date: Mapped[date] = mapped_column(Date, index=True)
    currency: Mapped[str] = mapped_column(String(3), default="USD", server_default="USD")

    foreign_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    ars_amount: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    rate: Mapped[Decimal | None] = mapped_column(Numeric(18, 4), nullable=True)
    rate_type: Mapped[str | None] = mapped_column(String(20), nullable=True)

    entity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    user: Mapped["User"] = relationship()
