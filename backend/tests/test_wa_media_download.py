"""Bajar el adjunto de un mensaje entrante (whatsapp.download_media_base64)."""
import base64

import httpx

from app.services import whatsapp


class _Evolution:
    """Contesta con los códigos de `statuses`, uno por pedido; después, el archivo."""

    def __init__(self, monkeypatch, statuses):
        self.calls = 0
        real_client = httpx.AsyncClient

        def respond(request):
            self.calls += 1
            if self.calls <= len(statuses):
                return httpx.Response(statuses[self.calls - 1],
                                      json={"response": {"message": ["TypeError: fetch failed"]}})
            return httpx.Response(201, json={"base64": base64.b64encode(b"%PDF-1.4").decode()})

        def client(**kwargs):
            return real_client(transport=httpx.MockTransport(respond), **kwargs)

        monkeypatch.setattr(whatsapp.settings, "EVOLUTION_API_URL", "http://evo")
        monkeypatch.setattr(whatsapp.settings, "EVOLUTION_INSTANCE", "bot")
        monkeypatch.setattr(whatsapp.httpx, "AsyncClient", client)
        monkeypatch.setattr(whatsapp, "MEDIA_RETRY_WAITS", (0, 0, 0))


async def test_a_passing_fetch_failure_is_retried(monkeypatch):
    evo = _Evolution(monkeypatch, [400, 400])
    assert await whatsapp.download_media_base64({"id": "A"}) == b"%PDF-1.4"
    assert evo.calls == 3


async def test_it_gives_up_after_three_attempts(monkeypatch):
    evo = _Evolution(monkeypatch, [400, 500, 400])
    assert await whatsapp.download_media_base64({"id": "A"}) is None
    assert evo.calls == 3


async def test_a_missing_message_is_not_retried(monkeypatch):
    evo = _Evolution(monkeypatch, [404])
    assert await whatsapp.download_media_base64({"id": "A"}) is None
    assert evo.calls == 1
