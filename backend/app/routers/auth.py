from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.user import UserRegister, UserJoinTenant, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def register(
    body: UserRegister,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.scalar(
        select(User).where(User.firebase_uid == firebase_user["uid"])
    )
    if existing:
        raise HTTPException(status_code=400, detail="Usuario ya registrado")

    tenant = Tenant(name=body.tenant_name)
    db.add(tenant)
    await db.flush()

    user = User(
        firebase_uid=firebase_user["uid"],
        tenant_id=tenant.id,
        email=firebase_user.get("email", ""),
        display_name=body.display_name or firebase_user.get("name"),
        phone_number=body.phone_number,
        role=UserRole.admin,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.post("/join", response_model=UserOut, status_code=status.HTTP_201_CREATED)
async def join_tenant(
    body: UserJoinTenant,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    existing = await db.scalar(
        select(User).where(User.firebase_uid == firebase_user["uid"])
    )
    if existing:
        raise HTTPException(status_code=400, detail="Usuario ya registrado")

    tenant = await db.get(Tenant, body.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant no encontrado")

    user = User(
        firebase_uid=firebase_user["uid"],
        tenant_id=body.tenant_id,
        email=firebase_user.get("email", ""),
        display_name=body.display_name or firebase_user.get("name"),
        phone_number=body.phone_number,
        role=UserRole.member,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


@router.get("/me", response_model=UserOut)
async def me(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(
        select(User).where(User.firebase_uid == firebase_user["uid"])
    )
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado. Registrate primero.")
    return user
