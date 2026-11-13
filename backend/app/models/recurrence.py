"""Gastos recurrentes: la serie (`recurrences`) y sus meses (`expense_entries`).

La serie guarda lo que se repite —descripción, categoría, moneda, el último
monto confirmado, el día del mes y si va en una tarjeta— y cada mes es un gasto
común con `recurrence_id` y `recurrence_status`:

- `confirmed`: la persona lo confirmó (o lo creó como recurrente).
- `pending`: lo generó la serie al confirmar el anterior. **Suma** igual que
  cualquier gasto —lo más probable es que la suscripción siga— y la pantalla lo
  muestra "a confirmar". No vence: pasada su fecha sigue ahí, con un aviso.

Sólo crear o confirmar genera el mes siguiente. Si un pendiente no se confirma,
no aparece el próximo y la cadena se corta: no se acumulan meses sin mirar.
La lógica es `services/recurrences.py`.
"""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import Date, DateTime, ForeignKey, Integer, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base

STATUS_ACTIVE = "active"
STATUS_ENDED = "ended"

ENTRY_PENDING = "pending"
ENTRY_CONFIRMED = "confirmed"


class Recurrence(Base):
    __tablename__ = "recurrences"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    # Quién la creó: los meses que genera quedan a su nombre ("quién lo cargó").
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    description: Mapped[str | None] = mapped_column(String(255))
    category_id: Mapped[int] = mapped_column(ForeignKey("expense_categories.id"))
    currency: Mapped[str] = mapped_column(String(3), default="ARS", server_default="ARS")
    # El último monto confirmado: el que copia el mes siguiente.
    amount: Mapped[Decimal] = mapped_column(Numeric(18, 2))
    # El día del mes del primero. Ancla la fecha para que 31/1 → 28/2 → 31/3
    # y no se vaya corriendo al 28.
    day: Mapped[int] = mapped_column(Integer)
    # Con tarjeta, cada mes es un ítem del resumen siguiente; sin tarjeta, un
    # gasto directo con este medio de pago.
    card_id: Mapped[int | None] = mapped_column(
        ForeignKey("credit_cards.id", ondelete="CASCADE"), nullable=True, index=True
    )
    payment_method: Mapped[str | None] = mapped_column(String(30), nullable=True)
    # Lo que imprimió el banco, para que la conciliación encuentre la serie
    # aunque cambie el monto.
    bank_description: Mapped[str | None] = mapped_column(String(255), nullable=True)
    status: Mapped[str] = mapped_column(String(10), default=STATUS_ACTIVE, server_default=STATUS_ACTIVE)
    ended_at: Mapped[date | None] = mapped_column(Date, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
