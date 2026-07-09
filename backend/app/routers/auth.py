import logging
import random
import secrets
import string
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.shared_expense import SharedExpenseSplit
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.schemas.user import UserJoinTenant, UserOut, UserRegister

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)


def _generate_tenant_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choices(chars, k=8))


async def _link_pending_splits(user: User, db: AsyncSession) -> None:
    """Auto-link shared expense splits invited to this email when user registers."""
    splits = (await db.scalars(
        select(SharedExpenseSplit).where(
            SharedExpenseSplit.invite_email == user.email,
            SharedExpenseSplit.user_id.is_(None),
        )
    )).all()
    for split in splits:
        split.user_id = user.id
        split.member_name = user.display_name or user.email
        split.invite_token = None
        split.invite_expires_at = None


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
        member_count = await db.scalar(
            select(func.count()).select_from(User).where(User.tenant_id == existing.tenant_id)
        )
        if member_count > 1:
            raise HTTPException(status_code=400, detail="Ya sos parte de un hogar activo")
        new_t = Tenant(name=body.tenant_name, code=_generate_tenant_code())
        db.add(new_t)
        await db.flush()
        existing.tenant_id = new_t.id
        existing.role = UserRole.admin
        await db.commit()
        return await db.scalar(
            select(User).options(selectinload(User.tenant)).where(User.id == existing.id)
        )

    tenant = Tenant(name=body.tenant_name, code=_generate_tenant_code())
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
    await db.flush()
    await _link_pending_splits(user, db)
    await db.commit()
    await db.refresh(user)
    await db.refresh(tenant)
    user = await db.scalar(
        select(User).options(selectinload(User.tenant)).where(User.id == user.id)
    )
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
        member_count = await db.scalar(
            select(func.count()).select_from(User).where(User.tenant_id == existing.tenant_id)
        )
        if member_count > 1:
            raise HTTPException(status_code=400, detail="Ya sos parte de un hogar activo")

    tenant = await db.scalar(select(Tenant).where(Tenant.code == body.tenant_code.strip().upper()))
    if not tenant:
        raise HTTPException(status_code=404, detail="Codigo de hogar incorrecto")

    if existing:
        existing.tenant_id = tenant.id
        existing.role = UserRole.member
        await db.commit()
        return await db.scalar(
            select(User).options(selectinload(User.tenant)).where(User.id == existing.id)
        )

    user = User(
        firebase_uid=firebase_user["uid"],
        tenant_id=tenant.id,
        email=firebase_user.get("email", ""),
        display_name=body.display_name or firebase_user.get("name"),
        phone_number=body.phone_number,
        role=UserRole.member,
    )
    db.add(user)
    await db.flush()
    await _link_pending_splits(user, db)
    await db.commit()
    user = await db.scalar(
        select(User).options(selectinload(User.tenant)).where(User.id == user.id)
    )
    return user


@router.get("/me", response_model=UserOut)
async def me(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(
        select(User).options(selectinload(User.tenant)).where(User.firebase_uid == firebase_user["uid"])
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

    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        logger.error("Evolution API not configured")
        raise HTTPException(status_code=503, detail="WhatsApp no esta configurado en el servidor")

    from app.routers.shared_expenses import _resolve_whatsapp_jid

    url = f"{settings.EVOLUTION_API_URL}/message/sendText/{settings.EVOLUTION_INSTANCE}"
    headers = {"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resolved = await _resolve_whatsapp_jid(client, body.phone)
            target = resolved or body.phone.lstrip("+")
            payload = {
                "number": target,
                "text": (
                    "RegistrApp - Verificacion de WhatsApp\n\n"
                    f"Tu codigo de verificacion es: {code}\n"
                    "_Valido por 10 minutos._"
                ),
            }
            resp = await client.post(url, json=payload, headers=headers)
            if resp.status_code >= 400:
                raise HTTPException(status_code=502, detail=f"Error al enviar el codigo ({resp.status_code})")
    except httpx.RequestError as e:
        logger.error(f"Evolution API connection error: {e}")
        raise HTTPException(status_code=502, detail="No se pudo conectar con WhatsApp")

    return {"message": "Codigo enviado"}


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
        raise HTTPException(status_code=400, detail="Codigo incorrecto o expirado")

    user.whatsapp_phone = body.phone
    user.whatsapp_verify_code = None
    user.whatsapp_verify_expires = None
    await db.commit()
    user = await db.scalar(
        select(User).options(selectinload(User.tenant)).where(User.id == user.id)
    )

    if settings.EVOLUTION_API_URL and settings.EVOLUTION_INSTANCE:
        welcome = (
            "Bienvenido/a a RegistrApp!\n\n"
            "Tu WhatsApp quedo vinculado exitosamente.\n\n"
            "Como registrar un gasto:\n"
            "Envia un mensaje con el formato:\n"
            "monto categoria\n\n"
            "Ejemplos:\n"
            "15000 supermercado\n"
            "2500 nafta"
        )
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                await client.post(
                    f"{settings.EVOLUTION_API_URL}/message/sendText/{settings.EVOLUTION_INSTANCE}",
                    json={"number": body.phone, "text": welcome},
                    headers={"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"},
                )
        except Exception:
            pass

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
        select(User)
        .where(User.tenant_id == user.tenant_id)
        .options(selectinload(User.tenant))
        .order_by(User.created_at)
    )
    return result.all()

async def _move_to_new_solo_tenant(user: User, db: AsyncSession) -> None:
    new_tenant = Tenant(name="", code=_generate_tenant_code())
    db.add(new_tenant)
    await db.flush()
    user.tenant_id = new_tenant.id
    user.role = UserRole.admin


@router.delete("/members/{member_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_member(
    member_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user or user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Solo un admin puede eliminar miembros")
    if user.id == member_id:
        raise HTTPException(status_code=400, detail="No podes eliminarte a vos mismo desde aqui")
    target = await db.scalar(
        select(User).where(User.id == member_id, User.tenant_id == user.tenant_id)
    )
    if not target:
        raise HTTPException(status_code=404, detail="Miembro no encontrado")
    await _move_to_new_solo_tenant(target, db)
    await db.commit()


@router.post("/me/leave-household", status_code=status.HTTP_204_NO_CONTENT)
async def leave_household(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await db.scalar(
        select(User).where(User.firebase_uid == firebase_user["uid"])
    )
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.role == UserRole.admin:
        other = (await db.scalars(
            select(User)
            .where(User.tenant_id == user.tenant_id, User.id != user.id)
            .order_by(User.created_at)
        )).all()
        if other:
            other[0].role = UserRole.admin
    await _move_to_new_solo_tenant(user, db)
    await db.commit()
