from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, extract
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db, AsyncSessionLocal
from app.core.firebase import get_current_user
from app.models.credit_card import CreditCard, CreditCardStatement
from app.models.payment_reminder import PaymentReminder
from app.models.user import User
from app.schemas.payment_reminder import ReminderCreate, ReminderOut

router = APIRouter(prefix="/reminders", tags=["reminders"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


@router.get("", response_model=list[ReminderOut])
async def list_reminders(
    year: int = Query(...),
    month: int = Query(..., ge=1, le=12),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(PaymentReminder).where(
            PaymentReminder.tenant_id == user.tenant_id,
            extract("year", PaymentReminder.remind_date) == year,
            extract("month", PaymentReminder.remind_date) == month,
        ).order_by(PaymentReminder.remind_date)
    )
    return result.all()


@router.post("", response_model=ReminderOut, status_code=status.HTTP_201_CREATED)
async def create_reminder(
    body: ReminderCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    if body.statement_id is not None:
        stmt = await db.get(CreditCardStatement, body.statement_id)
        if not stmt or stmt.tenant_id != user.tenant_id:
            raise HTTPException(status_code=404, detail="Resumen no encontrado")

    reminder = PaymentReminder(
        tenant_id=user.tenant_id,
        user_id=user.id,
        title=body.title,
        remind_date=body.remind_date,
        statement_id=body.statement_id,
    )
    db.add(reminder)
    await db.commit()
    await db.refresh(reminder)
    return reminder


@router.delete("/{reminder_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_reminder(
    reminder_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    reminder = await db.scalar(
        select(PaymentReminder).where(
            PaymentReminder.id == reminder_id,
            PaymentReminder.tenant_id == user.tenant_id,
        )
    )
    if not reminder:
        raise HTTPException(status_code=404, detail="Recordatorio no encontrado")
    await db.delete(reminder)
    await db.commit()


async def send_due_reminders() -> None:
    """Scheduled job: WhatsApp every not-yet-notified reminder due today to its
    creator (only works if that user has linked their own WhatsApp number)."""
    from app.routers.shared_expenses import _send_wa_msg

    async with AsyncSessionLocal() as db:
        reminders = await db.scalars(
            select(PaymentReminder).where(
                PaymentReminder.remind_date == date.today(),
                PaymentReminder.notified.is_(False),
            )
        )
        for reminder in reminders.all():
            user = await db.get(User, reminder.user_id)
            reminder.notified = True
            if not user or not user.whatsapp_phone:
                continue

            card_alias = None
            if reminder.statement_id:
                stmt = await db.get(CreditCardStatement, reminder.statement_id)
                if stmt:
                    card = await db.get(CreditCard, stmt.card_id)
                    card_alias = card.alias if card else None

            msg = f"🔔 Recordatorio de pago: {reminder.title}"
            if card_alias:
                msg += f" ({card_alias})"
            msg += f"\n\nFecha: {reminder.remind_date.strftime('%d/%m/%Y')}"

            await _send_wa_msg(user.whatsapp_phone, msg)

        await db.commit()
