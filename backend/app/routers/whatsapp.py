import logging
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

AMOUNT_RE = re.compile(r"^([\d.,]+)\s+(.+)$")


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
        await _send_wa(phone, "⚠️ Número no vinculado. Vinculá tu número en RegistrApp.")
        return {"status": "not_linked"}

    m = AMOUNT_RE.match(text)
    if not m:
        await _send_wa(phone, "❌ Formato inválido.\nEnviá: *monto descripción*\nEj: 15000 supermercado")
        return {"status": "invalid_format"}

    amount = _parse_amount(m.group(1))
    description = m.group(2).strip()

    if amount is None or amount <= 0:
        await _send_wa(phone, "❌ Monto inválido. Usá números: 15000 o 5.500,50")
        return {"status": "invalid_amount"}

    categories = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )).all()

    if not categories:
        await _send_wa(phone, "❌ No tenés categorías configuradas. Creá una en la app.")
        return {"status": "no_categories"}

    desc_lower = description.lower()
    category = next(
        (c for c in categories if c.name.lower() in desc_lower or desc_lower in c.name.lower()),
        categories[0],
    )

    entry = ExpenseEntry(
        tenant_id=user.tenant_id,
        user_id=user.id,
        category_id=category.id,
        amount=amount,
        description=description,
        expense_date=date.today(),
    )
    db.add(entry)
    await db.commit()

    amount_fmt = f"${amount:,.0f}".replace(",", ".")
    await _send_wa(phone, f"✅ {amount_fmt} – {description}\n📁 {category.name}")
    return {"status": "ok"}
