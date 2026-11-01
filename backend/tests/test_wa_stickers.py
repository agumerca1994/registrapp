"""Qué sticker manda el bot después de responder (wa_bot.sticker_for)."""
from app.services import wa_bot


def test_a_loaded_expense_or_sale_gets_the_loaded_sticker():
    assert wa_bot.sticker_for(["✅ $12.000 · verdulería · Verdulería"]) == "cargado"
    assert wa_bot.sticker_for(["✅ Venta hoy: 3 empanadas · $4.500 en efectivo"]) == "cargado"


def test_an_income_gets_its_own_sticker():
    assert wa_bot.sticker_for(["✅ Ingreso: $850.000 · Sueldo"]) == "ingreso"


def test_errors_win_over_everything_else():
    assert wa_bot.sticker_for([wa_bot.MSG_ERROR]) == "error"
    assert wa_bot.sticker_for(["✅ $1.000 · algo", "No pude bajar el PDF. Mandalo de nuevo."]) == "error"


def test_not_understood_or_a_question_with_options_is_a_doubt():
    assert wa_bot.sticker_for([wa_bot.MSG_HELP]) == "duda"
    assert wa_bot.sticker_for(["¿En qué categoría lo pongo?\n1. Supermercado\n2. Comida"]) == "duda"


def test_undo_edit_and_queries_get_no_sticker():
    assert wa_bot.sticker_for(["🗑️ Deshecho: $12.000 · verdulería"]) is None
    assert wa_bot.sticker_for(["✏️ Listo: $13.000 · verdulería"]) is None
    assert wa_bot.sticker_for(["📦 Stock:\n• Coca: 5"]) is None
    assert wa_bot.sticker_for([]) is None


def test_the_sticker_url_lives_next_to_the_app():
    url = wa_bot.sticker_url("cargado")
    assert url.endswith("/brand/tood/stickers/sticker-cargado.webp")
