from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class Investment(Base):
    """Dónde está la plata del hogar y cuánto vale hoy: un plazo fijo, una
    cuenta remunerada, un FCI, acciones, cripto o efectivo.

    Lo que vale sale de `services/investments.py`: calculado con la tasa en un
    plazo fijo o una cuenta, y del último valor cargado en lo que cotiza.
    Invertir no es un gasto ni lo que rinde un ingreso: nada de esto toca el
    resultado del mes.
    """
    __tablename__ = "investments"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    name: Mapped[str] = mapped_column(String(80))
    # plazo_fijo | cuenta | fci | acciones | cripto | efectivo
    kind: Mapped[str] = mapped_column(String(20))
    currency: Mapped[str] = mapped_column(String(3), default="ARS")
    institution: Mapped[str | None] = mapped_column(String(80))  # banco, billetera o broker
    tna: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    start_date: Mapped[date] = mapped_column(Date)
    maturity_date: Mapped[date | None] = mapped_column(Date)  # plazo fijo
    closed_at: Mapped[date | None] = mapped_column(Date)  # rescatada
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    movements: Mapped[list["InvestmentMovement"]] = relationship(
        back_populates="investment", cascade="all, delete-orphan", passive_deletes=True,
    )


class InvestmentMovement(Base):
    """`deposit` (pusiste), `withdrawal` (sacaste) o `valuation` (lo que valía
    todo ese día). Los montos van siempre positivos; el sentido lo da `kind`."""
    __tablename__ = "investment_movements"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    investment_id: Mapped[int] = mapped_column(ForeignKey("investments.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    kind: Mapped[str] = mapped_column(String(12))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    movement_date: Mapped[date] = mapped_column(Date)
    note: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    investment: Mapped[Investment] = relationship(back_populates="movements")
