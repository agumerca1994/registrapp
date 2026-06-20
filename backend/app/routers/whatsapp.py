import logging
import random
import re
from datetime import date
from decimal import Decimal, InvalidOperation

import httpx
from fastapi import APIRouter, Depends, Header, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.user import User

router = APIRouter(prefix="/webhook", tags=["webhook"])
logger = logging.getLogger(__name__)

# monto categoria  (categoria = una sola palabra, sin espacios)
AMOUNT_RE = re.compile(r"^([\d.,]+)\s+(\S+)$")
MAX_AMOUNT = Decimal("999999999.00")
EMOJI_RE = re.compile(
    "[\U0001F600-\U0001F64F"
    "\U0001F300-\U0001F5FF"
    "\U0001F680-\U0001F6FF"
    "\U0001F700-\U0001F7FF"
    "\U0001F800-\U0001F8FF"
    "\U0001F900-\U0001F9FF"
    "\U0001FA00-\U0001FAFF"
    "\U00002702-\U000027B0"
    "\U000024C2-\U0001F251"
    "]+"
)
COLORS = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
    "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#06b6d4",
]

MSG_FORMAT_ERROR = (
    "❌ *Formato incorrecto.*\n\n"
    "El formato correcto es:\n"
    "*monto categoria*\n\n"
    "Reglas:\n"
    "• El monto es un numero sin espacios\n"
    "  (ej: 15000 • 1500,50 • 1.500.000)\n"
    "• El monto maximo es 999.999.999,00\n"
    "• La categoria va sin espacios ni emojis\n"
    "  (ej: supermercado • nafta • alquiler)\n\n"
    "Intenta de nuevo con el formato correcto."
)

MSG_OK = "✅ Gasto registrado correctamente."

MSG_ERROR = (
    "❌ Ocurrio un error al registrar el gasto.\n"
    "Intenta de nuevo mas tarde."
)

MSG_NOT_LINKED = (
    "⚠️ Numero no vinculado.\n"
    "Vincula tu numero en RegistrApp (Configuracion > WhatsApp)."
)


async def _send_wa(phone: str, text: str) -> None:
    if not settings.EVOLUTION_API_URL or not settings.EVOLUTION_INSTANCE:
        logger.warning("Evolution API not configured, skipping reply")
        return
    url = f"{settings.EVOLUTION_API_URL}/message/sendText/{settings.EVOLUTION_INSTANCE}"
    headers = {"apikey": settings.EVOLUTION_API_KEY, "Content-Type": "application/json"}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={"number": phone, "text": text}, headers=headers)
    except Exception as e:
        logger.error(f"WA send failed: {e}")


def _parse_amount(raw: str) -> Decimal | None:
    try:
        cleaned = raw.strip()
        if "," in cleaned:
            cleaned = cleaned.replace(".", "").replace(",", ".")
        return Decimal(cleaned)
    except InvalidOperation:
        return None


@router.post("/whatsapp")
async def whatsapp_webhook(
    payload: dict,
    x_webhook_secret: str = Header(default=""),
    db: AsyncSession = Depends(get_db),
):
    if settings.WHATSAPP_WEBHOOK_SECRET and x_webhook_secret != settings.WHATSAPP_WEBHOOK_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")

    try:
        data = payload.get("data", {})
        key = data.get("key", {})

        if key.get("fromMe"):
            return {"status": "ignored"}

        remote_jid = key.get("remoteJid", "")
        if "@g.us" in remote_jid:
            return {"status": "ignored"}

        phone = remote_jid.replace("@s.whatsapp.net", "").strip()

        message = data.get("message", {})
        text = (
            message.get("conversation")
            or message.get("extendedTextMessage", {}).get("text")
            or ""
        ).strip()

        if not phone or not text:
            return {"status": "ignored"}
    except Exception as e:
        logger.error(f"WA webhook parse error: {e}")
        return {"status": "error"}

    user = await db.scalar(select(User).where(User.whatsapp_phone == phone))
    if not user:
        await _send_wa(phone, MSG_NOT_LINKED)
        return {"status": "not_linked"}

    # ── Format validation ───────────────────────────────────────────────────────
    m = AMOUNT_RE.match(text)
    if not m:
        await _send_wa(phone, MSG_FORMAT_ERROR)
        return {"status": "invalid_format"}

    raw_amount, cat_name = m.group(1), m.group(2)

    # Emoji check on category name
    if EMOJI_RE.search(cat_name):
        await _send_wa(phone, MSG_FORMAT_ERROR)
        return {"status": "invalid_format"}

    amount = _parse_amount(raw_amount)
    if amount is None or amount <= 0 or amount > MAX_AMOUNT:
        await _send_wa(phone, MSG_FORMAT_ERROR)
        return {"status": "invalid_amount"}

    # ── Category: find or create ────────────────────────────────────────────────
    try:
        categories = (await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
        )).all()

        category = next(
            (c for c in categories if c.name.lower() == cat_name.lower()),
            None,
        )
        if category is None:
            category = ExpenseCategory(
                tenant_id=user.tenant_id,
                name=cat_name,
                color=random.choice(COLORS),
                is_fixed=False,
            )
            db.add(category)
            await db.flush()

        entry = ExpenseEntry(
            tenant_id=user.tenant_id,
            user_id=user.id,
            category_id=category.id,
            amount=amount,
            description=cat_name,
            expense_date=date.today(),
        )
        db.add(entry)
        await db.commit()
    except Exception as e:
        logger.error(f"WA expense save error: {e}")
        await db.rollback()
        await _send_wa(phone, MSG_ERROR)
        return {"status": "error"}

    await _send_wa(phone, MSG_OK)
    return {"status": "ok"}
