"""La agenda del hogar: con quién solés compartir gastos.

Dos cosas que este módulo centraliza y que antes estaban repartidas:

- **`person_key`**, la regla de identidad de una persona. Es el gemelo backend
  de `personKey()` en `frontend/app/(app)/shared/page.tsx`, con la misma
  precedencia. Que exista de los dos lados no es duplicación: el frontend
  agrupa splits ya cargados y el backend tiene que poder *guardarla* para que
  la restricción única de la tabla exprese esa misma regla.
- **El alta**, que ahora corre también para los contactos por mail. Antes sólo
  la rama de teléfono guardaba agenda, y ése es el único motivo de que
  "Elegir de la agenda" nunca haya mostrado un contacto de mail.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.contact import SharedContact
from app.models.user import User
from app.services.search import fold_text


def person_key(
    *,
    user_id: int | None = None,
    phone: str | None = None,
    email: str | None = None,
    name: str | None = None,
) -> str:
    """Cómo se identifica a una persona, en orden de confianza.

    `u:` primero es lo que evita que alguien se duplique el día que se
    registra: la fila que existía por teléfono se promueve, no se clona.
    """
    if user_id is not None:
        return f"u:{user_id}"
    if phone:
        return f"p:{phone}"
    if email:
        return f"e:{email.strip().lower()}"
    return f"n:{fold_text(name or '')}"


async def upsert_contact(
    db: AsyncSession,
    *,
    tenant_id: int,
    display_name: str,
    user_id: int | None = None,
    phone: str | None = None,
    email: str | None = None,
    touch: bool = True,
) -> SharedContact | None:
    """Guarda (o refresca) un contacto del hogar.

    Devuelve `None` cuando no hay nada que guardar — un externo sin ningún dato
    no es un contacto, es un nombre suelto de un gasto puntual.
    """
    if user_id is None and not phone and not email:
        return None

    key = person_key(user_id=user_id, phone=phone, email=email, name=display_name)
    row = await db.scalar(
        select(SharedContact).where(
            SharedContact.tenant_id == tenant_id,
            SharedContact.person_key == key,
        )
    )
    if row is None:
        row = SharedContact(
            tenant_id=tenant_id,
            contact_user_id=user_id,
            display_name=display_name,
            contact_email=(email or "").strip().lower() or None,
            contact_phone=phone,
            person_key=key,
        )
        db.add(row)
    else:
        # No se pisa el nombre: si alguien ya lo guardó como "Martín del padel",
        # que un gasto nuevo lo escriba distinto no tiene por qué renombrarlo.
        row.contact_email = row.contact_email or ((email or "").strip().lower() or None)
        row.contact_phone = row.contact_phone or phone
        if user_id is not None:
            row.contact_user_id = user_id

    if touch:
        row.use_count = (row.use_count or 0) + 1
        row.last_used_at = func.now()
    await db.flush()
    return row


async def link_contact_to_user(db: AsyncSession, *, user: User) -> int:
    """Promueve a `u:` los contactos que resultaron ser este usuario.

    Se llama cuando alguien reclama una invitación o se registra: la fila que
    lo tenía por teléfono o mail pasa a estar linkeada a su cuenta. Si ya
    existía una fila `u:` para él, se fusionan — gana el `use_count` más alto y
    la otra se borra, porque dos filas para la misma persona rompen tanto el
    "Frecuentes" como la agrupación de `/shared`.
    """
    candidates: list[str] = []
    if user.whatsapp_phone:
        candidates.append(person_key(phone=user.whatsapp_phone))
    if user.email:
        candidates.append(person_key(email=user.email))
    if not candidates:
        return 0

    rows = list((await db.scalars(
        select(SharedContact).where(SharedContact.person_key.in_(candidates))
    )).all())
    promoted = 0
    for row in rows:
        target_key = person_key(user_id=user.id)
        existing = await db.scalar(
            select(SharedContact).where(
                SharedContact.tenant_id == row.tenant_id,
                SharedContact.person_key == target_key,
            )
        )
        if existing and existing.id != row.id:
            existing.use_count = max(existing.use_count or 0, row.use_count or 0)
            existing.contact_email = existing.contact_email or row.contact_email
            existing.contact_phone = existing.contact_phone or row.contact_phone
            await db.delete(row)
        else:
            row.contact_user_id = user.id
            row.person_key = target_key
        promoted += 1
    await db.flush()
    return promoted
