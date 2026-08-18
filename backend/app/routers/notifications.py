"""Alta y baja de dispositivos para notificaciones push."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.device_token import DeviceToken
from app.models.user import User
from app.services import push

router = APIRouter(prefix="/notifications", tags=["notifications"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    return user


class DeviceTokenIn(BaseModel):
    token: str = Field(min_length=10, max_length=512)
    platform: str | None = Field(default=None, max_length=40)


class DeviceTokenOut(BaseModel):
    registered: bool


@router.post("/device-tokens", response_model=DeviceTokenOut, status_code=status.HTTP_201_CREATED)
async def register_device(
    body: DeviceTokenIn,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Registra (o refresca) este dispositivo para recibir avisos.

    El frontend la llama en cada arranque con permiso concedido, no una sola
    vez: FCM rota el token cuando quiere, y el registro tiene que seguirlo.
    """
    user = await _get_db_user(firebase_user, db)
    await push.register_token(
        db,
        user_id=user.id,
        tenant_id=user.tenant_id,
        token=body.token,
        platform=body.platform,
    )
    return DeviceTokenOut(registered=True)


class DeviceCountOut(BaseModel):
    count: int


@router.get("/device-tokens/me", response_model=DeviceCountOut)
async def my_device_count(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Cuántos dispositivos tiene registrados este usuario.

    Existe porque el frontend no puede contestarlo solo: guardaba el token en
    `localStorage`, así que en un segundo navegador concluía "este dispositivo
    no quedó registrado" aunque lo estuviera. Un dato local no puede responder
    una pregunta sobre el servidor.
    """
    user = await _get_db_user(firebase_user, db)
    count = await db.scalar(
        select(func.count()).select_from(DeviceToken).where(DeviceToken.user_id == user.id)
    )
    return DeviceCountOut(count=count or 0)


@router.delete("/device-tokens", status_code=status.HTTP_204_NO_CONTENT)
async def unregister_device(
    body: DeviceTokenIn,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Da de baja este dispositivo. La llama el logout.

    No comprueba que el token sea del usuario que pide la baja, y está bien:
    el token identifica un navegador, no una cuenta. Quien está sentado frente
    a ese navegador puede dejar de recibir avisos ahí, y no poder hacerlo sería
    peor que el riesgo de que alguien borre un registro que igual va a volver
    en el próximo arranque de su dueño.
    """
    await _get_db_user(firebase_user, db)
    await push.unregister_token(db, body.token)
