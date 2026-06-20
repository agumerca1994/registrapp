from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.contact import UserContact
from app.models.user import User
from app.schemas.shared_expense import ContactCreate, ContactOut

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
        select(UserContact)
        .where(UserContact.user_id == user.id)
        .order_by(UserContact.contact_name)
    )
    return result.all()


@router.post("", response_model=ContactOut, status_code=status.HTTP_201_CREATED)
async def add_contact(
    body: ContactCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    existing = await db.scalar(
        select(UserContact).where(
            UserContact.user_id == user.id,
            UserContact.contact_email == body.contact_email,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Ya tienes este contacto guardado")

    found_user = await db.scalar(
        select(User).where(User.email == body.contact_email)
    )

    contact = UserContact(
        user_id=user.id,
        contact_email=body.contact_email,
        contact_name=body.contact_name,
        contact_user_id=found_user.id if found_user else None,
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
        select(UserContact).where(
            UserContact.id == contact_id,
            UserContact.user_id == user.id,
        )
    )
    if not contact:
        raise HTTPException(status_code=404, detail="Contacto no encontrado")
    await db.delete(contact)
    await db.commit()