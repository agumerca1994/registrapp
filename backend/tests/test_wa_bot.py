"""El bot de WhatsApp: payload de Evolution, flujo de texto, memoria de 7 días."""
from datetime import datetime, timedelta
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import select

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry
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

    assert "✅ $12.000" in replies[0]
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
    assert "13.000" in replies[0]
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
    assert "1. Supermercado" in replies[0]
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
    assert "U$D 20" in replies[0]
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


async def test_pending_category_answered_by_name(db):
    from app.services import category_suggest

    category_suggest.invalidate(1)
    await _cat(db, "Supermercado")
    await _cat(db, "Farmacia")
    await wa_bot.handle(db, USER, _in("12 lucas cosas del chino", wa_id="W1"))

    replies = await wa_bot.handle(db, USER, _in("farmacia", wa_id="W2"))
    assert "✅" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    cat = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Farmacia"))
    assert entry.category_id == cat.id


async def test_edit_description(db):
    await _cat(db, "Kiosco")
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))
    replies = await wa_bot.handle(db, USER, _in("editar descripción golosinas para el finde", wa_id="W2"))
    assert "golosinas para el finde" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.description == "golosinas para el finde"


async def test_description_offer_after_category_answer(db):
    from app.services import category_suggest

    category_suggest.invalidate(1)
    await _cat(db, "Varios")
    await _cat(db, "Supermercado")
    await wa_bot.handle(db, USER, _in("12 lucas cosas del chino", wa_id="W1"))
    replies = await wa_bot.handle(db, USER, _in("varios", wa_id="W2"))
    assert "descripción" in replies[0]

    replies = await wa_bot.handle(db, USER, _in("compras para el asado", wa_id="W3"))
    assert "compras para el asado" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.description == "compras para el asado"


async def test_description_offer_dismissed_with_no(db):
    from app.services import category_suggest

    category_suggest.invalidate(1)
    await _cat(db, "Varios")
    await wa_bot.handle(db, USER, _in("12 lucas chucherias", wa_id="W1"))
    await wa_bot.handle(db, USER, _in("1", wa_id="W2"))
    replies = await wa_bot.handle(db, USER, _in("no", wa_id="W3"))
    assert "Quedó así" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.description == "chucherias"


async def test_description_offer_yields_to_new_expense(db):
    from app.services import category_suggest

    category_suggest.invalidate(1)
    await _cat(db, "Varios")
    await _cat(db, "Kiosco")
    await wa_bot.handle(db, USER, _in("12 lucas chucherias", wa_id="W1"))
    await wa_bot.handle(db, USER, _in("1", wa_id="W2"))
    # En vez de una descripción llega OTRO gasto: la oferta caduca sola.
    replies = await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W3"))
    assert "✅" in replies[0]
    entries = (await db.scalars(select(ExpenseEntry))).all()
    assert len(entries) == 2
    first = next(e for e in entries if e.description == "chucherias")
    assert first.description == "chucherias"  # la oferta no lo tocó


async def test_category_answer_learns_merchant_rule(db):
    """El caso real: contestar la categoría guarda la regla, y el mismo
    comercio vuelve sugerido aunque la descripción se haya reescrito."""
    from app.services import category_suggest

    category_suggest.invalidate(1)
    await _cat(db, "Varios")
    await _cat(db, "Super")
    await wa_bot.handle(db, USER, _in("3600 maremtisas067 compras", wa_id="W1"))
    await wa_bot.handle(db, USER, _in("varios", wa_id="W2"))
    # La descripción se reescribe (lo que rompía la sugerencia por historial).
    await wa_bot.handle(db, USER, _in("mantel para el quincho", wa_id="W3"))

    category_suggest.invalidate(1)
    replies = await wa_bot.handle(db, USER, _in("5000 maremtisas067 compras", wa_id="W4"))
    assert "(sugerida)" in replies[0]
    assert "Varios" in replies[0]
    entries = (await db.scalars(select(ExpenseEntry).order_by(ExpenseEntry.id))).all()
    varios = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Varios"))
    assert entries[-1].category_id == varios.id


# ------------------------------------------------------ comprobantes PDF ---

def _pdf_in(wa_id="P1"):
    return InboundMessage(phone="549383", wa_id=wa_id, kind="pdf")


def _serve_pdf_text(monkeypatch, text):
    """Saltea Evolution y pdfplumber: el bot recibe directo el texto del PDF."""
    from app.services import whatsapp
    from app.services.statement_parsers import common

    async def _download(*_args, **_kwargs):
        return b"%PDF-fake"

    monkeypatch.setattr(whatsapp, "download_media_base64", _download)
    monkeypatch.setattr(common, "extract_pages_text", lambda _src: [text])


async def test_incoming_transfer_receipt_asks_source_and_can_be_a_refund(db, monkeypatch):
    from tests.test_transfer_receipt import MP_INCOMING

    _serve_pdf_text(monkeypatch, MP_INCOMING)
    replies = await wa_bot.handle(db, USER, _pdf_in())

    assert "¿De qué fuente" in replies[0]
    assert "Juan Perez" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None
    event = await db.scalar(select(CaptureEvent))
    assert event.bank_detected == "transferencia_recibida"

    # 1 = Nueva fuente «Juan Perez», 2 = es un reintegro.
    replies = await wa_bot.handle(db, USER, _in("2", wa_id="W2"))
    assert "No lo cargo" in replies[0]
    assert (await db.scalar(select(IncomeEntry))) is None


# --------------------------------------------------------------- ingresos ---

async def _source(db, name, kind=None):
    from app.models.income import IncomeSource, IncomeType

    src = IncomeSource(tenant_id=1, name=name, income_type=kind or IncomeType.other)
    db.add(src)
    await db.flush()
    return src


def test_parse_income_text():
    from app.services.income_capture import parse_income_text

    d = parse_income_text("cobré 850 lucas de sueldo")
    assert d.amount == Decimal("850000.00") and d.term == "sueldo" and d.currency == "ARS"
    d = parse_income_text("me transfirieron usd 500 freelance ayer")
    assert d.currency == "USD" and d.term == "freelance"
    assert parse_income_text("cobré 120000").term == ""
    # Sin verbo es un gasto, como siempre ("sueldo" puede ser el de la empleada).
    assert parse_income_text("850 lucas sueldo") is None
    assert parse_income_text("cobré el sueldo") is None
    assert parse_income_text("recibí la factura de luz 45 lucas") is None
    assert parse_income_text("me llegó la boleta del gas 30 lucas") is None


async def test_income_with_known_source(db):
    await _source(db, "Sueldo")
    replies = await wa_bot.handle(db, USER, _in("cobré 850 lucas sueldo de octubre"))
    assert "✅ Ingreso: $850.000 · Sueldo" in replies[0]
    entry = await db.scalar(select(IncomeEntry))
    assert entry.amount == Decimal("850000.00")
    assert entry.notes == "sueldo de octubre"
    assert (await db.scalar(select(ExpenseEntry))) is None


async def test_income_unknown_source_by_name_creates_it_and_learns(db):
    from app.models.income import IncomeSource, IncomeType

    await _source(db, "Sueldo")
    replies = await wa_bot.handle(db, USER, _in("me pagaron 200 lucas diseño web", wa_id="W1"))
    assert "1. Sueldo" in replies[0] and "2. Nueva fuente «diseño web»" in replies[0]

    replies = await wa_bot.handle(db, USER, _in("Freelance", wa_id="W2"))
    assert "Freelance" in replies[0]
    src = await db.scalar(select(IncomeSource).where(IncomeSource.name == "Freelance"))
    assert src is not None and src.income_type == IncomeType.other

    # Aprendido: el mismo término ya no pregunta.
    replies = await wa_bot.handle(db, USER, _in("cobré 150 lucas diseño web", wa_id="W3"))
    assert "✅ Ingreso: $150.000 · Freelance" in replies[0]


async def test_income_new_source_option_and_type_guess(db):
    from app.models.income import IncomeSource, IncomeType

    replies = await wa_bot.handle(db, USER, _in("cobré 400 lucas aguinaldo", wa_id="W1"))
    assert "1. Nueva fuente «aguinaldo»" in replies[0]
    await wa_bot.handle(db, USER, _in("1", wa_id="W2"))
    src = await db.scalar(select(IncomeSource))
    assert src.name == "aguinaldo" and src.income_type == IncomeType.aguinaldo


async def test_income_duplicate_warning_undo_and_edit(db):
    await _source(db, "Sueldo")
    await _source(db, "Alquiler")
    await wa_bot.handle(db, USER, _in("cobré 850 lucas sueldo", wa_id="W1"))
    replies = await wa_bot.handle(db, USER, _in("cobré 850 lucas sueldo", wa_id="W2"))
    assert "Ya había otro ingreso" in replies[0]

    replies = await wa_bot.handle(db, USER, _in("deshacer", wa_id="W3"))
    assert "Deshecho: ingreso $850.000 · Sueldo" in replies[0]
    assert len((await db.scalars(select(IncomeEntry))).all()) == 1

    replies = await wa_bot.handle(db, USER, _in("editar monto 900 lucas", wa_id="W4"))
    assert "900.000" in replies[0]
    replies = await wa_bot.handle(db, USER, _in("editar fuente alquiler", wa_id="W5"))
    assert "Alquiler" in replies[0]
    entry = await db.scalar(select(IncomeEntry))
    assert entry.amount == Decimal("900000")


async def test_income_question_gives_way_to_a_new_expense(db):
    await _cat(db, "Kiosco")
    await wa_bot.handle(db, USER, _in("cobré 100 lucas", wa_id="W1"))
    replies = await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W2"))
    assert "✅" in replies[0]
    assert (await db.scalar(select(IncomeEntry))) is None


async def test_outgoing_transfer_receipt_still_becomes_an_expense(db, monkeypatch):
    from tests.test_transfer_receipt import BANK_RECEIPT

    await _cat(db, "MARIA LOPEZ")
    _serve_pdf_text(monkeypatch, BANK_RECEIPT)
    replies = await wa_bot.handle(db, USER, _pdf_in())

    assert "✅" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("250000.50")
    assert entry.payment_method == "transferencia"


async def test_undo_goes_through_the_expenses_service(db, monkeypatch):
    # Lo que cuelga de un gasto (split, hipoteca, y con el negocio el stock de
    # una compra) se suelta en `delete_expense`; un `db.delete` directo lo
    # dejaba colgando.
    from app.services import expenses as expenses_service

    calls = []
    real_delete = expenses_service.delete_expense

    async def _spy(db_, entry, tenant_id):
        calls.append(entry.id)
        await real_delete(db_, entry, tenant_id)

    monkeypatch.setattr(expenses_service, "delete_expense", _spy)
    await _cat(db, "Kiosco")
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="U1"))
    entry_id = (await db.scalar(select(ExpenseEntry))).id

    await wa_bot.handle(db, USER, _in("deshacer", wa_id="U2"))
    assert calls == [entry_id]


# ------------------------------------------------------------ negocio ---
# En un negocio, "vendí 20 porciones" se guardaba como un gasto de $20: el
# monto del gasto genérico es el primer número del texto.

async def _business(db, tenant_id=1):
    from app.models.tenant import Tenant

    db.add(Tenant(id=tenant_id, name="Rotisería", kind="business"))
    await db.flush()


async def test_business_sale_text_is_not_an_expense(db):
    # Lo del negocio va a business/bot.py (ver test_business_bot.py) y nunca
    # al gasto genérico, que tomaba el primer número: "vendí 20 porciones"
    # era un gasto de $20. Sin productos cargados, el bot pregunta.
    await _business(db)
    for i, (text, asks) in enumerate([
        ("vendí 20 porciones", "¿Cuánto cobraste"),
        ("hice 30 empanadas", "¿Lo creo?"),
        ("12 coca 18000", "¿Qué fue?"),
        ("vendí", "Para el negocio podés mandarme"),
    ]):
        replies = await wa_bot.handle(db, USER, _in(text, wa_id=f"B{i}"))
        assert asks in replies[0], text
    assert (await db.scalar(select(ExpenseEntry))) is None


async def test_business_plain_expense_still_works(db):
    await _business(db)
    await _cat(db, "Alquiler")
    replies = await wa_bot.handle(db, USER, _in("45 lucas alquiler"))
    assert "✅ $45.000" in replies[0]


async def test_household_sale_like_text_keeps_the_old_behavior(db):
    # Sin tenant negocio, el bot no cambia: el texto sigue al gasto genérico.
    replies = await wa_bot.handle(db, USER, _in("vendí 20 porciones"))
    assert "Cuánto cobraste" not in replies[0]
    assert "categoría" in replies[0]



async def test_an_employee_cannot_load_expenses_or_statements(db):
    from app.models.user import UserRole

    await _business(db)
    employee = SimpleNamespace(id=7, tenant_id=1, role=UserRole.employee)
    await _cat(db, "Alquiler")
    replies = await wa_bot.handle(db, employee, _in("45 lucas alquiler", wa_id="E1"))
    assert "Como empleado" in replies[0]
    replies = await wa_bot.handle(db, employee, _pdf_in("E2"))
    assert "Como empleado" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None


# ------------------------------------------------- cambiar la categoría ---

async def test_category_shortcut_partial_name_and_relearns(db):
    from app.services import category_suggest

    category_suggest.invalidate(1)
    await _cat(db, "Supermercado")
    await _cat(db, "Farmacia")
    await wa_bot.handle(db, USER, _in("12 lucas cosas del chino", wa_id="W1"))
    await wa_bot.handle(db, USER, _in("2", wa_id="W2"))  # Farmacia: el error

    replies = await wa_bot.handle(db, USER, _in("categoría super", wa_id="W3"))
    assert "Supermercado (antes: Farmacia)" in replies[0]
    super_ = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Supermercado"))
    assert (await db.scalar(select(ExpenseEntry))).category_id == super_.id

    # Lo aprendido también se corrigió: el próximo va directo a Supermercado.
    category_suggest.invalidate(1)
    replies = await wa_bot.handle(db, USER, _in("8 lucas cosas del chino", wa_id="W4"))
    assert "Supermercado" in replies[0]


async def test_change_category_phrasings_and_ambiguity(db):
    await _cat(db, "Kiosco")
    await _cat(db, "Salud mental")
    await _cat(db, "Salud física")
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))
    replies = await wa_bot.handle(db, USER, _in("cambiar categoría a salud", wa_id="W2"))
    assert "¿Cuál de estas?" in replies[0]
    replies = await wa_bot.handle(db, USER, _in("cambiar la categoría por salud mental", wa_id="W3"))
    assert "· Salud mental (antes: Kiosco)" in replies[0]


async def test_quoting_the_bot_reply_fixes_that_expense_not_the_last(db):
    await _cat(db, "Kiosco")
    await _cat(db, "Nafta")
    await _cat(db, "Super")

    mark = await wa_bot.memory_mark(db, 1)
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))
    await wa_bot.link_replies(db, 1, mark, ["BOT1"])
    mark = await wa_bot.memory_mark(db, 1)
    await wa_bot.handle(db, USER, _in("20000 nafta", wa_id="W2"))
    await wa_bot.link_replies(db, 1, mark, ["BOT2"])

    # Citar la confirmación del primero, con sólo el nombre de la categoría.
    replies = await wa_bot.handle(db, USER, _in("super", wa_id="W3", quoted="BOT1"))
    assert "Super (antes: Kiosco)" in replies[0]
    entries = (await db.scalars(select(ExpenseEntry).order_by(ExpenseEntry.id))).all()
    super_ = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Super"))
    nafta = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Nafta"))
    assert entries[0].category_id == super_.id and entries[1].category_id == nafta.id

    # La respuesta vinculada no cuenta como "lo último": deshacer dos veces
    # borra los dos gastos, en orden.
    await wa_bot.handle(db, USER, _in("deshacer", wa_id="W4"))
    replies = await wa_bot.handle(db, USER, _in("deshacer", wa_id="W5"))
    assert "Deshecho" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None

    # Citar la confirmación de algo ya deshecho no edita otra cosa.
    replies = await wa_bot.handle(db, USER, _in("categoría nafta", wa_id="W6", quoted="BOT1"))
    assert "No tengo un gasto" in replies[0]


async def test_category_after_an_income_changes_its_source_not_the_last_expense(db):
    from app.models.income import IncomeSource

    await _cat(db, "Kiosco")
    await _source(db, "Sueldo")
    await _source(db, "Freelance")
    await wa_bot.handle(db, USER, _in("5000 kiosco", wa_id="W1"))
    await wa_bot.handle(db, USER, _in("cobré 200 lucas sueldo", wa_id="W2"))

    replies = await wa_bot.handle(db, USER, _in("categoría free", wa_id="W3"))
    assert "Freelance (antes: Sueldo)" in replies[0]
    freelance = await db.scalar(select(IncomeSource).where(IncomeSource.name == "Freelance"))
    assert (await db.scalar(select(IncomeEntry))).source_id == freelance.id
    kiosco = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Kiosco"))
    assert (await db.scalar(select(ExpenseEntry))).category_id == kiosco.id


async def test_income_source_fix_relearns_and_works_quoting(db):
    await _source(db, "Sueldo")
    await _source(db, "Freelance")
    await wa_bot.handle(db, USER, _in("me pagaron 90 lucas diseño web", wa_id="W1"))
    mark = await wa_bot.memory_mark(db, 1)
    await wa_bot.handle(db, USER, _in("1", wa_id="W2"))  # Sueldo: el error
    await wa_bot.link_replies(db, 1, mark, ["BOT1"])

    replies = await wa_bot.handle(db, USER, _in("freelance", wa_id="W3", quoted="BOT1"))
    assert "Freelance (antes: Sueldo)" in replies[0]

    replies = await wa_bot.handle(db, USER, _in("me pagaron 50 lucas diseño web", wa_id="W4"))
    assert "✅ Ingreso: $50.000 · Freelance" in replies[0]


# ------------------------------------------------------------ cómo suena ---

def test_money_drops_zero_cents():
    from app.services.whatsapp import _money

    assert _money(Decimal("12000")) == "$12.000"
    assert _money(Decimal("20.5"), "USD") == "U$D 20,50"
    assert _money("12.000,00") == "$12.000,00"  # ya formateado: pasa tal cual


async def test_correction_hints_stop_after_a_few_captures(db):
    await _cat(db, "Verdulería")
    replies = [
        (await wa_bot.handle(db, USER, _in(f"{n} lucas verdulería", wa_id=f"W{n}")))[0]
        for n in range(1, 6)
    ]
    assert all("Si algo está mal" in r for r in replies[:3])
    assert all("Si algo está mal" not in r for r in replies[3:])
    # Deshacer sigue funcionando aunque ya no se lo recuerde.
    assert "Deshecho" in (await wa_bot.handle(db, USER, _in("deshacer", wa_id="W9")))[0]


def test_reconcile_groups_read_as_sentences():
    assert wa_bot._groups_text({"missing": 2, "rounding": 1}, wa_bot._GROUP_FOUND) == (
        "2 consumos que faltan · 1 diferencia de centavos"
    )
    assert wa_bot._groups_text({"surplus": 1}, wa_bot._GROUP_DONE) == "1 consumo de más borrado"
