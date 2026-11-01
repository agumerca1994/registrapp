"""Alta desde el bot: quien escribe sin cuenta recibe un link, y lo que mandó
lo espera hasta que la crea (services/wa_signup.py)."""
from datetime import datetime, timedelta

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.expense import ExpenseEntry
from app.models.tenant import Tenant
from app.models.user import User
from app.models.wa_signup_intent import WaSignupIntent
from app.services import rate_limit, wa_bot, wa_signup
from app.services.wa_bot import InboundMessage

PHONE = "5493834111222"


def _in(text, kind="text"):
    return InboundMessage(phone=PHONE, wa_id="W1", kind=kind, text=text)


async def _user(db, uid="uid-new", phone=None):
    t = Tenant(name="Casa", code=f"C{uid[-4:].upper()}")
    db.add(t)
    await db.flush()
    u = User(firebase_uid=uid, tenant_id=t.id, email=f"{uid}@example.com",
             whatsapp_phone=phone, whatsapp_gate_pending=True)
    db.add(u)
    await db.flush()
    return u


def _token(reply: str) -> str:
    return reply.split("?wa=")[1].split()[0]


@pytest.fixture(autouse=True)
def _clear_limits():
    rate_limit._hits.clear()


async def test_an_expense_without_account_gets_a_link_and_waits(db):
    reply = await wa_bot.reply_unlinked(db, _in("12 lucas verdulería"))
    assert "/login?wa=was_" in reply and "queda cargado" in reply
    row = await db.scalar(select(WaSignupIntent))
    assert row.phone == "+" + PHONE
    assert [m["text"] for m in row.messages] == ["12 lucas verdulería"]

    # El segundo mensaje no rota el link: el primero tiene que seguir andando.
    again = await wa_bot.reply_unlinked(db, _in("3000 café", kind="text"))
    assert "?wa=" not in again and "Lo guardé también" in again
    assert len((await db.scalar(select(WaSignupIntent))).messages) == 2

    user = await _user(db)
    texts = await wa_signup.claim(db, user, _token(reply))
    assert texts == ["12 lucas verdulería", "3000 café"]
    assert user.whatsapp_phone == "+" + PHONE
    assert user.whatsapp_gate_pending is False

    # Un solo uso.
    with pytest.raises(HTTPException) as e:
        await wa_signup.claim(db, user, _token(reply))
    assert e.value.status_code == 404


async def test_a_greeting_is_not_saved_and_media_asks_to_resend(db):
    reply = await wa_bot.reply_unlinked(db, _in("hola"))
    assert "Después escribime un gasto" in reply
    assert (await db.scalar(select(WaSignupIntent))).messages == []

    rate_limit._hits.clear()
    row = await db.scalar(select(WaSignupIntent))
    row.link_sent_at = datetime.now() - timedelta(days=2)  # link viejo: sale otro
    pdf = await wa_bot.reply_unlinked(db, InboundMessage(phone=PHONE, wa_id="W2", kind="pdf"))
    assert "mandame eso de nuevo" in pdf and "?wa=" in pdf


async def test_replies_are_capped_per_number(db):
    replies = [await wa_bot.reply_unlinked(db, _in(f"{i} lucas súper")) for i in range(1, 9)]
    assert replies[5] is not None and replies[6] is None


async def test_a_number_linked_to_someone_else_is_refused(db):
    reply = await wa_bot.reply_unlinked(db, _in("12 lucas verdulería"))
    await _user(db, uid="uid-otro", phone="+" + PHONE)
    me = await _user(db, uid="uid-yo")
    with pytest.raises(HTTPException) as e:
        await wa_signup.claim(db, me, _token(reply))
    assert e.value.status_code == 409


async def test_an_old_intent_is_purged_and_its_link_dies(db):
    reply = await wa_bot.reply_unlinked(db, _in("12 lucas verdulería"))
    row = await db.scalar(select(WaSignupIntent))
    row.updated_at = datetime.now() - timedelta(days=8)
    await db.flush()
    with pytest.raises(HTTPException):
        await wa_signup.claim(db, await _user(db), _token(reply))
    assert await wa_signup.purge_old(db) == 1


async def test_saved_text_is_loaded_once_linked(db):
    """Lo guardado se procesa con el bot de siempre: el gasto queda cargado."""
    from app.models.expense import ExpenseCategory

    reply = await wa_bot.reply_unlinked(db, _in("12 lucas verdulería"))
    user = await _user(db)
    db.add(ExpenseCategory(tenant_id=user.tenant_id, name="Verdulería", color="#22c55e", is_fixed=False))
    await db.flush()
    texts = await wa_signup.claim(db, user, _token(reply))
    out = await wa_bot.handle(db, user, InboundMessage(phone=PHONE, wa_id=None, kind="text", text=texts[0]))
    assert "✅" in out[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.tenant_id == user.tenant_id and float(entry.amount) == 12000
