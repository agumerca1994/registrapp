"""Leer un comprobante y proponer un gasto. No crea nada.

Este router es el único consumidor HTTP de `services/receipts`, y hereda sus
dos invariantes: **no escribe** y **siempre contesta 200**. Si el comprobante
es ilegible, la respuesta es un borrador vacío con un aviso legible — la
pantalla abre el formulario igual, en blanco, que es lo que la persona necesita
para no quedarse sin poder cargar el gasto.
"""
import logging

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.services import category_suggest, rate_limit
from app.services.receipts import ReceiptDraft, read_receipt

router = APIRouter(prefix="/receipts", tags=["receipts"])
logger = logging.getLogger(__name__)

# Los comprobantes que llegan por archivo. El techo real por tipo lo aplica
# cada parser; éste es la barrera que impide traer a memoria algo enorme.
MAX_UPLOAD_BYTES = 4 * 1024 * 1024
CHUNK = 64 * 1024

MAX_TEXT_CHARS = 20_000


class ReceiptParseOut(BaseModel):
    """El borrador más la categoría que sugiere el historial del hogar."""
    draft: ReceiptDraft
    suggested_category_id: int | None = None
    suggested_category_name: str | None = None
    suggested_from: str | None = None


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    from sqlalchemy import select
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        from fastapi import HTTPException
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


async def _read_capped(file: UploadFile) -> bytes | None:
    """Trae el archivo con techo, en chunks.

    Mismo motivo que `_read_capped` en `routers/income.py`: `await file.read()`
    a secas no tiene tope en ningún lado —uvicorn no impone uno y no hay
    middleware que lo haga— y el backend corre con un solo worker, así que un
    upload grande se lleva puesta la API de todos los hogares.

    Devuelve None si se pasa, en vez de un 413: acá un archivo demasiado grande
    tiene que terminar en "cargalo a mano", no en un error.
    """
    buf = bytearray()
    while chunk := await file.read(CHUNK):
        buf.extend(chunk)
        if len(buf) > MAX_UPLOAD_BYTES:
            return None
    return bytes(buf)


@router.post("/parse", response_model=ReceiptParseOut)
async def parse_receipt(
    request: Request,
    file: UploadFile | None = File(default=None),
    text: str | None = Form(default=None),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    # Es lo único de la app que hace trabajo pesado por request (abrir un PDF),
    # así que tiene su propio límite. Dos baldes, por hogar y por IP, siguiendo
    # el precedente de /directory: en Argentina el NAT del operador hace que
    # limitar sólo por IP castigue a gente que no hizo nada.
    rate_limit.enforce(request, "receipt_parse_ip", 120, 3600)
    rate_limit.enforce_key(f"tenant:{user.tenant_id}", "receipt_parse", 60, 3600)

    if text and len(text) > MAX_TEXT_CHARS:
        text = text[:MAX_TEXT_CHARS]

    data = None
    media_type = None
    if file is not None and file.filename:
        data = await _read_capped(file)
        if data is None:
            return ReceiptParseOut(draft=ReceiptDraft(
                error=f"El archivo supera los {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
            ))
        media_type = file.content_type

    draft = await read_receipt(text=text, data=data, media_type=media_type)

    out = ReceiptParseOut(draft=draft)
    if draft.description:
        hit = await category_suggest.suggest_category(db, user.tenant_id, draft.description)
        if hit:
            out.suggested_category_id = hit.category_id
            out.suggested_category_name = hit.category_name
            out.suggested_from = hit.matched_description
    return out
