"""Lo que mandó por WhatsApp alguien que todavía no tiene cuenta.

El bot le contesta con un link para crearla (`services/wa_signup.py`). El link
lleva un token que prueba que esa persona tiene ese número —le llegó ahí—, así
que al canjearlo el número queda vinculado sin pedir el código, y los gastos
que había mandado se cargan solos. Sin esto, escribirle al bot sin cuenta era
un callejón: "este número no está vinculado" y el gasto se perdía.

Una fila por número. Dura 7 días, como la memoria del bot, y sólo guarda los
textos que parecen una carga (nunca media).
"""
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models.reconciliation import JSONVariant


class WaSignupIntent(Base):
    __tablename__ = "wa_signup_intents"

    id: Mapped[int] = mapped_column(primary_key=True)
    # "+" y los dígitos del JID de WhatsApp, que ya es la forma canónica del número.
    phone: Mapped[str] = mapped_column(String(32), unique=True)
    # Sólo el sha256, como los demás tokens.
    token_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    link_sent_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # [{"text": "...", "at": "iso"}], los últimos MAX_MESSAGES.
    messages: Mapped[list | None] = mapped_column(JSONVariant, nullable=True)
    claimed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    claimed_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
