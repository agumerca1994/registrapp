"""Del audio de WhatsApp al texto que entiende el bot.

Llama al servicio `whisper/`, que corre en el mismo servidor: la voz no sale a
ningún proveedor. Lo que devuelve sigue por `_handle_text` como cualquier mensaje.

Nunca levanta. None es "el servicio no anduvo" y "" es "no se oyó nada": el bot
contesta distinto, porque en el primer caso no sirve repetir el audio.
"""
from __future__ import annotations

import logging
import re

import httpx

from app.core.config import settings
from app.services.search import fold_text

logger = logging.getLogger(__name__)

# Sobra: con un audio por vez y varios en fila, puede tardar bastante más que uno solo.
TIMEOUT_SECONDS = 180

# Whisper aprendió de videos con subtítulos, y con silencio o ruido inventa estas frases.
_HALLUCINATION_RE = re.compile(
    r"subt[ií]tul|amara\.org|suscr[ií]bete|gracias por ver|m[uú]sica\W*$", re.IGNORECASE
)
_NUMBER_WORDS = {
    "uno": "1", "una": "1", "dos": "2", "tres": "3", "cuatro": "4", "cinco": "5",
    "seis": "6", "siete": "7", "ocho": "8", "nueve": "9",
}


def enabled() -> bool:
    return settings.WA_AUDIO_ENABLED and bool(settings.WHISPER_URL)


def clean(text: str) -> str:
    """Lo escrito a mano y lo transcripto no se parecen en los bordes: Whisper pone
    mayúscula y punto final, y dice "Uno." donde alguien tipearía "1", que es lo
    que esperan las preguntas con opciones."""
    text = " ".join((text or "").split())
    if _HALLUCINATION_RE.search(text):
        return ""
    text = text.rstrip(".").strip()
    return _NUMBER_WORDS.get(fold_text(text), text)


async def transcribe(data: bytes) -> str | None:
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            resp = await client.post(
                f"{settings.WHISPER_URL}/transcribe", content=data,
                headers={"Content-Type": "application/octet-stream"},
            )
        if resp.status_code >= 400:
            logger.warning("Whisper respondió %s", resp.status_code)
            return None
        return clean(resp.json().get("text") or "")
    except Exception as e:
        logger.warning("Whisper no disponible: %s", type(e).__name__)
        return None
