"""Memoria corta del chat de WhatsApp (7 días, después se purga).

Una fila por mensaje, entrante o saliente. No es un historial de conversación
para releer — es lo mínimo que hace funcionar cuatro gestos:

- *deshacer*: la última fila con `ref_type`/`ref_id` dice qué se creó;
- *editar monto 13000*: ídem, qué editar;
- responder citando: `wa_message_id` del mensaje citado → su entidad;
- contestar "1"/"2" a una pregunta: `pending` guarda la pregunta abierta.

`text` se trunca y nunca guarda media ni datos de cuenta. El job diario
`_daily_wa_purge` borra lo que tenga más de 7 días — la memoria es corta por
diseño (y, cuando exista la IA de respaldo, este mismo recorte es el contexto
acotado que recibiría, no el chat entero).
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.reconciliation import JSONVariant


class WaMessage(Base):
    __tablename__ = "wa_messages"
    # La unicidad por (user, id de WhatsApp) es la idempotencia del webhook:
    # Evolution reintenta y un reintento no puede crear el gasto dos veces.
    __table_args__ = (UniqueConstraint("user_id", "wa_message_id", name="uq_wa_message"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    direction: Mapped[str] = mapped_column(String(3))  # "in" | "out"
    wa_message_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    kind: Mapped[str] = mapped_column(String(10))  # text | pdf | image | audio | other
    text: Mapped[str | None] = mapped_column(String(500), nullable=True)
    # Qué produjo este mensaje: "expense" (gasto creado) o "reconcile" (sesión).
    ref_type: Mapped[str | None] = mapped_column(String(20), nullable=True)
    ref_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Pregunta abierta que espera respuesta ("1"/"2", nombre de categoría…).
    pending: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
