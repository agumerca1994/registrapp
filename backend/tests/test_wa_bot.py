"""El bot de WhatsApp: payload de Evolution, flujo de texto, memoria de 7 días."""
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import select

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.reconciliation import CaptureEvent
from app.models.wa_message import WaMessage
from app.services import wa_bot
from app.services.wa_bot import InboundMessage, parse_evolution_payload

USER = SimpleNamespace(id=1, tenant_id=1)


def _payload(message: dict, *, wa_id="MSGID1", jid="5493834373344@s.whatsapp.net", from_me=False):
    return {"data": {"key": {"id": wa_id, "remoteJid": jid, "fromMe": from_me}, "message": message}}


# ---------------------------------------------------------------- payload ---

def test_parse_text_payload():
    m = parse_evolution_payload(_payload({"conversation": "12 lucas verdu"}))
    assert m.kind == "text"
    assert m.text == "12 lucas verdu"
    assert m.phone == "5493834373344"
    assert m.wa_id == "MSGID1"


def test_parse_quoted_reply():
    m = parse_evolution_payload(_payload({
        "extendedTextMessage": {"text": "deshacer", "contextInfo": {"stanzaId": "OLD1"}}
    }))
    assert m.text == "deshacer"
    assert m.quoted_wa_id == "OLD1"


def test_parse_pdf_image_audio():
    pdf = parse_evolution_payload(_payload({"documentMessage": {"mimetype": "application/pdf"}}))
    assert pdf.kind == "pdf"
    wrapped = parse_evolution_payload(_payload({
        "documentWithCaptionMessage": {"message": {"documentMessage": {"mimetype": "application/pdf"}}}
    }))
    assert wrapped.kind == "pdf"
    img = parse_evolution_payload(_payload({"imageMessage": {"mimetype": "image/jpeg"}}))
    assert img.kind == "image"
    audio = parse_evolution_payload(_payload({"audioMessage": {}}))
    assert audio.kind == "audio"


def test_parse_ignores_own_and_group_messages():
    assert parse_evolution_payload(_payload({"conversation": "hola"}, from_me=True)) is None
    assert parse_evolution_payload(_payload({"conversation": "hola"}, jid="123@g.us")) is None
    assert parse_evolution_payload(_payload({})) is None


# ------------------------------------------------------------------ flujo ---

def _in(text, wa_id="W1", quoted=None):
    return InboundMessage(phone="549383", wa_id=wa_id, kind="text", text=text, quoted_wa_id=quoted)


async def _cat(db, name):
    cat = ExpenseCategory(tenant_id=1, name=name, color="#ef4444", is_fixed=False)
    db.add(cat)
    await db.flush()
    return cat


async def test_text_expense_with_exact_category(db):
    await _cat(db, "Verdulería")
    replies = await wa_bot.handle(db, USER, _in("12 lucas verdulería"))

    assert "✅ $12.000,00" in replies[0]
    assert "Verdulería" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("12000.00")
    assert entry.source == "whatsapp"
    # La memoria quedó apuntando al gasto.
    row = await db.scalar(select(WaMessage).where(WaMessage.ref_type == "expense"))
    assert row.ref_id == entry.id
    assert await wa_bot.already_seen(db, 1, "W1")


async def test_legacy_format_creates_category(db):
    replies = await wa_bot.handle(db, USER, _in("15000 nafta"))
    assert "✅" in replies[0]
    cat = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "nafta"))
    assert cat is not None


async def test_undo_deletes_last_expense(db):
    await _cat(db, "Kiosco")
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))
    replies = await wa_bot.handle(db, USER, _in("deshacer", wa_id="W2"))
    assert "Deshecho" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None
    # Sin nada más para deshacer.
    replies = await wa_bot.handle(db, USER, _in("deshacer", wa_id="W3"))
    assert "No tengo nada" in replies[0]


async def test_edit_amount_and_category(db):
    await _cat(db, "Kiosco")
    await _cat(db, "Super")
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))

    replies = await wa_bot.handle(db, USER, _in("editar monto 13000", wa_id="W2"))
    assert "13.000,00" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("13000")

    await wa_bot.handle(db, USER, _in("editar categoría super", wa_id="W3"))
    cat = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Super"))
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.category_id == cat.id


async def test_ambiguous_category_asks_then_number_answers(db):
    from app.services import category_suggest

    category_suggest.invalidate(1)
    await _cat(db, "Supermercado")
    await _cat(db, "Farmacia")

    replies = await wa_bot.handle(db, USER, _in("12 lucas cosas del chino", wa_id="W1"))
    assert "¿En qué categoría" in replies[0]
    assert "1️⃣ Supermercado" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None  # nada creado todavía

    replies = await wa_bot.handle(db, USER, _in("1", wa_id="W2"))
    assert "✅" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("12000.00")
    cat = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Supermercado"))
    assert entry.category_id == cat.id
    # La pregunta quedó consumida: otro "1" ya no es una respuesta.
    replies = await wa_bot.handle(db, USER, _in("1", wa_id="W3"))
    assert "No te entendí" in replies[0]


async def test_number_without_pending_falls_through_to_expense(db):
    await _cat(db, "Kiosco")
    replies = await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))
    assert "✅" in replies[0]


async def test_unparseable_text_records_funnel_event(db):
    replies = await wa_bot.handle(db, USER, _in("hola, ¿cómo va?", wa_id="W1"))
    assert "No te entendí" in replies[0]
    ev = await db.scalar(select(CaptureEvent))
    assert ev.outcome == "needs_ai"
    assert ev.reason == "unparseable_text"
    assert ev.channel == "whatsapp"


async def test_usd_expense_goes_to_usd_category(db):
    replies = await wa_bot.handle(db, USER, _in("usd 20 regalo", wa_id="W1"))
    assert "U$D 20,00" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.currency == "USD"
    cat = await db.get(ExpenseCategory, entry.category_id)
    assert cat.name == "Consumo en dólares"


async def test_interest_records_event(db):
    replies = await wa_bot.handle(db, USER, _in("me interesa", wa_id="W1"))
    assert "Anotado" in replies[0]
    ev = await db.scalar(select(CaptureEvent))
    assert ev.outcome == "interest"


async def test_purge_removes_old_rows_only(db):
    await _cat(db, "Kiosco")
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))
    old = WaMessage(user_id=1, direction="in", wa_message_id="OLD", kind="text", text="viejo")
    old.created_at = datetime.now() - timedelta(days=8)
    db.add(old)
    await db.commit()

    removed = await wa_bot.purge_old_messages(db)
    assert removed == 1
    remaining = (await db.scalars(select(WaMessage))).all()
    assert all(r.wa_message_id != "OLD" for r in remaining)


async def test_auth_link_tokens_single_use_and_expiry(db):
    from datetime import datetime, timedelta

    from app.services import auth_links

    raw = await auth_links.mint_token(db, 1)
    assert raw.startswith("wat_")
    # Un solo uso: el primer canje devuelve el usuario, el segundo nada.
    assert await auth_links.redeem_token(db, raw) == 1
    assert await auth_links.redeem_token(db, raw) is None
    # Inválido y vencido tampoco (misma respuesta — sin oráculo).
    assert await auth_links.redeem_token(db, "wat_invento") is None
    expired = await auth_links.mint_token(db, 1)
    from sqlalchemy import select as _select

    from app.models.auth_link_token import AuthLinkToken
    row = await db.scalar(_select(AuthLinkToken).order_by(AuthLinkToken.id.desc()))
    row.expires_at = datetime.now() - timedelta(minutes=1)
    await db.flush()
    assert await auth_links.redeem_token(db, expired) is None
