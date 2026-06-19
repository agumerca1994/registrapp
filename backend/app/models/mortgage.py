from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


class MortgageLoan(Base):
    __tablename__ = "mortgage_loans"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)

    # 'uva_frances' | 'uva_aleman' | 'tasa_fija' | 'tasa_variable'
    loan_type: Mapped[str] = mapped_column(String(20))
    description: Mapped[str | None] = mapped_column(String(255))
    loan_number: Mapped[str | None] = mapped_column(String(50))

    total_cuotas: Mapped[int] = mapped_column(Integer)
    first_payment_date: Mapped[date] = mapped_column(Date)

    cuota_uva: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))      # UVA types
    cuota_pesos: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))    # tasa_fija
    tna: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))              # optional breakdown
    original_capital_uva: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))  # for amortization

    # None = primer día hábil del mes, 1-28 = día fijo
    payment_day: Mapped[int | None] = mapped_column(Integer, nullable=True)

    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="mortgage_loans")
    records: Mapped[list["MortgageRecord"]] = relationship(back_populates="loan")


class MortgageRecord(Base):
    __tablename__ = "mortgage_records"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    mortgage_loan_id: Mapped[int | None] = mapped_column(ForeignKey("mortgage_loans.id"), index=True)
    expense_entry_id: Mapped[int | None] = mapped_column(ForeignKey("expense_entries.id"))
    period_date: Mapped[date] = mapped_column(Date, index=True)

    payment_amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    capital: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    interest: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    uva_units: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="mortgage_records")
    loan: Mapped["MortgageLoan | None"] = relationship(back_populates="records")
