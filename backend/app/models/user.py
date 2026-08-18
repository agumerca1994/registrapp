from datetime import datetime
from sqlalchemy import Boolean, String, DateTime, ForeignKey, Integer, func, Enum
from sqlalchemy.orm import Mapped, mapped_column, relationship
import enum
from app.core.database import Base



class UserRole(str, enum.Enum):
    admin = "admin"
    member = "member"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    firebase_uid: Mapped[str] = mapped_column(String(128), unique=True, index=True)
    tenant_id: Mapped[int] = mapped_column(ForeignKey("tenants.id"), index=True)
    email: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str | None] = mapped_column(String(120))
    phone_number: Mapped[str | None] = mapped_column(String(30))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.member)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
    whatsapp_phone: Mapped[str | None] = mapped_column(String(20), nullable=True, unique=True, index=True)
    whatsapp_verify_code: Mapped[str | None] = mapped_column(String(6), nullable=True)
    whatsapp_verify_expires: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # A qué número se mandó el código. `verify_whatsapp` copia de acá a
    # `whatsapp_phone` en vez de confiar en el número que manda el cliente —
    # sin esto el código verificaba cualquier teléfono. No es unique: dos
    # personas pueden tener una verificación en vuelo contra el mismo número,
    # y el unique de `whatsapp_phone` es el que decide quién se lo queda.
    whatsapp_pending_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    whatsapp_verify_attempts: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    whatsapp_gate_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="false", default=False)
    # El equivalente al alias de una transferencia bancaria: un identificador
    # corto que se puede decir en voz alta o pegar en un chat, para que te
    # compartan un gasto sin tener que saber tu mail ni tu teléfono.
    #
    # Se guarda SIEMPRE en minúscula (ver services/user_directory.validate_alias),
    # así el índice único y la búsqueda son comparaciones directas. Eso esquiva
    # la clase de bug de mayúsculas que ya costó cara acá: `_find_user_by_email`
    # normalizaba y `_link_pending_splits` no, y los invitados con mayúsculas en
    # el mail no se vinculaban nunca.
    alias: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True, index=True)
    # Si aparece o no en la búsqueda por nombre. NO afecta la búsqueda exacta
    # por alias, mail o teléfono: apagarlo ahí rompería en silencio que te
    # compartan gastos, que es el fallo más caro de este dominio.
    discoverable: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true", default=True)

    tenant: Mapped["Tenant"] = relationship(back_populates="users")

    @property
    def tenant_code(self) -> str | None:
        return self.tenant.code if self.tenant else None
    income_entries: Mapped[list["IncomeEntry"]] = relationship(back_populates="user")
    expense_entries: Mapped[list["ExpenseEntry"]] = relationship(back_populates="user")
