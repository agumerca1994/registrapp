from datetime import date, datetime
from decimal import Decimal
from sqlalchemy import String, Date, DateTime, ForeignKey, Numeric, func, Boolean
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.core.database import Base


# De dónde vino un gasto. Hasta ahora la única pista era
# `payment_method == "tarjeta_credito"`, que es un hecho de *medio de pago*
# usado como hecho de *procedencia* — y encima ya gobierna comportamiento de UI
# (`/expenses` esconde editar/borrar leyendo ese campo). Con varios caminos de
# alta nuevos, "¿por qué hay dos gastos de $12.500 hoy?" se vuelve una pregunta
# sin respuesta, y no hay forma de medir si un canal se usa.
#
# La columna es nullable y NO se backfilleó: NULL significa "preexistente, no
# sabemos", que es honesto. Poner "manual" en todo afirmaría algo falso sobre
# las filas espejadas de tarjeta que ya estaban.
#
# Es VARCHAR y no un Enum de Postgres a propósito: el repo usa Enum sólo en
# UserRole; `kind`, `status`, `payment_method` y `op_type` son todos VARCHAR con
# la validación del lado de Python. Agregar un valor no debe costar una
# migración.
#
# Lo setea SIEMPRE el servidor, nunca el cliente: un campo de procedencia que el
# cliente elige no es procedencia.
EXPENSE_SOURCE_MANUAL = "manual"            # formulario de /expenses
EXPENSE_SOURCE_QUICK = "quick"              # pantalla /registrar
EXPENSE_SOURCE_SHARE_TARGET = "share_target"  # hoja de compartir de Android
EXPENSE_SOURCE_SHORTCUT = "shortcut"        # Atajo de iOS
EXPENSE_SOURCE_WHATSAPP = "whatsapp"        # bot de WhatsApp
EXPENSE_SOURCE_CREDIT_CARD = "credit_card"  # ítem de resumen de tarjeta
EXPENSE_SOURCE_SHARED_SPLIT = "shared_split"  # parte de un gasto compartido
EXPENSE_SOURCE_IMPORT = "import"            # scripts/import_<banco>_*.py
EXPENSE_SOURCE_MORTGAGE = "mortgage"        # cuota de hipoteca sincronizada

EXPENSE_SOURCES = frozenset({
    EXPENSE_SOURCE_MANUAL,
    EXPENSE_SOURCE_QUICK,
    EXPENSE_SOURCE_SHARE_TARGET,
    EXPENSE_SOURCE_SHORTCUT,
    EXPENSE_SOURCE_WHATSAPP,
    EXPENSE_SOURCE_CREDIT_CARD,
    EXPENSE_SOURCE_SHARED_SPLIT,
    EXPENSE_SOURCE_IMPORT,
    EXPENSE_SOURCE_MORTGAGE,
})

# Los canales por los que un humano carga un gasto de su bolsillo, en el momento.
# Es lo que /registrar acepta por querystring: el resto son procedencias que
# sólo puede afirmar el servidor.
EXPENSE_SOURCES_USER_ENTRY = frozenset({
    EXPENSE_SOURCE_QUICK,
    EXPENSE_SOURCE_SHARE_TARGET,
    EXPENSE_SOURCE_SHORTCUT,
})


class ExpenseCategory(Base):
    __tablename__ = "expense_categories"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    color: Mapped[str | None] = mapped_column(String(7))
    is_fixed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    tenant: Mapped["Tenant"] = relationship(back_populates="expense_categories")
    entries: Mapped[list["ExpenseEntry"]] = relationship(back_populates="category")


class ExpenseEntry(Base):
    __tablename__ = "expense_entries"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"))
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    description: Mapped[str | None] = mapped_column(String(255))
    expense_date: Mapped[date] = mapped_column(Date, index=True)
    notes: Mapped[str | None] = mapped_column(String(500))
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    entity: Mapped[str | None] = mapped_column(String(100), nullable=True)
    currency: Mapped[str] = mapped_column(String(3), default="ARS", server_default="ARS")
    source: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())

    category: Mapped["ExpenseCategory"] = relationship(back_populates="entries")
    user: Mapped["User"] = relationship(back_populates="expense_entries")
