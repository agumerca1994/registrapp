from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Boolean, Date, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


# Cómo se lee cada `loan_type` viejo en los ejes nuevos.
LEGACY_TYPES: dict[str, dict[str, str]] = {
    "uva_frances": {"adjustment": "uva", "amortization": "frances", "method": "cuota"},
    "uva_aleman": {"adjustment": "uva", "amortization": "aleman", "method": "cuota"},
    "tasa_fija": {"adjustment": "fija", "amortization": "frances", "method": "cuota"},
    "tasa_variable": {"adjustment": "fija", "amortization": "frances", "method": "manual"},
}


class MortgageLoan(Base):
    """Un crédito del hogar. La tabla se llama así porque empezó siendo sólo la
    hipoteca; desde Créditos (`services/credits.py`) guarda cualquier préstamo.

    Un crédito se define por dos ejes independientes, más cómo se conoce la cuota:
    - `adjustment`: 'uva' (el capital está en UVA) o 'fija' (en su moneda, con
      `tna` 0 si no tiene interés). La moneda es `currency`.
    - `amortization`: 'frances' | 'aleman' | 'americano'.
    - `method`: 'formula' (se calcula de capital, TNA y plazo), 'cuota' (la
      persona sabe la cuota: `cuota_uva` o `cuota_pesos`, que está en `currency`)
      o 'manual' (cada cuota se carga a mano: plan de ahorro, tasa variable).
    """
    __tablename__ = "mortgage_loans"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)

    # Legado: 'uva_frances' | 'uva_aleman' | 'tasa_fija' | 'tasa_variable'. Lo
    # sigue leyendo la pantalla de Hipoteca de producción; lo deriva
    # `credits.legacy_loan_type` de los campos de abajo.
    loan_type: Mapped[str] = mapped_column(String(20))
    # hipotecario | personal | prendario | plan_ahorro | particular | otro
    kind: Mapped[str] = mapped_column(String(20), server_default="hipotecario", default="hipotecario")
    adjustment: Mapped[str] = mapped_column(String(12), server_default="uva", default="uva")
    amortization: Mapped[str] = mapped_column(String(12), server_default="frances", default="frances")
    method: Mapped[str] = mapped_column(String(12), server_default="cuota", default="cuota")
    currency: Mapped[str] = mapped_column(String(3), server_default="ARS", default="ARS")
    capital: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))  # en `currency`, si no es UVA
    # Plan de ahorro: 'suscripto' | 'adjudicado'.
    plan_status: Mapped[str | None] = mapped_column(String(12))
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

    def __init__(self, **kw):
        # Quien todavía crea un préstamo sólo con `loan_type` (la pantalla vieja,
        # un script) no tiene que terminar con los ejes por defecto, que serían
        # los de un UVA.
        for key, value in LEGACY_TYPES.get(kw.get("loan_type", ""), {}).items():
            kw.setdefault(key, value)
        super().__init__(**kw)
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
    cuota_number: Mapped[int | None] = mapped_column(Integer)
    currency: Mapped[str] = mapped_column(String(3), server_default="ARS", default="ARS")
    # Una cuota cargada a mano (plan de ahorro, tasa variable) se puede borrar:
    # la escribió alguien. Las que calcula la app no.
    is_manual: Mapped[bool] = mapped_column(Boolean, server_default="false", default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="mortgage_records")
    loan: Mapped["MortgageLoan | None"] = relationship(back_populates="records")
