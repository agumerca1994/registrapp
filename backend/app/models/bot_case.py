"""Lo que el bot no supo resolver por código, sin datos de nadie.

Una fila por forma de mensaje (letras → "a", dígitos → "9", salvo un vocabulario
de palabras que no identifican a nadie), con cuántas veces apareció. No tiene
usuario ni hogar a propósito: es lo que deja mirar, semanas después, qué conviene
pasar a código, cuando `wa_messages` ya se borró. Ver `services/bot_cases.py`.
"""
from datetime import datetime

from sqlalchemy import DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.reconciliation import JSONVariant


class BotCase(Base):
    __tablename__ = "bot_cases"

    id: Mapped[int] = mapped_column(primary_key=True)
    # text_ai | text_unresolved | undone | doc_ai | statement_ai
    kind: Mapped[str] = mapped_column(String(20), index=True)
    shape: Mapped[str] = mapped_column(String(1500))
    shape_hash: Mapped[str] = mapped_column(String(64), index=True)
    # Qué se hizo con eso: la acción y qué datos traía, nunca los valores.
    resolution: Mapped[dict | None] = mapped_column(JSONVariant, nullable=True)
    count: Mapped[int] = mapped_column(Integer, default=1, server_default="1")
    first_seen: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    last_seen: Mapped[datetime] = mapped_column(DateTime, server_default=func.now(), index=True)
