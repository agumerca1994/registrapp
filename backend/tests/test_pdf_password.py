"""PDFs con contraseña por WhatsApp: el bot la pide, la respuesta lo abre y el
PDF sigue el camino de siempre. La contraseña nunca queda en la memoria."""
import io
from decimal import Decimal
from types import SimpleNamespace

import pytest
from pypdf import PdfWriter
from sqlalchemy import select

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.wa_message import WaMessage
from app.services import ai_capture, pdf_unlock, wa_bot
from app.services.ai_capture import AiReading
from app.services.wa_bot import InboundMessage

USER = SimpleNamespace(id=1, tenant_id=1)
DNI = "30123456"


def _locked_pdf(password=DNI) -> bytes:
    w = PdfWriter()
    w.add_blank_page(200, 200)
    w.encrypt(password, algorithm="AES-256")
    out = io.BytesIO()
    w.write(out)
    return out.getvalue()


@pytest.fixture
def bot(monkeypatch):
    from app.services import rate_limit, whatsapp

    state = SimpleNamespace(pdf=_locked_pdf(), downloads=[], calls=[])

    async def _download(key, raw=None):
        state.downloads.append((key, raw))
        return state.pdf

    async def _read(data, **kwargs):
        state.calls.append((data, kwargs))
        return AiReading(
            kind="gasto", amount=Decimal("8200.00"), currency="ARS", receipt_date=None,
            merchant="Edenor", payment_method="transferencia", category="Servicios", input_tokens=900,
        )

    monkeypatch.setattr(whatsapp, "download_media_base64", _download)
    monkeypatch.setattr(ai_capture, "enabled", lambda: True)
    monkeypatch.setattr(ai_capture, "read_receipt", _read)
    rate_limit._hits.clear()
    return state


def _pdf_msg(wa_id="P1"):
    return InboundMessage(
        phone="549383", wa_id=wa_id, kind="pdf", text="",
        media_key={"id": wa_id}, raw_message={"documentMessage": {"jpegThumbnail": "xxx", "url": "u"}},
    )


def _text(text, wa_id):
    return InboundMessage(phone="549383", wa_id=wa_id, kind="text", text=text)


async def _open_question(db):
    row = await wa_bot._open_pending(db, USER.id)
    return row.pending if row else None


async def _all_texts(db):
    return [m.text or "" for m in (await db.scalars(select(WaMessage))).all()]


def test_unlock():
    data = _locked_pdf()
    assert pdf_unlock.needs_password(data)
    assert pdf_unlock.unlock(data, "otra") is None
    opened = pdf_unlock.unlock(data, DNI)
    assert opened is not None and not pdf_unlock.needs_password(opened)


async def test_asks_password_then_reads_with_it(db, bot):
    db.add(ExpenseCategory(tenant_id=1, name="Servicios", color="#ef4444", is_fixed=False))
    await db.flush()

    replies = await wa_bot.handle(db, USER, _pdf_msg())
    assert replies == [wa_bot.MSG_PDF_PASSWORD]
    assert bot.calls == []  # la IA no recibe un PDF que no puede abrir
    asked = await _open_question(db)
    assert asked["type"] == "pdf_password"
    assert "jpegThumbnail" not in str(asked)

    wrong = await wa_bot.handle(db, USER, _text("12345678", "T1"))
    assert "no abre" in wrong[0]
    assert await db.scalar(select(ExpenseEntry)) is None  # un DNI no es un gasto

    replies = await wa_bot.handle(db, USER, _text(DNI, "T2"))
    assert "8.200" in replies[0]
    data, kwargs = bot.calls[0]
    assert not pdf_unlock.needs_password(data)
    assert kwargs["caption"] == ""  # la contraseña no viaja como comentario
    assert bot.downloads[-1] == ({"id": "P1"}, {"documentMessage": {"url": "u"}})
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("8200.00")
    texts = await _all_texts(db)
    assert not any(DNI in t or "12345678" in t for t in texts)


async def test_password_retries_are_limited(db, bot):
    await wa_bot.handle(db, USER, _pdf_msg())
    for i in range(wa_bot.PDF_PASSWORD_TRIES - 1):
        assert "no abre" in (await wa_bot.handle(db, USER, _text(f"mal{i}", f"T{i}")))[0]
    last = await wa_bot.handle(db, USER, _text("mal9", "T9"))
    assert "tampoco" in last[0]
    assert await _open_question(db) is None


async def test_text_with_spaces_is_a_new_message_not_a_password(db, bot):
    await wa_bot.handle(db, USER, _pdf_msg())
    await wa_bot.handle(db, USER, _text("hola que tal", "T1"))
    assert await _open_question(db) is None


async def test_cancel(db, bot):
    await wa_bot.handle(db, USER, _pdf_msg())
    assert (await wa_bot.handle(db, USER, _text("cancelar", "T1"))) == ["Listo, dejé ese PDF."]
