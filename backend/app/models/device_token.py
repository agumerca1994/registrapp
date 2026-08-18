from datetime import datetime
from sqlalchemy import String, DateTime, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class DeviceToken(Base):
    """Un token de FCM: una instalación del navegador/PWA de un usuario.

    Es por dispositivo y no por usuario: la misma persona entra desde el
    iPhone instalado en la pantalla de inicio y desde Chrome en la compu, y
    cada uno tiene su token. Notificar significa mandarle a todos los tokens
    vivos de esa persona.

    `token` es único a nivel global, no por usuario, y eso es a propósito: si
    dos personas se loguean en el mismo navegador, FCM les da el mismo token, y
    el que se registra último es el dueño. Dejarlo repetido mandaría el aviso de
    una a la pantalla de la otra.
    """

    __tablename__ = "device_tokens"

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token: Mapped[str] = mapped_column(String(512), unique=True, index=True)
    # Sólo para poder mirar desde dónde entra la gente cuando algo no llega;
    # nada de la lógica depende de esto.
    platform: Mapped[str | None] = mapped_column(String(40), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    # Lo refresca cada alta: FCM rota tokens y los deja de entregar sin avisar,
    # así que esta fecha es lo que permite distinguir un dispositivo vivo de uno
    # que no vuelve desde hace meses.
    last_seen_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
