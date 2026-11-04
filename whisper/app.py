"""Transcribe audios del bot con Whisper, en este mismo servidor.

Un POST con los bytes del audio, una respuesta con el texto. El audio queda en
memoria y no se escribe en disco ni en los logs: este servicio corre en una red
sin salida a internet (`whisper-internal` en docker-compose.prod.yml), así que la
voz no puede salir de acá, y sólo el backend lo alcanza.

De a un audio por vez: el modelo ya usa los núcleos que se le dan, y dos a la vez
tardarían más que uno atrás del otro.
"""
import asyncio
import contextlib
import io
import logging
import os
import time

from faster_whisper import WhisperModel
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

MODEL = os.environ.get("WHISPER_MODEL", "turbo")
THREADS = int(os.environ.get("WHISPER_THREADS", "3"))
MAX_BYTES = 16 * 1024 * 1024
# Le dice cómo se escriben estas palabras: sin esto, "lucas" salía "luchas".
PROMPT = "Anoté 12 lucas de nafta, 15.000 pesos en 3 cuotas con la visa, cobré el sueldo."

logger = logging.getLogger("uvicorn.error")
_model: WhisperModel | None = None
_turn = asyncio.Semaphore(1)


def _run(data: bytes) -> dict:
    started = time.monotonic()
    segments, info = _model.transcribe(
        io.BytesIO(data),
        language="es",
        beam_size=1,
        vad_filter=True,
        condition_on_previous_text=False,
        initial_prompt=PROMPT,
    )
    # `segments` es un generador: la transcripción corre recién acá.
    text = " ".join(s.text.strip() for s in segments).strip()
    return {"text": text, "audio_seconds": round(info.duration, 1), "took_seconds": round(time.monotonic() - started, 1)}


async def transcribe(request: Request) -> JSONResponse:
    data = await request.body()
    if not data or len(data) > MAX_BYTES:
        return JSONResponse({"detail": "audio vacío o demasiado grande"}, status_code=413)
    async with _turn:
        try:
            result = await asyncio.to_thread(_run, data)
        except Exception as e:
            # Sólo el tipo: el mensaje de error podría traer parte del contenido.
            logger.warning("No se pudo transcribir: %s", type(e).__name__)
            return JSONResponse({"detail": "no se pudo leer el audio"}, status_code=422)
    logger.info("Transcripto: %ss de audio en %ss", result["audio_seconds"], result["took_seconds"])
    return JSONResponse(result)


async def health(_: Request) -> JSONResponse:
    return JSONResponse({"status": "ok" if _model else "loading", "model": MODEL}, status_code=200 if _model else 503)


@contextlib.asynccontextmanager
async def lifespan(_: Starlette):
    global _model
    _model = await asyncio.to_thread(
        WhisperModel, MODEL, device="cpu", compute_type="int8", cpu_threads=THREADS, local_files_only=True,
    )
    yield


app = Starlette(
    routes=[Route("/transcribe", transcribe, methods=["POST"]), Route("/health", health)],
    lifespan=lifespan,
)
