"""Lectura de comprobantes con IA en el bot: la API está stubbeada; lo que se
prueba es qué hace el bot con cada lectura (y que la IA nunca escribe sola)."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import select

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.reconciliation import CaptureEvent
from app.models.wa_message import WaMessage
from app.services import ai_capture, wa_bot
from app.services.ai_capture import AiReading, parse_reading
from app.services.wa_bot import InboundMessage

USER = SimpleNamespace(id=1, tenant_id=1)


def _reading(**kw) -> AiReading:
    base = dict(
        kind="gasto", amount=Decimal("15400.00"), currency="ARS", receipt_date=None,
        merchant="Farmacity", payment_method="debito", category="", input_tokens=1500,
    )
    base.update(kw)
    return AiReading(**base)


@pytest.fixture
def ai(monkeypatch):
    """Prende la IA y devuelve un objeto donde el test pone la lectura."""
    from app.services import rate_limit, whatsapp

    state = SimpleNamespace(reading=_reading(), calls=[])

    async def _read(data, **kwargs):
        state.calls.append(kwargs)
        return state.reading

    async def _download(*_a, **_k):
        return b"\xff\xd8\xff fake jpeg"

    monkeypatch.setattr(ai_capture, "enabled", lambda: True)
    monkeypatch.setattr(ai_capture, "read_receipt", _read)
    monkeypatch.setattr(whatsapp, "download_media_base64", _download)
    rate_limit._hits.clear()
    return state


def _img(wa_id="I1", caption=""):
    return InboundMessage(phone="549383", wa_id=wa_id, kind="image", text=caption)


async def _cat(db, name):
    cat = ExpenseCategory(tenant_id=1, name=name, color="#ef4444", is_fixed=False)
    db.add(cat)
    await db.flush()
    return cat


async def test_image_becomes_expense_with_ai_suggested_category(db, ai):
    await _cat(db, "Salud")
    ai.reading = _reading(category="salud")
    replies = await wa_bot.handle(db, USER, _img(caption="remedios"))

    assert "✅ $15.400,00 · Farmacity — Salud (sugerida)" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("15400.00")
    assert entry.payment_method == "debito"
    assert entry.source == "whatsapp"
    assert ai.calls[0]["categories"] == ["Salud"]
    assert ai.calls[0]["caption"] == "remedios"
    ev = await db.scalar(select(CaptureEvent))
    assert (ev.outcome, ev.input_kind, ev.est_input_tokens) == ("ai_ok", "image", 1500)

    # deshacer funciona igual que con un gasto escrito
    undo = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="T2", kind="text", text="deshacer"))
    assert "Deshecho" in undo[0]


async def test_without_category_asks_like_free_text(db, ai):
    await _cat(db, "Súper")
    await _cat(db, "Salud")
    replies = await wa_bot.handle(db, USER, _img())
    assert "¿En qué categoría va *Farmacity*" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None

    done = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="T2", kind="text", text="salud"))
    assert "✅" in done[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.payment_method == "debito"


async def test_learned_rule_wins_over_ai_suggestion(db, ai):
    from app.services.reconcile import rules as capture_rules

    salud = await _cat(db, "Salud")
    await _cat(db, "Perfumería")
    await capture_rules.save_rule(
        db, 1, capture_rules.KIND_MERCHANT_CATEGORY,
        capture_rules.merchant_key("Farmacity"), {"category_id": salud.id},
    )
    ai.reading = _reading(category="Perfumería")
    replies = await wa_bot.handle(db, USER, _img())
    assert "Salud" in replies[0]


async def test_credit_card_payment_is_not_loaded(db, ai):
    await _cat(db, "Salud")
    ai.reading = _reading(payment_method="tarjeta_credito", category="Salud")
    replies = await wa_bot.handle(db, USER, _img())
    assert "tarjeta de crédito" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None


async def test_incoming_transfer_becomes_income_not_expense(db, ai):
    from app.models.income import IncomeEntry, IncomeSource, IncomeType

    db.add(IncomeSource(tenant_id=1, name="Alquiler", income_type=IncomeType.other))
    await db.flush()
    ai.reading = _reading(kind="transferencia_recibida", merchant="Juan Perez")
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "¿De qué fuente" in replies[0] and "Juan Perez" in replies[0]
    assert "No es un ingreso" in replies[0]

    replies = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="T1", kind="text", text="1"))
    assert "💰 Ingreso: $15.400,00 · Alquiler" in replies[0]
    entry = await db.scalar(select(IncomeEntry))
    assert entry.notes == "Transferencia de Juan Perez"
    assert (await db.scalar(select(ExpenseEntry))) is None

    # La respuesta quedó como regla: la próxima de Juan Perez no pregunta.
    replies = await wa_bot.handle(db, USER, _img("I2"))
    assert "💰 Ingreso" in replies[0] and "Alquiler" in replies[0]


async def test_payslip_becomes_income(db, ai):
    from app.models.income import IncomeEntry, IncomeSource, IncomeType

    db.add(IncomeSource(tenant_id=1, name="Sueldo", income_type=IncomeType.salary))
    await db.flush()
    ai.reading = _reading(kind="recibo_sueldo", merchant="Acme SA", amount=Decimal("850000"))
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "1️⃣ Sueldo" in replies[0]
    # Un recibo de sueldo no es un reintegro: esa opción no va.
    assert "No es un ingreso" not in replies[0]
    replies = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="T1", kind="text", text="1"))
    entry = await db.scalar(select(IncomeEntry))
    assert entry.amount == Decimal("850000")


async def test_unreadable_image_and_statement_photo(db, ai):
    ai.reading = None
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "No encontré un pago" in replies[0]
    assert (await db.scalar(select(CaptureEvent))).outcome == "ai_failed"

    ai.reading = _reading(kind="resumen_tarjeta")
    replies = await wa_bot.handle(db, USER, _img("I2"))
    assert "*PDF*" in replies[0]


async def test_usd_receipt_goes_to_usd_category(db, ai):
    ai.reading = _reading(currency="USD", amount=Decimal("20.00"), merchant="Amazon")
    replies = await wa_bot.handle(db, USER, _img())
    assert "U$D 20,00" in replies[0]
    assert "Consumo en dólares" in replies[0]


async def test_inbound_is_claimed_before_the_ai_call(db, ai, monkeypatch):
    """Evolution reintenta si el webhook tarda: el mensaje queda registrado
    antes de llamar a la IA, así el reintento es un duplicado."""
    seen_during_call = []

    async def _read(data, **kwargs):
        seen_during_call.append(await wa_bot.already_seen(db, USER.id, "I1"))
        return _reading(category="")

    monkeypatch.setattr(ai_capture, "read_receipt", _read)
    await _cat(db, "Salud")
    await wa_bot.handle(db, USER, _img("I1"))
    assert seen_during_call == [True]
    rows = (await db.scalars(select(WaMessage).where(WaMessage.wa_message_id == "I1"))).all()
    assert len(rows) == 1


async def test_daily_limit(db, ai, monkeypatch):
    from app.core.config import settings

    monkeypatch.setattr(settings, "WA_AI_DAILY_LIMIT", 1)
    await _cat(db, "Salud")
    ai.reading = _reading(category="Salud")
    await wa_bot.handle(db, USER, _img("I1"))
    replies = await wa_bot.handle(db, USER, _img("I2"))
    assert "máximo" in replies[0]
    assert len(ai.calls) == 1


async def test_image_without_ai_keeps_old_message(db, monkeypatch):
    monkeypatch.setattr(ai_capture, "enabled", lambda: False)
    replies = await wa_bot.handle(db, USER, _img())
    assert "sólo puedo leer comprobantes en *PDF*" in replies[0]


async def test_unknown_pdf_is_read_by_ai(db, ai, monkeypatch):
    from app.services import whatsapp
    from app.services.statement_parsers import common

    async def _download(*_a, **_k):
        return b"%PDF-fake"

    monkeypatch.setattr(whatsapp, "download_media_base64", _download)
    monkeypatch.setattr(common, "extract_pages_text", lambda _src: ["FACTURA B\nEdenor\nTotal 32.100,00"])
    await _cat(db, "Luz")
    ai.reading = _reading(merchant="Edenor", amount=Decimal("32100.00"), category="Luz",
                          payment_method="transferencia")
    replies = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="P1", kind="pdf"))
    assert "✅ $32.100,00 · Edenor — Luz" in replies[0]


# ------------------------------------------------------------- lectura ---

def test_parse_reading_sanitizes():
    today = date(2026, 10, 28)
    r = parse_reading({"kind": "gasto", "amount": 1234.5, "currency": "ARS", "date": "2026-10-27",
                       "merchant": " Coto ", "payment_method": "debito", "category": "Súper"}, today)
    assert (r.amount, r.receipt_date, r.merchant) == (Decimal("1234.50"), date(2026, 10, 27), "Coto")

    future = parse_reading({"amount": 0, "date": "2026-11-30", "payment_method": "cheque"}, today)
    assert future.amount is None and future.receipt_date is None
    assert future.payment_method == "desconocido" and future.kind == "no_es_comprobante"
    assert parse_reading({"date": "2024-01-01"}, today).receipt_date is None


def test_sniff_media_type():
    assert ai_capture.sniff_media_type(b"%PDF-1.7") == "application/pdf"
    assert ai_capture.sniff_media_type(b"\xff\xd8\xff\xe0") == "image/jpeg"
    assert ai_capture.sniff_media_type(b"\x89PNG\r\n\x1a\nxx") == "image/png"
    assert ai_capture.sniff_media_type(b"hola") is None


def test_disabled_without_key():
    assert ai_capture.enabled() is False
