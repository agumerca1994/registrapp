"""La agenda del hogar: con quién solés compartir gastos."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.contact import SharedContact
from app.models.user import User
from app.schemas.contact import ContactCreate, ContactOut, ContactUpdate
from app.services import contacts as contacts_service
from app.services.participants import normalize_phone

router = APIRouter(prefix="/contacts", tags=["contacts"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


async def _owned(contact_id: int, user: User, db: AsyncSession) -> SharedContact:
    row = await db.scalar(
        select(SharedContact).where(
            SharedContact.id == contact_id,
            SharedContact.tenant_id == user.tenant_id,
        )
    )
    if not row:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    return row


@router.get("", response_model=list[ContactOut])
async def list_contacts(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """La agenda, los más usados primero.

    Ese orden es el que hace útil el estado inicial del selector: lo primero
    que ve alguien al ir a compartir es la gente con la que ya comparte.
    """
    user = await _get_db_user(firebase_user, db)
    rows = await db.scalars(
        select(SharedContact)
        .where(SharedContact.tenant_id == user.tenant_id)
        .order_by(
            SharedContact.use_count.desc(),
            SharedContact.last_used_at.desc().nullslast(),
            SharedContact.display_name,
        )
    )
    return rows.all()


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def add_contact(
    body: ContactCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    if not body.display_name.strip():
        raise HTTPException(status_code=400, detail="El contacto necesita un nombre.")
    phone = normalize_phone(body.contact_phone) if body.contact_phone else None
    row = await contacts_service.upsert_contact(
        db,
        tenant_id=user.tenant_id,
        display_name=body.display_name.strip(),
        phone=phone,
        email=body.contact_email,
        # Agregarlo a mano no es usarlo: no debe saltar al tope de "Frecuentes".
        touch=False,
    )
    if row is None:
        raise HTTPException(status_code=400, detail="Poné un mail o un teléfono.")
    await db.commit()
    await db.refresh(row)
    return row


@router.patch("/{contact_id}", response_model=ContactOut)
async def update_contact(
    contact_id: int,
    body: ContactUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    row = await _owned(contact_id, user, db)
    fields = body.model_dump(exclude_unset=True)
    if "display_name" in fields:
        name = (fields["display_name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="El contacto necesita un nombre.")
        row.display_name = name
    if "contact_email" in fields:
        row.contact_email = (fields["contact_email"] or "").strip().lower() or None
    if "contact_phone" in fields:
        row.contact_phone = normalize_phone(fields["contact_phone"]) if fields["contact_phone"] else None
    # `person_key` NO se recalcula: es la identidad con la que ya se agruparon
    # gastos existentes, y cambiarla los partiría en dos personas.
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    row = await _owned(contact_id, user, db)
    await db.delete(row)
    await db.commit()
