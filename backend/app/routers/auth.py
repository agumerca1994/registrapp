import logging
import secrets
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.config import settings
from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.user import UserRegister, UserJoinTenant, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


class WhatsAppLinkRequest(BaseModel):
    phone: str


class WhatsAppVerifyRequest(BaseModel):
    phone: str
    code: str


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


@router.post("/me/link-whatsapp")
async def link_whatsapp(
    body: WhatsAppLinkRequest,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    code = f"{secrets.randbelow(1000000):06d}"
    user.whatsapp_verify_code = code
    user.whatsapp_verify_expires = datetime.utcnow() + timedelta(minutes=10)
    await db.commit()

    if settings.EVOLUTION_API_URL and settings.EVOLUTION_INSTANCE:
        url = f"{settings.EVOLUTION_API_URL}/message/sendText/{settings.EVOLUTION_INSTANCE}"
        headers = {"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"}
        payload = {"number": body.phone, "text": f"Tu código RegistrApp: *{code}*\n_(válido 10 minutos)_"}
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.post(url, json=payload, headers=headers)
                if resp.status_code >= 400:
                    logger.error(f"Evolution API error {resp.status_code}: {resp.text}")
                    raise HTTPException(status_code=502, detail="Error al enviar el código por WhatsApp")
        except httpx.RequestError as e:
            logger.error(f"Evolution API connection error: {e}")
            raise HTTPException(status_code=502, detail="No se pudo conectar con WhatsApp")

    return {"message": "Código enviado"}


@router.post("/me/verify-whatsapp", response_model=UserOut)
async def verify_whatsapp(
    body: WhatsAppVerifyRequest,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    if (
        not user.whatsapp_verify_code
        or user.whatsapp_verify_code != body.code
        or not user.whatsapp_verify_expires
        or user.whatsapp_verify_expires < datetime.utcnow()
    ):
        raise HTTPException(status_code=400, detail="Código incorrecto o expirado")

    user.whatsapp_phone = body.phone
    user.whatsapp_verify_code = None
    user.whatsapp_verify_expires = None
    await db.commit()
    await db.refresh(user)
    return user


@router.delete("/me/whatsapp", status_code=204)
async def unlink_whatsapp(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.whatsapp_phone = None
    user.whatsapp_verify_code = None
    user.whatsapp_verify_expires = None
    await db.commit()


@router.get("/members", response_model=list[UserOut])
async def list_members(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    result = await db.scalars(
        select(User).where(User.tenant_id == user.tenant_id).order_by(User.created_at)
    )
    return result.all()
