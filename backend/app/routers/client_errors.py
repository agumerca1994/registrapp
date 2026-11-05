"""Lo que falla en el navegador, en los mismos logs que el backend.

Sin esto, un error de pantalla sólo quedaba en la consola de quien lo sufría: la
guía de Egresos rompía la pantalla entera y los logs daban cero.

Pide sesión a propósito: una ruta anónima que escribe en la base es una invitación
a llenarla. Lo que pasa antes de entrar no se reporta.
"""

from fastapi import APIRouter, Depends, Response, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.app_log import AppLog
from app.models.user import User
from app.services import rate_limit

router = APIRouter(tags=["client-errors"])

# Un error en un bucle no puede llenar la tabla.
PER_USER_PER_HOUR = 30


class ClientErrorIn(BaseModel):
    message: str = Field(min_length=1, max_length=2000)
    stack: str | None = Field(default=None, max_length=8000)
    path: str = Field(default="", max_length=500)
    host: str | None = Field(default=None, max_length=120)


def build_log(body: ClientErrorIn, user_id: int | None, tenant_id: int | None) -> AppLog:
    """Sólo la ruta, nunca el query: ahí viajan los tokens de los links del bot."""
    return AppLog(
        level="ERROR",
        logger_name="frontend",
        module="browser",
        message=body.message,
        traceback=body.stack,
        request_path=body.path.split("?")[0].split("#")[0] or None,
        user_id=user_id,
        tenant_id=tenant_id,
        extra={"host": body.host} if body.host else None,
    )


@router.post("/client-errors", status_code=status.HTTP_204_NO_CONTENT)
async def report_client_error(
    body: ClientErrorIn,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Response:
    """Pasado el tope se descarta sin avisar: reportar un error no puede dar otro."""
    if rate_limit.check(f"client_errors:{firebase_user['uid']}", PER_USER_PER_HOUR, 3600):
        user = (await db.execute(
            select(User.id, User.tenant_id).where(User.firebase_uid == firebase_user["uid"])
        )).first()
        db.add(build_log(body, user.id if user else None, user.tenant_id if user else None))
        await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
