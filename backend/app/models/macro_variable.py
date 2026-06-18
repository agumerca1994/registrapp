from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import Date, DateTime, Numeric, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class MacroVariable(Base):
    __tablename__ = "macro_variables"
    __table_args__ = (UniqueConstraint("period_date", name="uq_macro_period_date"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    period_date: Mapped[date] = mapped_column(Date, index=True)

    # argentinadatos.com
    uva_value: Mapped[Decimal | None] = mapped_column(Numeric(18, 6))
    inflation_monthly_pct: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    inflation_interanual_pct: Mapped[Decimal | None] = mapped_column(Numeric(8, 4))
    usd_official: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    usd_blue: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    usd_mayorista: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    usd_mep: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))
    usd_ccl: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))

    # BCRA (no historical API available — populated by daily cron only)
    uvi: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    icl: Mapped[Decimal | None] = mapped_column(Numeric(18, 4))

    # INDEC
    ripte: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    smvm: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))
    canasta_basica_total: Mapped[Decimal | None] = mapped_column(Numeric(18, 2))

    source: Mapped[str | None] = mapped_column(String(50))
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), onupdate=func.now())
