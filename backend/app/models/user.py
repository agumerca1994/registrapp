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
    # Nombre y apellido por separado, y `display_name` derivado de los dos.
    # Se guarda derivado en vez de componerlo al leer porque es la clave por la
    # que busca el directorio, la que agrupa `personKey()` y la que queda
    # escrita en cada split — recalcularla en cada lectura significaría que un
    # cambio de nombre reescribe la historia de gastos ya cerrados.
    first_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
    last_name: Mapped[str | None] = mapped_column(String(60), nullable=True)
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
    # Si querés que además del aviso en la app te llegue un WhatsApp. El push
    # del sistema es la base y no se apaga desde acá: es el canal que no
    # depende de tener un número vinculado ni de un proveedor externo.
    whatsapp_notifications: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true", default=True
    )

    tenant: Mapped["Tenant"] = relationship(back_populates="users")

    @property
    def tenant_code(self) -> str | None:
        return self.tenant.code if self.tenant else None

    @property
    def tenant_name(self) -> str | None:
        # Misma trampa que `tenant_code`: lee la relación, así que todo endpoint
        # que devuelva UserOut necesita `selectinload(User.tenant)` o revienta
        # con MissingGreenlet al serializar.
        return self.tenant.name if self.tenant else None
    income_entries: Mapped[list["IncomeEntry"]] = relationship(back_populates="user")
    expense_entries: Mapped[list["ExpenseEntry"]] = relationship(back_populates="user")
