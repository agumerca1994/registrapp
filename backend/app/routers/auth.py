import logging
import secrets
import string
from datetime import datetime, timedelta

import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.database import get_db
from app.core.firebase import get_current_user
from app.services import contacts as contacts_service
from app.services import user_directory
from app.models.credit_card import CreditCard
from app.models.currency_operation import CurrencyOperation
from app.models.expense import ExpenseEntry
from app.models.income import IncomeEntry
from app.models.mortgage import MortgageRecord
from app.models.payment_reminder import PaymentReminder
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.routers.shared_expenses import _normalize_phone
from app.schemas.user import UserJoinTenant, UserOut, UserRegister

router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)

MAX_WHATSAPP_VERIFY_ATTEMPTS = 5


def _generate_tenant_code() -> str:
    # `secrets`, no `random`: este código es una credencial al portador sin
    # segundo factor — `POST /auth/join` con el código da acceso completo al
    # historial financiero del hogar. El Mersenne Twister de `random` es
    # determinista y su estado se reconstruye observando salidas suficientes,
    # así que códigos emitidos cerca en la secuencia se vuelven predecibles.
    chars = string.ascii_uppercase + string.digits
    return "".join(secrets.choice(chars) for _ in range(8))


# Tables that hold what a household would actually lose by being abandoned.
# Not exhaustive on purpose — categories and sources get auto-created and would
# make an untouched household look occupied.
_TENANT_DATA_MODELS = (
    IncomeEntry, ExpenseEntry, CurrencyOperation, CreditCard, MortgageRecord,
    SharedExpense, PaymentReminder,
)


async def _tenant_has_data(db: AsyncSession, tenant_id: int) -> bool:
    """Whether abandoning this tenant would strand anything the user loaded."""
    for model in _TENANT_DATA_MODELS:
        found = await db.scalar(
            select(model.id).where(model.tenant_id == tenant_id).limit(1)
        )
        if found is not None:
            return True
    return False


async def _assert_can_leave_current_tenant(user: User, db: AsyncSession) -> None:
    """Guard for the branch of register/join that re-tenants an existing user.

    That branch exists for the user who left a household (or was removed) and
    is parked in the empty tenant `_move_to_new_solo_tenant` gave them. It used
    to be gated on member count alone, which let a *solo* user with a fully
    loaded household create or join another one: the row moves, the old tenant
    stays behind with every income, expense and card in it, and nothing about
    the request looks like data loss. Being alone in a household is not the
    same as not having one — what makes it safe to walk away is that there's
    nothing to leave behind.
    """
    member_count = await db.scalar(
        select(func.count()).select_from(User).where(User.tenant_id == user.tenant_id)
    )
    if member_count > 1:
        raise HTTPException(status_code=400, detail="Ya sos parte de un hogar activo")
    if await _tenant_has_data(db, user.tenant_id):
        raise HTTPException(
            status_code=400,
            detail="Ya tenés un hogar con datos cargados. Si querés cambiar de hogar, "
                   "salí del actual desde Configuración.",
        )


async def _link_pending_splits(user: User, db: AsyncSession) -> None:
    """Auto-link shared expense splits invited to this email when user registers."""
    # `func.lower` en los dos lados: `_find_user_by_email` normaliza y esto no,
    # así que alguien invitado a "Juan.Perez@Gmail.com" que entra como
    # "juan.perez@gmail.com" no se vinculaba nunca — y el fallo es silencioso,
    # simplemente el gasto no aparece.
    #
    # Deliberadamente no matchea por teléfono: al registrarse el número todavía
    # no está verificado. Ese caso lo cubre la cláusula 3 de `_load_q` una vez
    # que lo verifica.
    splits = (await db.scalars(
        select(SharedExpenseSplit).where(
            func.lower(SharedExpenseSplit.invite_email) == (user.email or "").strip().lower(),
            SharedExpenseSplit.user_id.is_(None),
        )
    )).all()
    for split in splits:
        split.user_id = user.id
        split.member_name = user.display_name or user.email
        split.invite_token = None
        split.invite_expires_at = None
    # Idem: los contactos que lo tenían por mail pasan a estar linkeados.
    await contacts_service.link_contact_to_user(db, user=user)


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
        await _assert_can_leave_current_tenant(existing, db)
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
        first_name=(body.first_name or "").strip() or None,
        last_name=(body.last_name or "").strip() or None,
        display_name=compose_display_name(
            body.first_name, body.last_name,
            body.display_name or firebase_user.get("name"),
        ),
        phone_number=body.phone_number,
        role=UserRole.admin,
        whatsapp_gate_pending=True,
    )
    if body.alias:
        try:
            alias = user_directory.validate_alias(body.alias)
        except user_directory.AliasError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if await user_directory.alias_taken(db, alias):
            raise HTTPException(status_code=409, detail="Ese alias ya está en uso.")
        user.alias = alias

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
        await _assert_can_leave_current_tenant(existing, db)

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
        first_name=(body.first_name or "").strip() or None,
        last_name=(body.last_name or "").strip() or None,
        display_name=compose_display_name(
            body.first_name, body.last_name,
            body.display_name or firebase_user.get("name"),
        ),
        phone_number=body.phone_number,
        role=UserRole.member,
        whatsapp_gate_pending=True,
    )
    if body.alias:
        try:
            alias = user_directory.validate_alias(body.alias)
        except user_directory.AliasError as e:
            raise HTTPException(status_code=400, detail=str(e))
        if await user_directory.alias_taken(db, alias):
            raise HTTPException(status_code=409, detail="Ese alias ya está en uso.")
        user.alias = alias

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


def compose_display_name(first: str | None, last: str | None, fallback: str | None = None) -> str | None:
    """`display_name` a partir de nombre y apellido.

    Se guarda derivado y no se compone al leer: es la clave por la que busca el
    directorio, la que agrupa `personKey()` y la que quedó escrita en los splits
    ya creados.
    """
    full = " ".join(x.strip() for x in (first, last) if x and x.strip())
    return full or (fallback.strip() if fallback and fallback.strip() else None)


class ProfileUpdate(BaseModel):
    first_name: str | None = Field(default=None, max_length=60)
    last_name: str | None = Field(default=None, max_length=60)
    display_name: str | None = Field(default=None, max_length=120)
    alias: str | None = Field(default=None, max_length=30)
    discoverable: bool | None = None
    whatsapp_notifications: bool | None = None


@router.patch("/me", response_model=UserOut)
async def update_me(
    body: ProfileUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Editar el propio perfil: nombre, alias y visibilidad.

    Hasta ahora no había ninguna forma de cambiarse el nombre.

    `alias=""` lo borra (volvés a no tener). Un alias tomado devuelve **409**,
    no 400: para el frontend "inválido" y "ya está en uso" son dos mensajes
    distintos y sólo el segundo se arregla probando otro.
    """
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")

    fields = body.model_dump(exclude_unset=True)

    if "first_name" in fields or "last_name" in fields:
        first = fields.get("first_name", user.first_name)
        last = fields.get("last_name", user.last_name)
        if not (first or "").strip():
            raise HTTPException(status_code=400, detail="El nombre no puede quedar vacío.")
        user.first_name = (first or "").strip() or None
        user.last_name = (last or "").strip() or None
        user.display_name = compose_display_name(user.first_name, user.last_name)
    elif "display_name" in fields:
        # Sigue aceptándose suelto por si algún cliente viejo lo manda así.
        name = (fields["display_name"] or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="El nombre no puede quedar vacío.")
        user.display_name = name

    if "alias" in fields:
        raw = (fields["alias"] or "").strip()
        if not raw:
            user.alias = None
        else:
            try:
                alias = user_directory.validate_alias(raw)
            except user_directory.AliasError as e:
                raise HTTPException(status_code=400, detail=str(e))
            if await user_directory.alias_taken(db, alias, exclude_user_id=user.id):
                raise HTTPException(status_code=409, detail="Ese alias ya está en uso.")
            user.alias = alias

    if "discoverable" in fields and fields["discoverable"] is not None:
        user.discoverable = fields["discoverable"]

    if "whatsapp_notifications" in fields and fields["whatsapp_notifications"] is not None:
        user.whatsapp_notifications = fields["whatsapp_notifications"]

    await db.commit()
    # Re-seleccionar con selectinload: `UserOut.tenant_code` lee la relación, y
    # sin esto revienta con MissingGreenlet al serializar.
    return await db.scalar(
        select(User).options(selectinload(User.tenant)).where(User.id == user.id)
    )


class TenantUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=120)


@router.patch("/tenant", response_model=UserOut)
async def rename_tenant(
    body: TenantUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Renombrar el hogar. Sólo un admin.

    Devuelve `UserOut` y no el tenant porque es lo que el frontend ya tiene en
    contexto: así refresca todo con la respuesta, sin un segundo pedido.
    """
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    if user.role != UserRole.admin:
        raise HTTPException(status_code=403, detail="Sólo un administrador puede renombrar el hogar.")
    tenant = await db.get(Tenant, user.tenant_id)
    if not tenant:
        raise HTTPException(status_code=404, detail="Hogar no encontrado")
    tenant.name = body.name.strip()
    await db.commit()
    return await db.scalar(
        select(User).options(selectinload(User.tenant)).where(User.id == user.id)
    )


@router.get("/alias-available")
async def alias_available(
    alias: str,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Para que el formulario avise antes de guardar."""
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    try:
        normalized = user_directory.validate_alias(alias)
    except user_directory.AliasError as e:
        return {"available": False, "reason": str(e)}
    taken = await user_directory.alias_taken(
        db, normalized, exclude_user_id=user.id if user else None
    )
    return {
        "available": not taken,
        "reason": "Ese alias ya está en uso." if taken else None,
        "alias": normalized,
    }


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
    # Guardar a qué teléfono se mandó el código. Sin esto `verify_whatsapp`
    # aceptaba cualquier número que le pasaran junto al código: pedías el código
    # a tu propio número y verificabas con el de otra persona, quedándote con su
    # `whatsapp_phone` — que es clave de autorización para las invitaciones de
    # gastos compartidos y para resolver el webhook entrante.
    user.whatsapp_pending_phone = _normalize_phone(body.phone)
    user.whatsapp_verify_attempts = 0
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

    # `body.phone` se ignora a propósito: el número que vale es el que
    # `link_whatsapp` guardó cuando mandó el código. El campo se sigue aceptando
    # para no romper al frontend, que lo manda.
    if (
        not user.whatsapp_verify_code
        or not user.whatsapp_pending_phone
        or not user.whatsapp_verify_expires
        or user.whatsapp_verify_expires < datetime.utcnow()
    ):
        raise HTTPException(status_code=400, detail="Codigo incorrecto o expirado")

    # Sin contador de intentos, 6 dígitos con 10 minutos de validez se agotan por
    # fuerza bruta bien dentro de la ventana.
    if user.whatsapp_verify_attempts >= MAX_WHATSAPP_VERIFY_ATTEMPTS:
        user.whatsapp_verify_code = None
        user.whatsapp_pending_phone = None
        await db.commit()
        raise HTTPException(status_code=429, detail="Demasiados intentos, pedí un código nuevo")

    if not secrets.compare_digest(user.whatsapp_verify_code, body.code):
        user.whatsapp_verify_attempts += 1
        await db.commit()
        raise HTTPException(status_code=400, detail="Codigo incorrecto o expirado")

    user.whatsapp_phone = user.whatsapp_pending_phone
    user.whatsapp_pending_phone = None
    user.whatsapp_verify_code = None
    user.whatsapp_verify_expires = None
    user.whatsapp_verify_attempts = 0
    user.whatsapp_gate_pending = False
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


@router.post("/me/skip-whatsapp-gate", response_model=UserOut)
async def skip_whatsapp_gate(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Escape hatch for the mandatory onboarding WhatsApp gate: lets a new
    user into the app without verifying (e.g. Evolution API is down, or the
    OTP never arrived). They can still link/verify later from Configuracion,
    which is unaffected by this — it does not touch whatsapp_phone.
    """
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    user.whatsapp_gate_pending = False
    await db.commit()
    return await db.scalar(
        select(User).options(selectinload(User.tenant)).where(User.id == user.id)
    )


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
