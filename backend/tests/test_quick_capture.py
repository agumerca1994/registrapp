"""El parser de texto libre del bot: jerga de montos, moneda, fecha, término."""
from datetime import date
from decimal import Decimal

from app.services.quick_capture import parse_quick_text

TODAY = date(2026, 10, 5)


def _p(text):
    return parse_quick_text(text, today=TODAY)


def test_slang_amounts():
    assert _p("12 lucas verdu").amount == Decimal("12000.00")
    assert _p("1,5 palos auto").amount == Decimal("1500000.00")
    assert _p("12k kiosco").amount == Decimal("12000.00")
    assert _p("media docena 2 lucas").amount == Decimal("2000.00")


def test_plain_amounts_argentine_format():
    assert _p("15000 supermercado").amount == Decimal("15000")
    assert _p("1.500.000 depto").amount == Decimal("1500000")
    assert _p("1500,50 farmacia").amount == Decimal("1500.50")


def test_term_is_the_rest_of_the_text():
    d = _p("12 lucas en la verdu")
    assert d.term == "en la verdu"
    d = _p("supermercado dia 15.000")
    assert d.term == "supermercado dia"


def test_currency_usd():
    d = _p("usd 20 regalo")
    assert d.currency == "USD"
    assert d.amount == Decimal("20")
    assert d.term == "regalo"
    assert _p("50 dólares juego").currency == "USD"
    assert _p("15000 supermercado").currency == "ARS"


def test_date_words():
    assert _p("12 lucas taxi ayer").expense_date == date(2026, 10, 4)
    assert _p("12 lucas taxi anteayer").expense_date == date(2026, 10, 3)
    assert _p("12 lucas taxi hoy").expense_date == TODAY
    assert _p("12 lucas taxi").expense_date == TODAY


def test_legacy_format_flag():
    assert _p("15000 supermercado").legacy is True
    assert _p("12 lucas en la verdu").legacy is False
    assert _p("15000 super mercado").legacy is False


def test_unparseable_returns_none():
    assert _p("hola como estas") is None
    assert _p("gasté un montón hoy") is None
    assert _p("15000") is None  # monto sin término
    assert _p("") is None


def test_amount_bounds():
    assert _p("0 kiosco") is None
    assert _p("9999999999 depto") is None
