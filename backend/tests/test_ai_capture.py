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

    assert "✅ $15.400 · Farmacity · Salud (sugerida)" in replies[0]
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
    assert "✅ Ingreso: $15.400 · Alquiler" in replies[0]
    entry = await db.scalar(select(IncomeEntry))
    assert entry.notes == "Transferencia de Juan Perez"
    assert (await db.scalar(select(ExpenseEntry))) is None

    # La respuesta quedó como regla: la próxima de Juan Perez no pregunta.
    replies = await wa_bot.handle(db, USER, _img("I2"))
    assert "✅ Ingreso" in replies[0] and "Alquiler" in replies[0]


async def test_payslip_becomes_income(db, ai):
    from app.models.income import IncomeEntry, IncomeSource, IncomeType

    db.add(IncomeSource(tenant_id=1, name="Sueldo", income_type=IncomeType.salary))
    await db.flush()
    ai.reading = _reading(kind="recibo_sueldo", merchant="Acme SA", amount=Decimal("850000"))
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "1. Sueldo" in replies[0]
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
    assert "U$D 20" in replies[0]
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
    assert "sólo leo comprobantes en *PDF*" in replies[0]


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
    assert "✅ $32.100 · Edenor · Luz" in replies[0]


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


async def test_incoming_transfer_without_amount_asks_to_write_it(db, ai):
    ai.reading = _reading(kind="transferencia_recibida", merchant="Juan Perez", amount=None)
    replies = await wa_bot.handle(db, USER, _img("I1"))

    assert "no pude leer bien el monto" in replies[0]
    assert "lo que pagaste" not in replies[0]


# ── Facturas de servicios ──────────────────────────────────────────────────

def _bill(**kw) -> AiReading:
    return _reading(**{
        "kind": "factura_servicio", "amount": Decimal("117504.99"), "merchant": "Personal",
        "payment_method": "debito", "receipt_date": date(2026, 10, 28),
        "due_date": date(2026, 11, 11), "auto_debit": True, **kw,
    })


def _txt(text, wa_id):
    return InboundMessage(phone="549383", wa_id=wa_id, kind="text", text=text)


async def _personal_history(db, months=((2026, 8), (2026, 9)), amount="25950.01"):
    """Personal cargado a mano en la tarjeta, un ítem por resumen (el caso real)."""
    from app.models.credit_card import CreditCard
    from app.schemas.credit_card import CreditCardItemCreate
    from app.services.credit_cards import create_item_in_statement, find_or_create_statement

    cat = await _cat(db, "Servicios")
    card = CreditCard(tenant_id=1, user_id=1, bank="Personal Pay", alias="Visa", due_day=10)
    db.add(card)
    await db.flush()
    for y, m in months:
        stmt = await find_or_create_statement(card, y, m, 1, db)
        await create_item_in_statement(stmt, card, CreditCardItemCreate(
            description="Personal", category_id=cat.id, item_date=date(y, m, 28),
            item_type="single", amount=Decimal(amount),
        ), USER, db)
    await db.flush()
    return cat, card


async def test_bill_is_never_loaded_without_asking(db, ai):
    """El caso real: la factura de Personal con débito automático entraba como
    gasto suelto y duplicaba el ítem que se carga en la tarjeta."""
    ai.reading = _bill()
    replies = await wa_bot.handle(db, USER, _img())
    assert "factura de *Personal*" in replies[0] and "vence el 11/11" in replies[0]
    assert "débito automático" in replies[0]
    assert await db.scalar(select(ExpenseEntry)) is None

    # 3 = todavía no la pagué
    replies = await wa_bot.handle(db, USER, _txt("3", "T1"))
    assert "no la cargo" in replies[0]
    assert await db.scalar(select(ExpenseEntry)) is None


async def test_bill_already_paid_is_loaded_as_expense(db, ai):
    await _cat(db, "Servicios")
    ai.reading = _bill(merchant="Edenor", category="Servicios", auto_debit=False)
    await wa_bot.handle(db, USER, _img())
    replies = await wa_bot.handle(db, USER, _txt("1", "T1"))
    assert "✅" in replies[0] and "Edenor" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("117504.99")


async def test_bill_paid_by_card_without_history_goes_to_the_app(db, ai):
    ai.reading = _bill()
    await wa_bot.handle(db, USER, _img())
    replies = await wa_bot.handle(db, USER, _txt("2", "T1"))
    assert "/expenses?nuevo=1&monto=117504.99" in replies[0] and "pago=tarjeta" in replies[0]
    assert "wat=" in replies[0]
    assert await db.scalar(select(ExpenseEntry)) is None


async def test_bill_goes_to_the_next_statement_of_the_card_it_lives_in(db, ai):
    from app.models.credit_card import CreditCardItem, CreditCardStatement

    cat, card = await _personal_history(db)
    ai.reading = _bill()
    replies = await wa_bot.handle(db, USER, _img())
    assert "Venís cargando *Personal* en la tarjeta *Visa de Personal Pay*" in replies[0]
    # El vencimiento de la factura le gana al estimado del resumen (10/11).
    assert "resumen de octubre" in replies[0] and "(vence el 11/11)" in replies[0]

    replies = await wa_bot.handle(db, USER, _txt("1", "T1"))
    assert "✅ $117.504,99 · Personal · resumen de octubre" in replies[0]
    item, stmt = (await db.execute(
        select(CreditCardItem, CreditCardStatement)
        .join(CreditCardStatement, CreditCardItem.statement_id == CreditCardStatement.id)
        .where(CreditCardItem.amount == Decimal("117504.99"))
    )).one()
    assert (stmt.card_id, stmt.year, stmt.month) == (card.id, 2026, 10)
    assert stmt.due_date == date(2026, 11, 11)
    assert "El resumen vence el 11/11" in replies[0]
    assert (item.item_date, item.category_id, item.capture_source) == (date(2026, 10, 28), cat.id, "whatsapp")
    entry = await db.get(ExpenseEntry, item.expense_entry_id)
    assert entry.payment_method == "tarjeta_credito"

    # deshacer se lleva el ítem y su egreso
    undo = await wa_bot.handle(db, USER, _txt("deshacer", "T2"))
    assert "Deshecho" in undo[0]
    assert await db.get(CreditCardItem, item.id) is None
    assert await db.get(ExpenseEntry, item.expense_entry_id) is None


async def test_bill_already_in_the_card_is_not_offered_again(db, ai):
    await _personal_history(db, months=((2026, 9), (2026, 10)), amount="117504.99")
    ai.reading = _bill()
    replies = await wa_bot.handle(db, USER, _img())
    assert "Ya está cargada en la tarjeta" in replies[0]


async def test_bill_review_in_app_carries_card_and_period(db, ai):
    cat, card = await _personal_history(db)
    ai.reading = _bill()
    await wa_bot.handle(db, USER, _img())
    replies = await wa_bot.handle(db, USER, _txt("3", "T1"))
    assert f"tarjeta={card.id}" in replies[0] and "periodo=2026-10" in replies[0] and f"cat={cat.id}" in replies[0]


async def test_old_card_history_does_not_guess_the_statement(db, ai):
    await _personal_history(db, months=((2026, 3),))
    ai.reading = _bill()
    replies = await wa_bot.handle(db, USER, _img())
    assert "¿Cómo la pagás?" in replies[0]


def test_parse_reading_keeps_a_future_due_date():
    r = parse_reading({"kind": "factura_servicio", "amount": 100, "date": "2026-10-28",
                       "due_date": "2026-11-11", "auto_debit": True}, date(2026, 11, 1))
    assert (r.kind, r.due_date, r.auto_debit) == ("factura_servicio", date(2026, 11, 11), True)
    assert parse_reading({"due_date": "2027-09-01"}, date(2026, 11, 1)).due_date is None


async def test_bill_due_in_another_month_keeps_the_estimate(db, ai):
    from app.models.credit_card import CreditCardStatement

    await _personal_history(db)
    ai.reading = _bill(due_date=date(2026, 10, 25))
    replies = await wa_bot.handle(db, USER, _img())
    assert "(vence el 10/11)" in replies[0]
    await wa_bot.handle(db, USER, _txt("1", "T1"))
    stmt = await db.scalar(select(CreditCardStatement).where(CreditCardStatement.month == 10))
    assert stmt.due_date is None


async def test_bill_never_overrides_a_real_due_date(db, ai):
    from app.services.credit_cards import find_or_create_statement

    cat, card = await _personal_history(db)
    stmt = await find_or_create_statement(card, 2026, 10, 1, db)
    stmt.due_date = date(2026, 11, 13)
    await db.flush()
    ai.reading = _bill()
    replies = await wa_bot.handle(db, USER, _img())
    assert "(vence el 13/11)" in replies[0]
    replies = await wa_bot.handle(db, USER, _txt("1", "T1"))
    assert "El resumen vence" not in replies[0]
    assert stmt.due_date == date(2026, 11, 13)


# ------------------------------------------------ detalle del recibo de sueldo ---
# Montos sintéticos: el repo es público.

def _line(name, amount, kind, field=""):
    from app.services.ai_capture import PayslipLine

    return PayslipLine(name=name, amount=Decimal(amount), kind=kind, field=field)


def _fields(*specs):
    from app.models.income import IncomeSourceField

    return [
        IncomeSourceField(id=i + 1, source_id=1, name=n, kind=k, position=i, is_active=active)
        for i, (n, k, active) in enumerate(
            (s if len(s) == 3 else (*s, True)) for s in specs
        )
    ]


def test_parse_reading_keeps_payslip_lines_only():
    raw = dict(
        kind="recibo_sueldo", amount=1000, currency="ARS", date="", merchant="Acme",
        payment_method="desconocido", category="", due_date="", auto_debit=False,
        lines=[
            {"name": "Sueldo básico", "amount": 1200, "kind": "add", "field": "Bruto"},
            {"name": "Jubilación 11%", "amount": 132, "kind": "subtract", "field": "Inventado"},
            {"name": "", "amount": 5, "kind": "add", "field": ""},
            {"name": "Cero", "amount": 0, "kind": "add", "field": ""},
            {"name": "Raro", "amount": 10, "kind": "otro", "field": ""},
        ],
    )
    r = parse_reading(raw, date(2026, 10, 30), ["Bruto"])
    assert [(l.name, l.amount, l.kind, l.field) for l in r.lines] == [
        ("Sueldo básico", Decimal("1200.00"), "add", "Bruto"),
        ("Jubilación 11%", Decimal("132.00"), "subtract", ""),  # campo fuera de la lista
        ("Raro", Decimal("10.00"), "info", ""),
    ]
    # En cualquier otro comprobante, los renglones no se leen.
    assert parse_reading({**raw, "kind": "gasto"}, date(2026, 10, 30), ["Bruto"]).lines == []


def test_match_payslip_lines_by_name_code_and_percent():
    from app.services.income_capture import match_payslip_lines

    fields = _fields(("Bruto", "add"), ("Jubilación", "subtract"), ("Ley 19032", "subtract"),
                     ("Obra social", "subtract"), ("Viejo", "add", False))
    lines = [
        _line("0010 Sueldo básico", "1000", "add"),          # sin campo: no se guarda
        _line("JUBILACION 11%", "110", "subtract"),
        _line("Ley 19.032 3%", "30", "subtract"),
        _line("Obra Social (3%)", "30", "subtract"),
        _line("Viejo", "5", "add"),                           # archivado: nunca
    ]
    got = {f.name: l.amount for f, l in match_payslip_lines(lines, fields)}
    assert got == {"Jubilación": Decimal("110"), "Ley 19032": Decimal("30"), "Obra social": Decimal("30")}


def test_match_payslip_lines_ai_hint_is_checked():
    from app.services.income_capture import match_payslip_lines

    fields = _fields(("Bruto", "add"), ("Ganancias", "subtract"), ("Bono", "add"))
    lines = [
        # La pista de la IA lleva el total al campo Bruto.
        _line("Total remunerativo", "1500", "info", "Bruto"),
        # Un haber no va a un campo que resta, aunque la IA lo señale.
        _line("Horas extra", "200", "add", "Ganancias"),
        # Dos renglones señalados al mismo campo sin nombrarlo: queda vacío.
        _line("Premio", "50", "add", "Bono"),
        _line("Gratificación", "60", "add", "Bono"),
    ]
    got = {f.name: l.amount for f, l in match_payslip_lines(lines, fields)}
    assert got == {"Bruto": Decimal("1500")}

    # Si uno de los dos lo nombra, gana ése.
    got = {f.name: l.amount for f, l in match_payslip_lines(
        [_line("Bono", "70", "add"), _line("Premio", "50", "add", "Bono")], fields,
    )}
    assert got == {"Bono": Decimal("70")}


def test_match_field_shared_with_mcp():
    from app.services.income import match_field

    fields = _fields(("Obra  Social", "subtract"), ("Viejo", "add", False))
    assert match_field("obra social", fields).name == "Obra  Social"
    assert match_field("viejo", fields) is None
    assert match_field("viejo", fields, {2}).name == "Viejo"


async def _salary_source(db, *fields):
    from app.models.income import IncomeSource, IncomeSourceField, IncomeType

    src = IncomeSource(tenant_id=1, name="Sueldo", income_type=IncomeType.salary)
    db.add(src)
    await db.flush()
    for pos, (name, kind) in enumerate(fields):
        db.add(IncomeSourceField(source_id=src.id, name=name, kind=kind, position=pos))
    await db.flush()
    return src


_PAYSLIP_LINES = [
    ("Total remunerativo", "1000", "info", "Bruto"),
    ("Jubilación 11%", "110", "subtract", ""),
    ("Obra social 3%", "30", "subtract", ""),
    ("Cuota sindical", "20", "subtract", ""),  # la fuente no tiene ese campo
]


def _payslip(merchant):
    return _reading(
        kind="recibo_sueldo", merchant=merchant, amount=Decimal("840"),
        lines=[_line(*row) for row in _PAYSLIP_LINES],
    )


async def _entry_with_items(db):
    from sqlalchemy.orm import selectinload

    from app.models.income import IncomeEntry

    return await db.scalar(
        select(IncomeEntry).options(selectinload(IncomeEntry.items)).execution_options(populate_existing=True)
    )


async def test_payslip_fills_source_fields(db, ai):
    await _salary_source(db, ("Bruto", "add"), ("Jubilación", "subtract"), ("Obra social", "subtract"),
                         ("Ganancias", "subtract"))
    ai.reading = _payslip("Sueldo")
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "✅ Ingreso" in replies[0]
    assert "Del recibo completé Bruto, Jubilación y Obra social." in replies[0]
    assert "—" not in replies[0]
    # La IA recibió los campos del hogar para poder señalarlos.
    assert ai.calls[-1]["income_fields"] == {"Sueldo": ["Bruto", "Jubilación", "Obra social", "Ganancias"]}

    entry = await _entry_with_items(db)
    assert entry.amount == Decimal("840")  # el neto impreso, no el del detalle
    assert {i.name: i.amount for i in entry.items} == {
        "Bruto": Decimal("1000"), "Jubilación": Decimal("110"), "Obra social": Decimal("30"),
    }
    assert entry.bruto == Decimal("1000") and entry.deducciones == Decimal("140")

    # Deshacer se lleva el detalle con el ingreso.
    replies = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="T1", kind="text", text="deshacer"))
    assert "Deshecho" in replies[0]
    assert await _entry_with_items(db) is None


async def test_payslip_lines_travel_with_the_source_question(db, ai):
    await _salary_source(db, ("Bruto", "add"), ("Jubilación", "subtract"))
    ai.reading = _payslip("Acme SA")
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "1. Sueldo" in replies[0]
    replies = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="T1", kind="text", text="1"))
    assert "Del recibo completé Bruto y Jubilación." in replies[0]
    entry = await _entry_with_items(db)
    assert {i.name for i in entry.items} == {"Bruto", "Jubilación"}


async def test_payslip_into_new_source_saves_no_detail(db, ai):
    """Una fuente nueva no tiene campos: el bot no los inventa."""
    from app.models.income import IncomeSourceField

    ai.reading = _payslip("Acme SA")
    await wa_bot.handle(db, USER, _img("I1"))
    replies = await wa_bot.handle(db, USER, InboundMessage(phone="549383", wa_id="T1", kind="text", text="1"))
    assert "Acme SA" in replies[0] and "Del recibo" not in replies[0]
    assert (await _entry_with_items(db)).items == []
    assert (await db.scalar(select(IncomeSourceField))) is None


async def test_payslip_source_without_fields_behaves_as_before(db, ai):
    await _salary_source(db)
    ai.reading = _payslip("Sueldo")
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "Del recibo" not in replies[0] and "No encontré" not in replies[0]
    entry = await _entry_with_items(db)
    assert entry.amount == Decimal("840") and entry.items == [] and entry.bruto is None


async def test_payslip_with_no_matching_concept_says_so(db, ai):
    await _salary_source(db, ("Ganancias", "subtract"))
    ai.reading = _payslip("Sueldo")
    replies = await wa_bot.handle(db, USER, _img("I1"))
    assert "No encontré en el recibo los campos de «Sueldo»" in replies[0]
    assert (await _entry_with_items(db)).items == []
