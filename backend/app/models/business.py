"""Las tablas del negocio (tenants con `kind='business'`).

Viven aparte de las del hogar a propósito: si algún día el negocio se separa en
otra instalación, es copiar estas tablas por `tenant_id`. Ver la sección
"Negocio" de CLAUDE.md.
"""
from datetime import datetime

from sqlalchemy import (
    Boolean, CheckConstraint, DateTime, ForeignKey, String, UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

PAYEE_KIND_SUPPLIER = "proveedor"
PAYEE_KIND_EMPLOYEE = "empleado"
PAYEE_KIND_OTHER = "otro"
PAYEE_KINDS = (PAYEE_KIND_SUPPLIER, PAYEE_KIND_EMPLOYEE, PAYEE_KIND_OTHER)


class Payee(Base):
    """A quién le paga un negocio: proveedor, empleado u otro.

    Un empleado de esta tabla es alguien a quien se le paga un sueldo, no una
    cuenta de la app: el rol "empleado" de un usuario es otra cosa (qué puede
    ver), y las dos pueden no coincidir.
    """
    __tablename__ = "payees"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name_key", name="uq_payees_tenant_name"),
        CheckConstraint("kind IN ('proveedor', 'empleado', 'otro')", name="ck_payees_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    # El nombre plegado (services/search.fold_text): "Verdulería" y
    # "verduleria" son el mismo proveedor.
    name_key: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(12), default=PAYEE_KIND_SUPPLIER)
    # La categoría que se propone al elegirlo: a Juan se le pagan sueldos.
    default_category_id: Mapped[int | None] = mapped_column(
        ForeignKey("expense_categories.id", ondelete="SET NULL"), nullable=True
    )
    notes: Mapped[str | None] = mapped_column(String(255), nullable=True)
    # No se borra: se archiva, y los gastos viejos conservan a quién se pagó.
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
