from datetime import datetime
from sqlalchemy import Integer, String, DateTime, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column
from app.core.database import Base


class TenantContact(Base):
    __tablename__ = "tenant_contacts"
    __table_args__ = (UniqueConstraint("tenant_id", "contact_phone"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    contact_name: Mapped[str] = mapped_column(String(120))
    contact_phone: Mapped[str] = mapped_column(String(20))
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())


class SharedContact(Base):
    """Con quién solés compartir gastos.

    Reemplaza a `TenantContact`, que no podía crecer: `contact_phone` era NOT
    NULL *y* mitad de la clave única, así que un contacto sólo-mail, o un
    usuario registrado del que no guardás teléfono, no tenían dónde ir.

    Sigue siendo **por hogar** y no por usuario, como todo lo tipo agenda en
    esta app (recordatorios, tarjetas, categorías): `/shared` ya muestra todo a
    nivel hogar, y una agenda por persona haría que dos convivientes no vean
    los mismos contactos frecuentes. Lo "de usuario a usuario" va en las filas
    (`contact_user_id`), no en la propiedad de la tabla.
    """

    __tablename__ = "shared_contacts"
    __table_args__ = (UniqueConstraint("tenant_id", "person_key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    tenant_id: Mapped[int] = mapped_column(
        ForeignKey("tenants.id", ondelete="CASCADE"), index=True
    )
    # Se llena cuando el contacto resulta ser un usuario de la app.
    contact_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    display_name: Mapped[str] = mapped_column(String(120))
    contact_email: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # El gemelo backend de `personKey()` del frontend, con la misma precedencia:
    # u: -> p: -> e: -> n:. Se GUARDA (en vez de calcularse al leer) para que la
    # restricción única exprese la regla de identidad real de la app y una fila
    # de agenda coincida con la clave de agrupación de un split sin un join.
    #
    # Que `u:` gane es lo que evita que una persona se convierta en dos filas el
    # día que se registra.
    person_key: Mapped[str] = mapped_column(String(160))
    # Alimentan el orden de "Frecuentes". Se guardan en vez de derivarse
    # contando splits: eso sería un join sobre todos los gastos compartidos
    # cada vez que se abre el selector.
    use_count: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0", default=0)
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, server_default=func.now())
