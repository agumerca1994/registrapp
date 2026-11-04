"""Qué sticker manda el bot después de responder (wa_bot.sticker_for)."""
import base64
import json

import httpx

from app.services import wa_bot, whatsapp


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


class _Evolution:
    """Evolution y el sitio de mentira: anota qué le mandaron y contesta lo que se le diga."""

    def __init__(self, monkeypatch, sticker_status=200, reject_base64=False):
        self.sent = []
        self.fetches = 0
        real_client = httpx.AsyncClient

        def respond(request):
            if request.method == "GET":
                self.fetches += 1
                return httpx.Response(sticker_status, content=b"RIFF....WEBP")
            if "sendSticker" in str(request.url):
                body = json.loads(request.content)
                self.sent.append(body)
                if reject_base64 and body.get("notConvertSticker"):
                    return httpx.Response(400, json={"message": "no"})
                return httpx.Response(201, json={"key": {"id": "ST1"}})
            return httpx.Response(200, json=[{"exists": True, "number": "549383"}])

        def client(**kwargs):
            return real_client(transport=httpx.MockTransport(respond), **kwargs)

        monkeypatch.setattr(whatsapp.settings, "EVOLUTION_API_URL", "http://evo")
        monkeypatch.setattr(whatsapp.settings, "EVOLUTION_INSTANCE", "bot")
        monkeypatch.setattr(whatsapp.httpx, "AsyncClient", client)
        whatsapp._sticker_cache.clear()


URL = "http://site/sticker-cargado.webp"


async def test_sticker_skips_evolutions_slow_conversion(monkeypatch):
    evo = _Evolution(monkeypatch)
    assert await whatsapp.send_wa_sticker("549383", URL) == "ST1"
    assert evo.sent[0]["notConvertSticker"] is True
    assert evo.sent[0]["sticker"] == base64.b64encode(b"RIFF....WEBP").decode()


async def test_sticker_is_downloaded_only_once(monkeypatch):
    evo = _Evolution(monkeypatch)
    await whatsapp.send_wa_sticker("549383", URL)
    await whatsapp.send_wa_sticker("549383", URL)
    assert evo.fetches == 1


async def test_sticker_falls_back_to_the_url_if_evolution_rejects_it(monkeypatch):
    evo = _Evolution(monkeypatch, reject_base64=True)
    assert await whatsapp.send_wa_sticker("549383", URL) == "ST1"
    assert evo.sent[-1] == {"number": "549383", "sticker": URL}


async def test_sticker_uses_the_url_if_the_site_is_down(monkeypatch):
    evo = _Evolution(monkeypatch, sticker_status=502)
    assert await whatsapp.send_wa_sticker("549383", URL) == "ST1"
    assert evo.sent == [{"number": "549383", "sticker": URL}]
