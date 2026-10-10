"""Lo que escribe un negocio por WhatsApp → qué pasó (business/capture.py).

Lo que importa de verdad es separar cantidades de plata: el gasto genérico
toma el primer número como monto, y "compré 12 coca a 18 lucas" era un gasto
de $12."""
from decimal import Decimal

import pytest

from app.services.business.capture import display, fmt_qty, parse_amount, parse_business_text

D = Decimal


def _items(intent):
    return [(it.qty, it.term) for it in intent.items]


@pytest.mark.parametrize("text, op, items, amount, method", [
    ("vendí 3 empanadas y 1 coca 6500 efectivo", "sale", [(3, "empanadas"), (1, "coca")], 6500, "efectivo"),
    ("Vendí 3 Empanadas. 4.500 en efectivo.", "sale", [(3, "empanadas")], 4500, "efectivo"),
    ("vendi 3 empanadas $4.500 transferencia", "sale", [(3, "empanadas")], 4500, "transferencia"),
    ("vendí 3 empanadas y una coca 6500", "sale", [(3, "empanadas"), (1, "coca")], 6500, None),
    ("vendí media docena de empanadas 9000", "sale", [(6, "empanadas")], 9000, None),
    ("vendí 1,5 kg de asado 21000", "sale", [(D("1.5"), "asado")], 21000, None),
    ("vendí 2 pollos con papas 18 lucas mp", "sale", [(2, "pollos con papas")], 18000, "mercadopago"),
    ("vendí pollo con papas 18 lucas", "sale", [(1, "pollo con papas")], 18000, None),
    ("vendí 2 milanesas a la napolitana 19 lucas", "sale", [(2, "milanesas a la napolitana")], 19000, None),
    ("vendí 20 porciones", "sale", [(20, "porciones")], None, None),
    ("venta del día 6500", "sale", [], 6500, None),
    ("compré 12 coca a 18 lucas", "purchase", [(12, "coca")], 18000, None),
    ("compré 12 coca 18000", "purchase", [(12, "coca")], 18000, None),
    ("compre 12 coca-cola por 18.000 con mp", "purchase", [(12, "coca-cola")], 18000, "mercadopago"),
    ("compré 24 cocas y 12 aguas a 40 lucas", "purchase", [(24, "cocas"), (12, "aguas")], 40000, None),
    # Los envases no son el producto: "cajas de coca" no matchea "Coca-Cola".
    ("compré 2 cajas de coca 30 lucas", "purchase", [(2, "cajas de coca")], 30000, None),
    ("hice 30 empanadas", "production", [(30, "empanadas")], None, None),
    ("hicimos 30 empanadas y 10 tartas", "production", [(30, "empanadas"), (10, "tartas")], None, None),
    ("quedan 5 coca", "count", [(5, "coca")], None, None),
    ("quedan 0 aguas", "count", [(0, "aguas")], None, None),
])
def test_the_plan_phrases(text, op, items, amount, method):
    intent = parse_business_text(text)
    assert intent is not None and intent.op == op
    assert _items(intent) == [(D(q), t) for q, t in items]
    assert intent.amount == (None if amount is None else D(amount))
    assert intent.method == method


def test_raw_material_with_money_is_an_expense_not_stock():
    # El caso que tiene que seguir siendo un gasto: "12 lucas" es plata.
    intent = parse_business_text("compré 12 lucas de verdura")
    assert (intent.op, intent.amount, intent.term) == ("expense", D(12000), "verdura")
    intent = parse_business_text("pagué la luz 45 lucas")
    assert (intent.op, intent.amount, intent.term) == ("expense", D(45000), "luz")


def test_payments_to_someone():
    for text in ("pagué 80 lucas a juan", "le pagué a juan 80 lucas", "pagué 80 lucas a juan en efectivo"):
        intent = parse_business_text(text)
        assert (intent.op, intent.amount, intent.payee_term) == ("pay", D(80000), "juan"), text
    assert parse_business_text("le pagué a la verdulería 30 lucas").payee_term == "verduleria"


def test_the_daily_close():
    intent = parse_business_text("cierre: 200 lucas efectivo, 150 mp")
    assert intent.op == "close"
    assert intent.counted == {"efectivo": D(200000), "mercadopago": D(150000)}
    # La unidad se dice una vez: "150" sin unidad, al lado de "200 lucas", son miles.
    assert parse_business_text("cierre 200 lucas efectivo 150 mp").counted["mercadopago"] == D(150000)
    assert parse_business_text("cerré con 180000 efectivo y 95000 mp").counted == {
        "efectivo": D(180000), "mercadopago": D(95000),
    }
    # Sin medio de pago es efectivo; las unidades no son plata.
    assert parse_business_text("cierre 350 lucas").counted == {"efectivo": D(350000)}
    assert parse_business_text("cierre 200 lucas efectivo y salieron 40 empanadas").counted == {
        "efectivo": D(200000),
    }
    assert parse_business_text("cierre de ayer 100 lucas efectivo").day_offset == 1


def test_stock_questions():
    for text, term in [("stock coca", "coca"), ("stock", ""), ("¿cuántas cocas hay?", "cocas"),
                       ("cuanto queda de coca?", "coca"), ("queda coca?", "coca")]:
        intent = parse_business_text(text)
        assert (intent.op, intent.term) == ("query", term), text


def test_dates_split_payments_and_each():
    assert parse_business_text("ayer vendí 3 empanadas 4500").day_offset == 1
    split = parse_business_text("vendí 3 empanadas 4500 efectivo y 2000 mp")
    assert split.payments == {"efectivo": D(4500), "mercadopago": D(2000)} and split.amount == D(6500)
    each = parse_business_text("compré 12 coca a 1500 c/u")
    assert each.each and each.amount == D(1500)


def test_quantity_product_and_money_without_a_verb_is_asked():
    intent = parse_business_text("3 empanadas 4500")
    assert (intent.op, _items(intent), intent.amount) == ("ambiguous", [(D(3), "empanadas")], D(4500))


@pytest.mark.parametrize("text", [
    "45 lucas alquiler", "15000 supermercado", "500 nafta", "12 lucas verdu", "hola",
    # En dólares sigue el gasto en USD de siempre.
    "compré 20 usd de insumos", "vendí 3 empanadas 20 dólares",
])
def test_plain_expenses_are_not_business_intents(text):
    assert parse_business_text(text) is None


def test_amount_answers():
    assert parse_amount("6500") == (D(6500), None)
    assert parse_amount("6 lucas mp") == (D(6000), "mercadopago")
    assert parse_amount("$6.500 en efectivo") == (D(6500), "efectivo")
    assert parse_amount("6500 kiosco") == (None, None)  # eso es un gasto nuevo, no una respuesta
    assert parse_amount("dale") == (None, None)


def test_display_keeps_what_the_person_wrote():
    assert display("Hice 30 Budines de pan", "budines de pan") == "Budines de pan"
    assert display("vendí 2 milanesas", "milanesas") == "Milanesas"
    assert fmt_qty(D("6.0")) == "6" and fmt_qty(D("1.5")) == "1,5" and fmt_qty(D(-2)) == "-2"
