from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Date, DateTime, ForeignKey, Numeric, func, Enum, Integer, UniqueConstraint
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
    # Una fuente que arma el sistema y no la persona: "sales" es la de Ventas
    # de un negocio, a la que entra un ingreso por día calculado desde las
    # ventas. No acepta altas ni ediciones a mano (services/income.py).
    system_key: Mapped[str | None] = mapped_column(String(20), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="income_sources")
    entries: Mapped[list["IncomeEntry"]] = relationship(back_populates="source")
    fields: Mapped[list["IncomeSourceField"]] = relationship(
        back_populates="source", order_by="IncomeSourceField.position",
        passive_deletes=True,
    )


# Cómo entra un campo en la cuenta del neto: `add` (bruto, bono, aguinaldo,
# reintegro), `subtract` (cargas sociales, ganancias) o `info` (se guarda para
# analizar, pero no suma ni resta — p. ej. un "básico" que ya está dentro del bruto).
FIELD_KINDS = ("add", "subtract", "info")


class IncomeSourceField(Base):
    """Un renglón de detalle que una fuente ofrece al cargar un ingreso.

    Nunca se borra: quitarlo de la fuente lo archiva (`is_active=False`). Los
    ingresos ya cargados conservan sus montos y los siguen mostrando; el FK de
    `income_entry_items.field_id` es RESTRICT para que la base lo haga cumplir.
    """
    __tablename__ = "income_source_fields"

    id: Mapped[int] = mapped_column(primary_key=True)
    source_id: Mapped[int] = mapped_column(
        ForeignKey("income_sources.id", ondelete="CASCADE"), index=True,
    )
    name: Mapped[str] = mapped_column(String(80))
    kind: Mapped[str] = mapped_column(String(10))
    position: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    is_active: Mapped[bool] = mapped_column(default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    source: Mapped["IncomeSource"] = relationship(back_populates="fields")


class IncomeEntry(Base):
    __tablename__ = "income_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    source_id: Mapped[int] = mapped_column(ForeignKey("income_sources.id"))
    bruto: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    deducciones: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    currency: Mapped[str] = mapped_column(String(3), default="ARS", server_default="ARS")
    period_date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    source: Mapped["IncomeSource"] = relationship(back_populates="entries")
    user: Mapped["User"] = relationship(back_populates="income_entries")
    items: Mapped[list["IncomeEntryItem"]] = relationship(
        back_populates="entry", cascade="all, delete-orphan",
    )


class IncomeEntryItem(Base):
    __tablename__ = "income_entry_items"
    __table_args__ = (UniqueConstraint("entry_id", "field_id", name="uq_income_entry_item_field"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    entry_id: Mapped[int] = mapped_column(
        ForeignKey("income_entries.id", ondelete="CASCADE"), index=True,
    )
    field_id: Mapped[int] = mapped_column(
        ForeignKey("income_source_fields.id", ondelete="RESTRICT"), index=True,
    )
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))

    entry: Mapped["IncomeEntry"] = relationship(back_populates="items")
    field: Mapped["IncomeSourceField"] = relationship(lazy="joined")

    # Lo que lee `IncomeEntryOut.items`. `field` viene con lazy="joined", así
    # que cargar `IncomeEntry.items` con selectinload ya lo trae.
    @property
    def name(self) -> str:
        return self.field.name

    @property
    def kind(self) -> str:
        return self.field.kind

    @property
    def field_active(self) -> bool:
        return self.field.is_active
