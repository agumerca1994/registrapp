from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class SavingsGoal(Base):
    """Un objetivo de ahorro del hogar: cuánto, en qué moneda y para cuándo.

    Lo juntado es la suma de sus aportes. Apartar plata para un objetivo no es
    un gasto (como comprar dólares, la plata cambia de bolsillo), así que los
    aportes no tocan ingresos, egresos ni el balance del mes.
    """
    __tablename__ = "savings_goals"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(80))
    currency: Mapped[str] = mapped_column(String(3), default="USD")
    target_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    target_date: Mapped[date | None] = mapped_column(Date)
    archived_at: Mapped[datetime | None] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    contributions: Mapped[list["SavingsContribution"]] = relationship(
        back_populates="goal", cascade="all, delete-orphan", passive_deletes=True,
    )


class SavingsContribution(Base):
    """Un aporte (positivo) o un retiro (negativo) de un objetivo."""
    __tablename__ = "savings_contributions"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    goal_id: Mapped[int] = mapped_column(ForeignKey("savings_goals.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    contribution_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    goal: Mapped[SavingsGoal] = relationship(back_populates="contributions")
