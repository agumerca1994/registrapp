"""Lo que le pasó de verdad al bot en la semana del 28/10/2026, con datos
inventados: cada test es un mensaje que salió mal (o un callejón) y lo que tiene
que pasar ahora. Si uno de estos se rompe, volvió un error que alguien ya sufrió."""
from datetime import timedelta
from decimal import Decimal
from types import SimpleNamespace

import pytest
from sqlalchemy import func, select

from app.models.bot_case import BotCase
from app.models.contact import SharedContact
from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource, IncomeType
from app.models.reconciliation import ReconciliationSession
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.models.wa_message import WaMessage
from app.services import ai_capture, bot_cases, notify_shared, quick_capture, rate_limit, wa_bot, whatsapp
from app.services import transcribe as wa_transcribe
from app.services.clock import ar_today
from app.services import statement_parsers
from app.services.statement_parsers import common as parser_common
from app.services.wa_bot import InboundMessage

_seq = iter(range(1, 100_000))
USER = SimpleNamespace(id=1, tenant_id=1)


def _in(text, kind="text"):
    return InboundMessage(phone="549383", wa_id=f"S{next(_seq)}", kind=kind, text=text)


async def _say(db, text, user=USER):
    replies = await wa_bot.handle(db, user, _in(text))
    return replies[0]


async def _cat(db, name):
    cat = ExpenseCategory(tenant_id=1, name=name, color="#000000", is_fixed=False)
    db.add(cat)
    await db.flush()
    return cat


async def _person(db):
    """El titular y su hogar, con nombre: lo que necesitan el comprobante a su
    nombre y compartir."""
    db.add(Tenant(id=1, name="Casa", code="CASA0001"))
    user = User(
        id=1, firebase_uid="u1", tenant_id=1, email="a@example.com", role=UserRole.admin,
        first_name="Ana", last_name="Gómez", display_name="Ana María Gómez", whatsapp_notifications=True,
    )
    db.add(user)
    await db.flush()
    return user


async def _card(db, alias="Visa Galicia", last4="4919", bank="Galicia"):
    card = CreditCard(tenant_id=1, user_id=1, bank=bank, alias=alias, last_4_digits=last4)
    db.add(card)
    await db.flush()
    return card


@pytest.fixture
def pdf(monkeypatch):
    """Un PDF cuyo texto es lo que diga cada test."""
    state = SimpleNamespace(text="")

    async def _download(_key, _raw=None):
        return b"%PDF-1.4"

    monkeypatch.setattr(whatsapp, "download_media_base64", _download)
    monkeypatch.setattr(parser_common, "extract_pages_text", lambda _src: [state.text])
    monkeypatch.setattr(statement_parsers, "extract_pages_text", lambda _src: [state.text])
    from app.services import pdf_unlock

    monkeypatch.setattr(pdf_unlock, "needs_password", lambda _data: False)
    return state


@pytest.fixture
def ai(monkeypatch):
    """La IA de texto, con lo que el test diga que contestó."""
    state = SimpleNamespace(intent=None, calls=[])

    async def _interpret(text, **kwargs):
        state.calls.append((text, kwargs))
        return state.intent

    monkeypatch.setattr(ai_capture, "enabled", lambda: True)
    monkeypatch.setattr(ai_capture, "interpret_text", _interpret)
    return state


# ------------------------------------------------------------- "22mil" ---

async def test_mil_pegado_no_es_veintidos_pesos(db):
    await _cat(db, "Comida")
    reply = await _say(db, "Gaste 22mil en carne")
    assert "$22.000" in reply and "*carne*" in reply
    assert "Gaste" not in reply


@pytest.mark.parametrize("text,amount,term", [
    ("22 mil carne", "22000", "carne"),
    ("Gaste 22000 en carne", "22000", "carne"),
    ("gasté 1,5 palos en el auto", "1500000", "auto"),
    ("1.5 lucas kiosco", "1500", "kiosco"),
    ("2 kilos de carne 15000", "15000", "2 kilos de carne"),
    ("compré 12 coca a 18 lucas", "18000", "12 coca"),
    ("15000 kiosco 24", "15000", "kiosco 24"),
    ("pagué 5000 a juan", "5000", "juan"),
])
def test_que_numero_es_la_plata(text, amount, term):
    draft = quick_capture.parse_quick_text(text)
    assert draft.amount == Decimal(amount)
    assert draft.term == term


def test_dos_numeros_parecidos_quedan_en_duda():
    assert quick_capture.parse_quick_text("3000 cosas 2000").uncertain
    assert not quick_capture.parse_quick_text("15000 kiosco 24").uncertain


# ----------------------------------------------------- categoría que falta ---

async def test_una_categoria_que_no_existe_se_crea_al_contestar(db):
    await _cat(db, "Comida")
    await _say(db, "6070 ramiro inventado")
    reply = await _say(db, "Limpieza")
    assert "✅ $6.070" in reply and "Limpieza (categoría nueva)" in reply
    assert await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Limpieza"))
    assert (await db.scalar(select(ExpenseEntry))).amount == Decimal("6070")


async def test_crea_una_categoria_nueva_que_se_llame(db):
    await _cat(db, "Comida")
    await _say(db, "6070 ramiro inventado")
    reply = await _say(db, "Crea una categoría nueva que se llame Limpieza")
    assert "✅ $6.070" in reply and "Limpieza" in reply


async def test_crear_categoria_sin_ninguna_pregunta_abierta(db):
    reply = await _say(db, "creá una categoría Mascotas")
    assert "Mascotas" in reply
    assert await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Mascotas"))


async def test_una_frase_no_crea_una_categoria_y_se_repite_la_pregunta(db):
    await _cat(db, "Comida")
    question = await _say(db, "6070 ramiro inventado")
    reply = await _say(db, "la verdad es que no se me ocurre bien cual poner aca")
    assert question in reply
    assert (await db.scalar(select(func.count(ExpenseCategory.id)))) == 1
    assert (await db.scalar(select(ExpenseEntry))) is None
    # Y sigue abierta: se puede contestar.
    assert (await _say(db, "1")).startswith("✅ $6.070")


async def test_opciones_por_uso_sin_repetidas_ni_dolares(db):
    await _cat(db, "Jardin")
    await _cat(db, "Internet")
    await _cat(db, "Internet")
    await _cat(db, "Consumo en dólares")
    comida = await _cat(db, "Comida")
    for _ in range(3):
        db.add(ExpenseEntry(
            tenant_id=1, user_id=1, category_id=comida.id, amount=Decimal(1), description="x",
            expense_date=ar_today(), currency="ARS",
        ))
    await db.flush()
    reply = await _say(db, "5000 zzz qqq")
    assert "\n1. Comida\n" in reply
    assert reply.count("Internet") == 1
    assert "dólares" not in reply


async def test_deshacer_con_una_pregunta_abierta_no_borra_lo_anterior(db):
    await _cat(db, "Kiosco")
    await _say(db, "5000 kiosco")
    await _say(db, "9000 zzz qqq")
    assert "no lo cargo" in await _say(db, "Deshacer")
    assert (await db.scalar(select(func.count(ExpenseEntry.id)))) == 1


# ------------------------------------------------------- tarjeta por chat ---

async def test_con_la_tarjeta_va_al_resumen_y_no_como_gasto_comun(db):
    await _cat(db, "Supermercado")
    card = await _card(db)
    await _card(db, alias="Master BBVA", last4="1111", bank="BBVA")
    await _say(db, "Gaste 20782,02 supermami con la tarjeta visa 4919")
    reply = await _say(db, "Supermercado")
    assert reply.startswith("✅ $20.782,02 en supermami, con la *Visa Galicia 4919*")
    assert "resumen de" in reply
    item = await db.scalar(select(CreditCardItem))
    assert item.amount == Decimal("20782.02") and item.capture_source == "whatsapp"
    stmt = await db.get(CreditCardStatement, item.statement_id)
    assert stmt.card_id == card.id
    # El espejo es el de la tarjeta, no un gasto suelto.
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.payment_method == "tarjeta_credito"
    assert "saqué" in await _say(db, "deshacer")
    assert (await db.scalar(select(CreditCardItem))) is None


async def test_varias_tarjetas_pregunta_cual_y_acepta_el_nombre(db):
    await _cat(db, "Nafta")
    await _card(db)
    await _card(db, alias="Master BBVA", last4="1111", bank="BBVA")
    await _say(db, "30 lucas nafta categoría Nafta con tarjeta")
    # Con categoría nombrada no pregunta eso, pregunta sólo la tarjeta.
    reply = await _say(db, "bbva")
    assert "con la *Master BBVA" in reply


async def test_sin_tarjetas_no_se_pierde_el_gasto(db):
    await _cat(db, "Nafta")
    reply = await _say(db, "30 lucas nafta categoría Nafta con la visa")
    assert "no tenés tarjetas" in reply
    saved = await _say(db, "1")
    assert saved.startswith("✅ $30.000")
    assert (await db.scalar(select(ExpenseEntry))).payment_method is None


async def test_cuotas_propaga_el_plan(db):
    await _cat(db, "Hogar")
    await _card(db, alias="Visa", last4="4919", bank="Galicia")
    reply = await _say(db, "60 lucas en 3 cuotas heladera categoría Hogar con la visa")
    assert "3 cuotas de $20.000" in reply
    items = (await db.scalars(select(CreditCardItem))).all()
    assert len(items) == 3 and all(i.amount == Decimal("20000") for i in items)


async def test_el_cierre_conocido_decide_el_resumen(db):
    await _cat(db, "Hogar")
    card = await _card(db, alias="Visa", last4="4919")
    today = ar_today()
    closing = today + timedelta(days=3)
    db.add(CreditCardStatement(tenant_id=1, card_id=card.id, year=closing.year, month=closing.month, closing_date=closing, status="open"))
    await db.flush()
    await _say(db, "5 lucas pan categoría Hogar con la visa")
    item = await db.scalar(select(CreditCardItem))
    stmt = await db.get(CreditCardStatement, item.statement_id)
    assert stmt.closing_date == closing


# ----------------------------------------------------- comprobante a tu nombre ---

async def test_un_comprobante_a_tu_nombre_no_es_un_gasto(db, pdf):
    await _person(db)
    await _cat(db, "Comida")
    pdf.text = "Comprobante de transferencia\nPara: Ana Gomez\nCBU 123\n$ 100.000,00"
    replies = await wa_bot.handle(db, await db.get(User, 1), _in("", kind="pdf"))
    assert "está a tu nombre" in replies[0]
    assert (await db.scalar(select(ExpenseEntry))) is None
    # "Me entró": es un ingreso.
    db.add(IncomeSource(tenant_id=1, name="Otros", income_type=IncomeType.other))
    await db.flush()
    question = await _say(db, "1", await db.get(User, 1))
    assert "$100.000" in question and "fuente" in question
    saved = await _say(db, "Otros", await db.get(User, 1))
    assert saved.startswith("✅ Ingreso de $100.000")
    assert (await db.scalar(select(ExpenseEntry))) is None


async def test_un_comprobante_a_otra_persona_sigue_siendo_un_gasto(db, pdf):
    await _person(db)
    await _cat(db, "Comida")
    pdf.text = "Comprobante de transferencia\nPara: Ana Pérez\nCBU 123\n$ 5.000,00"
    replies = await wa_bot.handle(db, await db.get(User, 1), _in("", kind="pdf"))
    assert "a tu nombre" not in replies[0]


# ------------------------------------------------------ ingresos en una frase ---

async def test_quiero_registrar_un_ingreso_con_todo_dicho(db):
    reply = await _say(db, "Quiero registrar un ingreso de 100000 categoría otros descripción zapatero")
    assert reply.startswith("✅ Ingreso de $100.000 en otros")
    entry = await db.scalar(select(IncomeEntry))
    assert entry.notes == "zapatero"
    assert (await db.scalar(select(ExpenseEntry))) is None


async def test_no_es_un_gasto_es_un_ingreso(db):
    await _cat(db, "Comida")
    await _say(db, "5000 comida")
    db.add(IncomeSource(tenant_id=1, name="Otros", income_type=IncomeType.other))
    await db.flush()
    reply = await _say(db, "no es un gasto, es un ingreso")
    assert "$5.000" in reply and "fuente" in reply
    assert (await db.scalar(select(ExpenseEntry))) is None


# --------------------------------------------- lo que se escribe junto al archivo ---

async def test_la_fecha_y_el_ingreso_del_comentario_se_respetan(db, pdf):
    db.add(IncomeSource(tenant_id=1, name="Empleo", income_type=IncomeType.salary))
    await db.flush()
    when = ar_today() - timedelta(days=2)
    pdf.text = "Comprobante de transferencia\nPara: Comercio Uno\nCBU 1\n$ 36.000,00"
    inbound = _in(f"Podemos registrar este ingreso con fecha {when:%d/%m/%Y}?", kind="pdf")
    question = (await wa_bot.handle(db, USER, inbound))[0]
    assert "$36.000" in question and "fuente" in question
    await _say(db, "Empleo")
    assert (await db.scalar(select(IncomeEntry))).period_date == when


async def test_el_comentario_de_una_foto_es_la_descripcion(db, pdf, monkeypatch):
    from app.services.ai_capture import AiReading

    comida = await _cat(db, "Comida")

    async def _read(_data, **_kw):
        return AiReading(
            kind="gasto", amount=Decimal(13000), currency="ARS", receipt_date=None,
            merchant="Comercio Dos", payment_method="transferencia", category="Comida",
        )

    monkeypatch.setattr(ai_capture, "enabled", lambda: True)
    monkeypatch.setattr(ai_capture, "read_receipt", _read)
    reply = (await wa_bot.handle(db, USER, _in("Verdulería", kind="image")))[0]
    assert "en Verdulería" in reply
    assert "contame qué fue" not in reply  # ya lo dijo
    assert (await db.scalar(select(ExpenseEntry))).category_id == comida.id


# ----------------------------------------------------- lo que se repite se aprende ---

async def test_la_misma_descripcion_dos_veces_queda_para_ese_comercio(db):
    comida = await _cat(db, "Comida")
    for _ in range(2):
        await _say(db, "3 lucas cafe inventado")
        await _say(db, "Comida") if comida and _ == 0 else None
        await _say(db, "Desayuno")
    reply = await _say(db, "4 lucas cafe inventado")
    assert "en Desayuno" in reply
    assert "contame qué fue" not in reply


# ------------------------------------------------------------- como una persona ---

async def test_saludar_no_cierra_la_pregunta_abierta(db):
    await _cat(db, "Comida")
    await _say(db, "6070 ramiro inventado")
    assert await _say(db, "gracias") == "De nada."
    assert (await _say(db, "Comida")).startswith("✅ $6.070")


async def test_la_respuesta_guardada_no_cierra_la_pregunta(db):
    await _cat(db, "Comida")
    mark = await wa_bot.memory_mark(db, 1)
    question = await _say(db, "6070 ramiro inventado")
    await wa_bot.link_replies(db, 1, mark, ["BOT1"], [question, "Otro texto"])
    assert (await _say(db, "Comida")).startswith("✅ $6.070")


async def test_agradecer_no_es_un_error(db):
    assert await _say(db, "gracias!") == "De nada."
    assert "Contame" in await _say(db, "hola")
    assert "gasté 12 lucas" in await _say(db, "qué podés hacer?")
    assert (await db.scalar(select(ExpenseEntry))) is None


async def test_puedo_cambiar_de_categoria(db):
    await _cat(db, "Comida")
    await _cat(db, "Hogar")
    await _say(db, "5000 comida")
    assert await _say(db, "Puedo cambiar de categoría?") == "Sí, ¿a cuál?"
    assert "a Hogar" in await _say(db, "Hogar")


async def test_este_es_un_reintegro(db):
    db.add(IncomeSource(tenant_id=1, name="Empleo", income_type=IncomeType.salary))
    db.add(IncomeSource(tenant_id=1, name="Reintegros", income_type=IncomeType.other))
    await db.flush()
    await _say(db, "cobré 36 lucas empleo")
    reply = await _say(db, "Este es un reintegro")
    assert "a Reintegros" in reply


async def test_cambiar_la_fecha(db):
    await _cat(db, "Comida")
    await _say(db, "5000 comida")
    when = ar_today() - timedelta(days=3)
    assert when.strftime("%d/%m") in await _say(db, f"cambiar fecha {when:%d/%m}")
    assert (await db.scalar(select(ExpenseEntry))).expense_date == when


async def test_un_monto_solo_pregunta_en_que(db):
    await _cat(db, "Comida")
    assert await _say(db, "5000") == "¿$5.000 en qué?"
    assert (await _say(db, "comida")).startswith("✅ $5.000")


async def test_el_tono(db):
    """Las reglas de cómo suena el bot, en los textos que más se leen."""
    await _cat(db, "Comida")
    for reply in [await _say(db, "5000 comida"), await _say(db, "9000 zzz qqq"), wa_bot.MSG_HELP, wa_bot.MSG_CAN_DO]:
        assert "—" not in reply
        assert "1️⃣" not in reply
        assert ",00" not in reply


# ------------------------------------------------------------------ compartir ---

async def test_compartir_pregunta_antes_de_avisarle_a_nadie(db, monkeypatch):
    user = await _person(db)
    await _cat(db, "Comida")
    db.add(User(id=2, firebase_uid="u2", tenant_id=1, email="j@example.com", role=UserRole.member,
                first_name="Juan", last_name="Díaz", display_name="Juan Díaz"))
    await db.flush()
    sent = []

    async def _notify(_db, **kw):
        sent.append(kw)

    monkeypatch.setattr(notify_shared, "notify_share", _notify)
    reply = await _say(db, "gasté 30 lucas en comida a medias con juan", user)
    assert "Vos: $15.000" in reply and "Juan Díaz: $15.000" in reply and "\n1. Dale" in reply
    assert (await db.scalar(select(SharedExpense))) is None and not sent

    saved = await _say(db, "dale", user)
    assert saved.startswith("✅ $30.000") and "Te toca $15.000" in saved
    shared = await db.scalar(select(SharedExpense))
    splits = (await db.scalars(select(SharedExpenseSplit))).all()
    assert shared.total_amount == Decimal(30000) and sum(s.amount for s in splits) == Decimal(30000)
    assert len(sent) == 1


async def test_compartir_cancelado_no_carga_ni_avisa(db, monkeypatch):
    user = await _person(db)
    await _cat(db, "Comida")
    db.add(SharedContact(tenant_id=1, display_name="Juan Díaz", contact_phone="+5493511111111", person_key="p:1", use_count=1))
    await db.flush()
    sent = []

    async def _notify(_db, **kw):
        sent.append(kw)

    monkeypatch.setattr(notify_shared, "notify_share", _notify)
    await _say(db, "gasté 30 lucas en comida a medias con juan", user)
    assert "no lo cargo" in await _say(db, "2", user)
    assert (await db.scalar(select(SharedExpense))) is None and not sent


async def test_compartir_con_alguien_desconocido_pide_el_contacto(db, monkeypatch):
    user = await _person(db)
    await _cat(db, "Comida")

    async def _notify(_db, **_kw):
        return None

    monkeypatch.setattr(notify_shared, "notify_share", _notify)
    reply = await _say(db, "gasté 30 lucas en comida a medias con pedro", user)
    assert "No tengo a *pedro*" in reply
    reply = await _say(db, "pedro@example.com", user)
    assert "pedro: $15.000" in reply
    assert "compartido" in await _say(db, "1", user)


# ------------------------------------------------------------- IA para el texto ---

def _intent(action, **kw):
    return ai_capture.TextIntent(action=action, **kw)


async def test_ia_entiende_una_frase_y_carga_por_el_camino_de_siempre(db, ai):
    await _cat(db, "Comida")
    ai.intent = _intent("gasto", amount=Decimal(22000), term="carnicería", category="Comida")
    reply = await _say(db, "che anotame lo de la carnicería que fueron veintidós mil")
    assert reply.startswith("✅ $22.000 en carnicería")
    assert (await db.scalar(select(ExpenseEntry))).amount == Decimal(22000)
    assert "$22.000" not in ai.calls[0][0]
    case = await db.scalar(select(BotCase).where(BotCase.kind == "text_ai"))
    assert case.resolution["action"] == "gasto" and "carniceria" not in case.shape


async def test_ia_sin_monto_pregunta_y_no_carga(db, ai):
    ai.intent = _intent("gasto", term="carnicería")
    reply = await _say(db, "anotame lo de la carnicería")
    assert "¿Cuánto fue?" in reply
    assert (await db.scalar(select(ExpenseEntry))) is None


async def test_ia_consulta_queda_afuera(db, ai):
    ai.intent = _intent("fuera_de_alcance")
    assert "sólo anoto" in await _say(db, "cuánto gasté el mes pasado en comida?")


async def test_ia_charla_contesta_lo_que_redacto(db, ai):
    ai.intent = _intent("charla", reply="Anoto gastos e ingresos.")
    assert await _say(db, "para que servis vos") == "Anoto gastos e ingresos."


async def test_ia_contesta_la_pregunta_abierta(db, ai):
    await _cat(db, "Comida")
    await _say(db, "5000 zzz qqq")
    ai.intent = _intent("responder", value="Comida")
    reply = await _say(db, "ponele la primera que dijiste y listo che, gracias eh")
    assert reply.startswith("✅ $5.000")
    assert ai.calls[0][1]["question"]


async def test_ia_no_entiende_cae_a_la_ayuda_y_queda_registrado(db, ai):
    ai.intent = _intent("no_entiendo")
    reply = await _say(db, "asdf qwer")
    assert reply.startswith("No te entendí")
    assert (await db.scalar(select(func.count(ExpenseEntry.id)))) == 0
    assert await db.scalar(select(BotCase).where(BotCase.kind == "text_unresolved"))


async def test_ia_apagada_contesta_como_siempre(db):
    assert (await _say(db, "asdf qwer")).startswith("No te entendí")


def test_el_modelo_no_puede_sacar_una_accion_de_la_lista():
    from datetime import date

    intent = ai_capture.parse_intent({"action": "borrar_todo", "amount": -5}, date(2026, 11, 3))
    assert intent.action == "no_entiendo" and intent.amount is None


# ---------------------------------------------------------- resumen sin parser ---

_RAW_STATEMENT = {
    "is_statement": True, "bank": "Banco Inventado", "card_label": "Visa", "cardholder": "Ana",
    "closing_date": "2026-10-28", "due_date": "2026-11-10", "next_closing_date": "", "next_due_date": "",
    "total_ars": 15000.5, "total_usd": 0,
    "items": [
        {"date": "2026-10-05", "description": "SUPER UNO", "coupon": "12", "amount": 10000.5, "currency": "ARS",
         "installment_number": 0, "installment_count": 0},
        {"date": "2026-10-06", "description": "TIENDA", "coupon": "", "amount": 5000, "currency": "ARS",
         "installment_number": 2, "installment_count": 6},
    ],
}
_PDF_TEXT = "BANCO INVENTADO\nTOTAL CONSUMOS 15.000,50\n"


def test_un_total_que_no_esta_en_el_pdf_no_se_acepta():
    assert ai_capture.build_statement_data(_RAW_STATEMENT, "OTRO TEXTO 999,99") is None
    assert ai_capture.build_statement_data(_RAW_STATEMENT, "") is None
    data = ai_capture.build_statement_data(_RAW_STATEMENT, _PDF_TEXT)
    assert data["year"] == 2026 and data["month"] == 10
    items = data["statements"][0]["items"]
    assert items[1]["item_type"] == "installment" and items[1]["installment_number"] == 2


async def test_un_banco_desconocido_se_lee_con_ia_y_pasa_por_el_motor(db, pdf, monkeypatch):
    await _card(db, alias="Visa", last4="4919", bank="Banco Inventado")
    await _cat(db, "Comida")

    async def _read_receipt(_data, **_kw):
        return ai_capture.AiReading(
            kind=ai_capture.KIND_STATEMENT, amount=None, currency="ARS", receipt_date=None,
            merchant="", payment_method="desconocido", category="",
        )

    async def _read_statement(_data, text):
        return ai_capture.build_statement_data(_RAW_STATEMENT, text), 900

    async def _suggest(_descriptions, _categories):
        return {}

    monkeypatch.setattr(ai_capture, "enabled", lambda: True)
    monkeypatch.setattr(ai_capture, "read_receipt", _read_receipt)
    monkeypatch.setattr(ai_capture, "read_statement", _read_statement)
    monkeypatch.setattr(ai_capture, "suggest_categories", _suggest)
    pdf.text = _PDF_TEXT
    reply = (await wa_bot.handle(db, USER, _in("", kind="pdf")))[0]
    assert "lo leí con IA" in reply and "plan Pro" not in reply
    sessions = (await db.scalars(select(ReconciliationSession))).all()
    assert len(sessions) == 1 and sessions[0].bank_id.startswith("ai:")
    assert await db.scalar(select(BotCase).where(BotCase.kind == "statement_ai"))


async def test_si_la_ia_tampoco_puede_no_ofrece_un_plan(db, pdf, monkeypatch):
    async def _read_receipt(_data, **_kw):
        return None

    async def _read_statement(_data, _text):
        return None

    monkeypatch.setattr(ai_capture, "enabled", lambda: True)
    monkeypatch.setattr(ai_capture, "read_receipt", _read_receipt)
    monkeypatch.setattr(ai_capture, "read_statement", _read_statement)
    pdf.text = "ALGO QUE NO ES NADA"
    reply = (await wa_bot.handle(db, USER, _in("", kind="pdf")))[0]
    assert "plan Pro" not in reply and "cargar en la app" in reply


# ------------------------------------------------------------- lo que queda guardado ---

def test_la_forma_no_deja_leer_nombres_ni_numeros():
    shape = bot_cases.mask("Pagué 22.500 a Ramiro Inventado, CUIT 20-11111111-1, Comprobante de pago")
    assert "ramiro" not in shape and "inventado" not in shape and "11111111" not in shape
    assert "comprobante de pago" in shape and "cuit" in shape


async def test_los_casos_iguales_se_cuentan_juntos(db):
    await bot_cases.record(db, bot_cases.KIND_TEXT_UNRESOLVED, "asdf 100")
    await bot_cases.record(db, bot_cases.KIND_TEXT_UNRESOLVED, "qwer 200")
    rows = (await db.scalars(select(BotCase))).all()
    assert len(rows) == 1 and rows[0].count == 2


async def test_deshacer_enseguida_es_una_senal(db):
    await _cat(db, "Comida")
    await _say(db, "5000 comida")
    await _say(db, "deshacer")
    assert await db.scalar(select(BotCase).where(BotCase.kind == "undone"))


async def test_se_guarda_lo_que_se_contesto_sin_el_token_del_link(db):
    mark = await wa_bot.memory_mark(db, 1)
    await wa_bot.link_replies(db, 1, mark, [None], ["Mirá acá: https://x/y?wat=wat_secreto123"])
    row = await db.scalar(select(WaMessage).where(WaMessage.direction == "out"))
    assert "secreto" not in row.text and "wat=•••" in row.text


# ---------------------------------------------------------------- audios ---
@pytest.fixture
def audio(monkeypatch):
    """El servicio y Evolution, de mentira: `said` es lo que "se escuchó"."""
    state = SimpleNamespace(said="", downloads=0)

    async def download(_key, _raw=None):
        state.downloads += 1
        return b"ogg"

    async def transcribe(_data):
        return state.said

    monkeypatch.setattr(wa_bot.settings, "WHISPER_URL", "http://whisper")
    monkeypatch.setattr(wa_bot.transcribe, "transcribe", transcribe)
    monkeypatch.setattr(whatsapp, "download_media_base64", download)
    rate_limit._hits.clear()
    return state


def _audio(seconds=5):
    return InboundMessage(
        phone="549383", wa_id=f"S{next(_seq)}", kind="audio", media_key={"id": "x"}, media_seconds=seconds,
    )


async def test_audio_loads_expense_and_says_how_to_undo(db, audio):
    await _cat(db, "Comida")
    audio.said = "22 lucas en comida"
    replies = await wa_bot.handle(db, USER, _audio())
    assert len(replies) == 1
    assert replies[0].startswith("✅ $22.000")
    assert "deshacer" in replies[0]
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == Decimal("22000")


async def test_audio_answers_the_open_question(db, audio):
    await _cat(db, "Comida")
    await _cat(db, "Hogar")
    question = await _say(db, "22 lucas en la feria")
    assert "1. " in question
    assert await db.scalar(select(func.count()).select_from(ExpenseEntry)) == 0
    audio.said = "1"
    replies = await wa_bot.handle(db, USER, _audio())
    assert replies[0].startswith("✅")
    assert await db.scalar(select(func.count()).select_from(ExpenseEntry)) == 1


async def test_failed_audio_keeps_the_question_open(db, audio):
    await _cat(db, "Comida")
    await _cat(db, "Hogar")
    await _say(db, "22 lucas en la feria")
    audio.said = None
    replies = await wa_bot.handle(db, USER, _audio())
    assert replies == [wa_bot.MSG_AUDIO_DOWN]
    assert await wa_bot._open_pending(db, USER.id) is not None
    assert (await _say(db, "1")).startswith("✅")


async def test_audio_retry_is_not_loaded_twice(db, audio):
    await _cat(db, "Comida")
    audio.said = "22 lucas en comida"
    message = _audio()
    await wa_bot.handle(db, USER, message)
    assert await wa_bot.already_seen(db, USER.id, message.wa_id)
    assert await db.scalar(select(func.count()).select_from(ExpenseEntry)) == 1


async def test_undo_after_audio_removes_the_expense(db, audio):
    await _cat(db, "Comida")
    audio.said = "22 lucas en comida"
    await wa_bot.handle(db, USER, _audio())
    await _say(db, "deshacer")
    assert await db.scalar(select(func.count()).select_from(ExpenseEntry)) == 0


async def test_listening_sticker_goes_out_before_transcribing(db, audio, monkeypatch):
    order = []

    async def sticker(_phone, url):
        order.append(url.rsplit("/", 1)[1])

    async def transcribe(_data):
        order.append("transcribe")
        return ""

    monkeypatch.setattr(whatsapp, "send_wa_sticker", sticker)
    monkeypatch.setattr(wa_bot.transcribe, "transcribe", transcribe)
    await wa_bot.handle(db, USER, _audio())
    assert order == ["sticker-escuchando.webp", "transcribe"]


async def test_long_audio_is_not_even_downloaded(db, audio):
    replies = await wa_bot.handle(db, USER, _audio(seconds=600))
    assert "muy largo" in replies[0]
    assert audio.downloads == 0


async def test_audio_daily_limit(db, audio, monkeypatch):
    monkeypatch.setattr(wa_bot.settings, "WA_AUDIO_DAILY_LIMIT", 1)
    audio.said = ""
    await wa_bot.handle(db, USER, _audio())
    assert await wa_bot.handle(db, USER, _audio()) == [wa_bot.MSG_AUDIO_LIMIT]
    assert audio.downloads == 1


async def test_silence_asks_again(db, audio):
    audio.said = ""
    assert await wa_bot.handle(db, USER, _audio()) == [wa_bot.MSG_AUDIO_EMPTY]


async def test_without_service_keeps_the_old_answer(db, audio, monkeypatch):
    monkeypatch.setattr(wa_bot.settings, "WHISPER_URL", "")
    assert await wa_bot.handle(db, USER, _audio()) == [wa_bot.MSG_NEEDS_AI_AUDIO]


async def test_audio_seconds_come_from_the_payload():
    payload = {"data": {"key": {"remoteJid": "549383@s.whatsapp.net", "id": "A"}, "message": {"audioMessage": {"seconds": 12}}}}
    message = wa_bot.parse_evolution_payload(payload)
    assert message.kind == "audio"
    assert message.media_seconds == 12


@pytest.mark.parametrize("heard,expected", [
    ("Gasté 22 lucas en carne.", "Gasté 22 lucas en carne"),
    ("Uno.", "1"),
    ("  dos  ", "2"),
    ("Subtítulos realizados por la comunidad", ""),
    ("", ""),
])
def test_clean_transcript(heard, expected):
    assert wa_transcribe.clean(heard) == expected


# ------------------------------------------ la semana del 03/11, con audios ---
async def _source(db, name):
    source = IncomeSource(tenant_id=1, name=name, income_type=IncomeType.other)
    db.add(source)
    await db.flush()
    return source


async def _count(db, model):
    return await db.scalar(select(func.count()).select_from(model))


@pytest.mark.parametrize("text", ["Me reintegraron 780 pesos", "780 reintegro", "recibí un reintegro de 780 pesos"])
async def test_a_refund_is_income_not_expense(db, text):
    await _cat(db, "Comida")
    await _source(db, "Reintegros")
    reply = await _say(db, text)
    assert reply.startswith("✅ Ingreso de $780 en Reintegros")
    assert await _count(db, ExpenseEntry) == 0


async def test_paying_a_refund_is_still_an_expense(db):
    await _cat(db, "Varios")
    assert "$3.000" in await _say(db, "pagué el reintegro 3000")
    assert await _count(db, IncomeEntry) == 0


async def test_correcting_during_the_category_question_is_not_the_answer(db):
    """Contenía el nombre de una categoría, y se cargaba ahí como gasto."""
    await _cat(db, "reintegro")
    await _cat(db, "Comida")
    await _source(db, "Reintegros")
    question = await _say(db, "780 en la feria")
    assert "1. " in question
    reply = await _say(db, "Está mal, te digo que recibí un reintegro de 780 pesos")
    assert reply.startswith("✅ Ingreso de $780")
    assert await _count(db, ExpenseEntry) == 0


async def test_esta_mal_alone_cancels_the_open_question(db):
    await _cat(db, "Comida")
    await _cat(db, "Hogar")
    await _say(db, "780 en la feria")
    assert await _say(db, "Está mal") == "Listo, no lo cargo."


@pytest.mark.parametrize("text", ["Me equivoqué, eran 35.000", "eran 35 mil", "no, eran 35 lucas", "perdón, 35000"])
async def test_fixing_the_amount_of_what_was_just_loaded(db, text):
    await _cat(db, "Regalos")
    await _say(db, "35 en regalos")
    reply = await _say(db, text)
    assert reply.startswith("✏️")
    assert await _count(db, ExpenseEntry) == 1
    assert (await db.scalar(select(ExpenseEntry))).amount == Decimal("35000")


async def test_old_expense_is_not_fixed_by_eran(db):
    await _cat(db, "Regalos")
    await _say(db, "35 en regalos")
    rows = (await db.scalars(select(WaMessage))).all()
    for row in rows:
        row.created_at = row.created_at - timedelta(days=2)
    await db.flush()
    await _say(db, "eran 35 mil")
    assert (await db.scalars(select(ExpenseEntry).order_by(ExpenseEntry.id))).first().amount == Decimal("35")


async def test_description_after_changing_the_suggested_category(db):
    """Cambiar la categoría cerraba la oferta, y "Fue descartables" no se entendía."""
    hogar = await _cat(db, "Hogar")
    await _cat(db, "Comida")
    await _say(db, "4 lucas en comida")
    entry = await db.scalar(select(ExpenseEntry))
    db.add(WaMessage(user_id=1, direction="out", kind="text", pending={"type": "description_offer", "entry_id": entry.id}))
    await db.commit()
    assert (await _say(db, "Hogar")).startswith("✏️")
    reply = await _say(db, "Fue descartables")
    assert reply.startswith("✏️")
    await db.refresh(entry)
    assert entry.category_id == hogar.id
    assert entry.description == "descartables"


async def test_fue_fixes_the_description_when_the_offer_is_gone(db):
    await _cat(db, "Comida")
    await _say(db, "4 lucas en comida")
    await _say(db, "eran 5 lucas")
    await _say(db, "fue el almuerzo")
    assert (await db.scalar(select(ExpenseEntry))).description == "el almuerzo"


async def test_category_and_description_in_one_message(db):
    """Así sale de un audio. Antes cambiaba la categoría y se perdía la descripción."""
    servicios = await _cat(db, "Servicios")
    await _cat(db, "Varios")
    await _say(db, "27 lucas en varios")
    replies = await wa_bot.handle(db, USER, _in("Categoría Servicios, Descripción, Gas"))
    assert len(replies) == 2
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.category_id == servicios.id
    assert entry.description == "Gas"


async def test_description_shortcut(db):
    await _cat(db, "Varios")
    await _say(db, "27 lucas en varios")
    await _say(db, "listo")
    await _say(db, "descripción gas")
    assert (await db.scalar(select(ExpenseEntry))).description == "gas"


def test_hice_un_gasto_is_code_not_ai():
    draft = quick_capture.parse_amount_text("Hice un gasto de 10.500 pesos de prueba")
    assert draft.amount == Decimal("10500")
    assert draft.term == "prueba"


async def test_a_small_amount_by_audio_warns_about_the_lost_mil(db, audio):
    await _cat(db, "Regalos")
    audio.said = "Gaste 35 en regalos"
    reply = (await wa_bot.handle(db, USER, _audio()))[0]
    assert "*eran 35 mil*" in reply


async def test_own_name_also_matches_with_an_extra_given_name(db):
    db.add(User(id=1, tenant_id=1, firebase_uid="u1", email="a@b.c", display_name="Ana Pérez",
                first_name="Ana", last_name="Pérez", role=UserRole.admin))
    await db.flush()
    assert await wa_bot._is_own_name(db, USER, "ANA MARIA PEREZ")
    assert not await wa_bot._is_own_name(db, USER, "ANA GOMEZ")
    assert not await wa_bot._is_own_name(db, USER, "ANA")
