from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.contact import TenantContact
from app.models.user import User
from app.schemas.contact import ContactCreate, ContactOut
from app.routers.shared_expenses import _normalize_phone

router = APIRouter(prefix="/contacts", tags=["contacts"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


@router.get("", response_model=list[ContactOut])
async def list_contacts(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(TenantContact)
        .where(TenantContact.tenant_id == user.tenant_id)
        .order_by(TenantContact.contact_name)
    )
    return result.all()


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def add_contact(
    body: ContactCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    normalized_phone = _normalize_phone(body.contact_phone)

    existing = await db.scalar(
        select(TenantContact).where(
            TenantContact.tenant_id == user.tenant_id,
            TenantContact.contact_phone == normalized_phone,
        )
    )
    if existing:
        return existing

    contact = TenantContact(
        tenant_id=user.tenant_id,
        contact_name=body.contact_name,
        contact_phone=normalized_phone,
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return contact


@router.delete("/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_contact(
    contact_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    contact = await db.scalar(
        select(TenantContact).where(
            TenantContact.id == contact_id,
            TenantContact.tenant_id == user.tenant_id,
        )
    )
    if not contact:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    await db.delete(contact)
    await db.commit()