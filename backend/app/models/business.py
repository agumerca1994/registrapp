"""Las tablas del negocio (tenants con `kind='business'`).

Viven aparte de las del hogar a propósito: si algún día el negocio se separa en
otra instalación, es copiar estas tablas por `tenant_id`. Ver la sección
"Negocio" de CLAUDE.md.
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    Boolean, CheckConstraint, Date, DateTime, ForeignKey, Index, Integer, Numeric, String,
    UniqueConstraint, func, text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

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


PRODUCT_KIND_RESALE = "reventa"
PRODUCT_KIND_MADE = "elaborado"
PRODUCT_KINDS = (PRODUCT_KIND_RESALE, PRODUCT_KIND_MADE)
PRODUCT_UNITS = ("unidad", "porcion", "kg")


class Product(Base):
    """Lo que vende un negocio. `reventa` entra con la compra (12 Coca-Cola);
    `elaborado` lo produce (porciones) y su materia prima es gasto directo."""
    __tablename__ = "products"
    __table_args__ = (
        UniqueConstraint("tenant_id", "name_key", name="uq_products_tenant_name"),
        CheckConstraint("kind IN ('reventa', 'elaborado')", name="ck_products_kind"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    name_key: Mapped[str] = mapped_column(String(120))
    kind: Mapped[str] = mapped_column(String(10), default=PRODUCT_KIND_MADE)
    unit: Mapped[str] = mapped_column(String(10), default="unidad")
    # Precio de lista: lo que propone una venta. El cobrado puede ser otro.
    sale_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    track_stock: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    min_stock: Mapped[Decimal | None] = mapped_column(Numeric(12, 3), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default="true")
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


SALE_KIND_TICKET = "ticket"
SALE_KIND_CLOSE = "cierre"
PAYMENT_METHODS = ("efectivo", "debito", "credito", "mercadopago", "transferencia", "otro")


class Sale(Base):
    """Una venta (`ticket`) o el cierre del día (`cierre`: lo CONTADO por medio
    de pago). `total` es la suma de los pagos, nunca de las líneas: con un
    descuento, lo cobrado no es lo que suman los productos.

    Las ventas de un día entran al libro como un solo ingreso en la fuente
    "Ventas", recalculado desde cero en cada escritura (services/business/sales.py).
    """
    __tablename__ = "sales"
    __table_args__ = (
        CheckConstraint("kind IN ('ticket', 'cierre')", name="ck_sales_kind"),
        Index("ix_sales_tenant_date", "tenant_id", "sale_date"),
        # Los dos dialectos: sin `sqlite_where` los tests crearían índices
        # completos y rechazarían dos tickets del mismo día.
        Index(
            "uq_sales_close_per_day", "tenant_id", "sale_date", unique=True,
            postgresql_where=text("kind = 'cierre'"), sqlite_where=text("kind = 'cierre'"),
        ),
        Index(
            "uq_sales_client_ref", "tenant_id", "client_ref", unique=True,
            postgresql_where=text("client_ref IS NOT NULL"), sqlite_where=text("client_ref IS NOT NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    sale_date: Mapped[date] = mapped_column(Date)
    kind: Mapped[str] = mapped_column(String(10), default=SALE_KIND_TICKET)
    total: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    source: Mapped[str] = mapped_column(String(20), default="app")
    client_ref: Mapped[str | None] = mapped_column(String(36), nullable=True)
    notes: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    # `selectin`: una venta casi nunca se lee sin su detalle, y una relación
    # perezosa leída al serializar es el MissingGreenlet de siempre.
    # `delete-orphan` y sin `passive_deletes`: los hijos los borra el ORM, igual
    # en Postgres que en el SQLite de los tests (que no aplica FKs). Al
    # reemplazarlos, el servicio vacía y hace flush ANTES de agregar los nuevos:
    # el flush inserta antes de borrar y chocaría con UNIQUE(sale_id, method).
    lines: Mapped[list["SaleLine"]] = relationship(
        order_by="SaleLine.position", lazy="selectin", cascade="all, delete-orphan"
    )
    payments: Mapped[list["SalePayment"]] = relationship(
        order_by="SalePayment.id", lazy="selectin", cascade="all, delete-orphan"
    )


class SaleLine(Base):
    """Qué se vendió: un producto del catálogo o un texto libre."""
    __tablename__ = "sale_lines"
    __table_args__ = (
        CheckConstraint("qty > 0", name="ck_sale_lines_qty"),
        CheckConstraint("product_id IS NOT NULL OR description IS NOT NULL", name="ck_sale_lines_what"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), index=True)
    product_id: Mapped[int | None] = mapped_column(
        ForeignKey("products.id", ondelete="RESTRICT"), nullable=True, index=True
    )
    description: Mapped[str | None] = mapped_column(String(120), nullable=True)
    qty: Mapped[Decimal] = mapped_column(Numeric(12, 3))
    unit_price: Mapped[Decimal | None] = mapped_column(Numeric(18, 2), nullable=True)
    position: Mapped[int] = mapped_column(Integer, default=0)


class SalePayment(Base):
    """Cómo se cobró. Una venta puede dividirse en varios medios."""
    __tablename__ = "sale_payments"
    __table_args__ = (
        UniqueConstraint("sale_id", "method", name="uq_sale_payments_method"),
        CheckConstraint("amount > 0", name="ck_sale_payments_amount"),
        CheckConstraint(
            "method IN ('efectivo', 'debito', 'credito', 'mercadopago', 'transferencia', 'otro')",
            name="ck_sale_payments_method",
        ),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    sale_id: Mapped[int] = mapped_column(ForeignKey("sales.id", ondelete="CASCADE"), index=True)
    method: Mapped[str] = mapped_column(String(20))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
