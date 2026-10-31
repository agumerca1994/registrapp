"""Leer un comprobante con IA: la foto de un ticket, la captura de una
transferencia o un PDF que el código no reconoce → un gasto (o, en un hogar,
un ingreso: una transferencia recibida o un recibo de sueldo).

Es la fase de IA del embudo (`capture_events`), y entra sólo donde el código
ya se rindió: un PDF que ningún parser de resúmenes ni `transfer_receipt` lee,
o una imagen, que el código no lee nunca. **La IA sólo lee; no decide ni
escribe.** Devuelve una lectura (monto, moneda, fecha, comercio, medio de
pago, categoría sugerida) y el bot la pasa por el mismo `_capture_draft` que
el texto libre: misma resolución de categoría, misma pregunta si no alcanza,
mismo *deshacer*. Igual que con el conector MCP, una IA que escribiera por su
cuenta sería un segundo camino de carga que puede contradecir al primero.

Una sola llamada con salida estructurada (`output_config.format`): no hace
falta un agente con herramientas para leer un comprobante, y así el resultado
viene validado contra el esquema y no hay texto libre que interpretar.

Nunca levanta excepción: None es "no se pudo leer" y el que llama sigue con
lo de siempre (en un PDF, la conciliación con su mensaje de motivo). El
archivo no se guarda: viaja a la API y se descarta, como el PDF del resumen.
"""
from __future__ import annotations

import base64
import json
import logging
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from app.core.config import settings

logger = logging.getLogger(__name__)

# Lo que la lectura puede decir que es el archivo. "gasto" se carga como
# gasto; "transferencia_recibida" y "recibo_sueldo", como ingreso en un hogar.
KIND_EXPENSE = "gasto"
KIND_INCOMING = "transferencia_recibida"
KIND_PAYSLIP = "recibo_sueldo"
KIND_STATEMENT = "resumen_tarjeta"
KIND_OTHER = "no_es_comprobante"

_FALLBACK_MODELS = {"claude-opus-5-5", "claude-opus-5", "claude-fable-5-1", "claude-sonnet-5-5"}

PAYMENT_METHODS = ("efectivo", "debito", "transferencia", "tarjeta_credito", "desconocido")

_SCHEMA = {
    "type": "object",
    "properties": {
        "kind": {"type": "string", "enum": [KIND_EXPENSE, KIND_INCOMING, KIND_PAYSLIP, KIND_STATEMENT, KIND_OTHER]},
        "amount": {"type": "number"},
        "currency": {"type": "string", "enum": ["ARS", "USD"]},
        "date": {"type": "string"},
        "merchant": {"type": "string"},
        "payment_method": {"type": "string", "enum": list(PAYMENT_METHODS)},
        "category": {"type": "string"},
    },
    "required": ["kind", "amount", "currency", "date", "merchant", "payment_method", "category"],
    "additionalProperties": False,
}

_SYSTEM = """Leés comprobantes de pago para tood, una app de finanzas de un hogar \
o un comercio chico de la Argentina. Te llega UN archivo (foto, captura o PDF) que \
alguien mandó por WhatsApp para registrar un gasto o un ingreso. Devolvé lo que dice el comprobante; \
no inventes nada que no esté escrito.

- kind: "gasto" si es algo que la persona PAGÓ (ticket, factura, comprobante de \
transferencia o de pago enviado, recibo). "transferencia_recibida" si es plata que le \
ENTRÓ (te transfirieron, transferencia recibida, depósito). "recibo_sueldo" si es un \
recibo de sueldo o de haberes. "resumen_tarjeta" si es el resumen \
mensual de una tarjeta de crédito con muchos consumos. "no_es_comprobante" si no es \
ninguna de esas cosas o no se lee.
- amount: el TOTAL pagado, como número con punto decimal (en la Argentina "15.000,50" \
es 15000.50). En un ticket es el total final, no un subtotal ni una línea. En un \
recibo de sueldo es el NETO a cobrar. 0 si no hay.
- currency: "USD" sólo si el monto está en dólares (U$S, USD, US$); si no, "ARS".
- date: la fecha del pago en formato AAAA-MM-DD, o "" si no figura.
- merchant: a quién se le pagó: el comercio, la empresa o la persona destinataria, \
corto y como se lo conoce ("Carrefour", "Juan Pérez", "Edenor"). En una transferencia \
recibida, quién la mandó; en un recibo de sueldo, el empleador. "" si no figura.
- payment_method: "tarjeta_credito" sólo si el comprobante dice que se pagó con \
tarjeta de CRÉDITO; "debito" con tarjeta de débito; "transferencia" si es una \
transferencia o un pago con dinero en cuenta (Mercado Pago, billeteras, QR); \
"efectivo" si lo dice; si no, "desconocido".
- category: el nombre EXACTO de una de las categorías de la lista que te pasan, la que \
mejor le corresponde. "" si ninguna encaja con claridad."""


@dataclass
class AiReading:
    kind: str
    amount: Decimal | None
    currency: str
    receipt_date: date | None
    merchant: str
    payment_method: str
    category: str
    input_tokens: int | None = None


def enabled() -> bool:
    return bool(settings.ANTHROPIC_API_KEY) and settings.WA_AI_ENABLED


def sniff_media_type(data: bytes) -> str | None:
    """El tipo por los primeros bytes: Evolution no siempre manda el mimetype
    y la API rechaza un `media_type` que no coincide con el contenido."""
    if data.startswith(b"%PDF"):
        return "application/pdf"
    if data.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return None


def _content_block(data: bytes, media_type: str) -> dict:
    b64 = base64.standard_b64encode(data).decode("ascii")
    block_type = "document" if media_type == "application/pdf" else "image"
    return {"type": block_type, "source": {"type": "base64", "media_type": media_type, "data": b64}}


def parse_reading(raw: dict, today: date) -> AiReading:
    """La salida del modelo → `AiReading`, con lo que no tiene sentido llevado a
    "no sé": un monto ≤ 0 es None, y una fecha futura o de hace más de un año
    se descarta (el bot usa hoy) — una fecha mal leída es peor que ninguna."""
    try:
        amount = Decimal(str(raw.get("amount") or 0)).quantize(Decimal("0.01"))
    except InvalidOperation:
        amount = Decimal(0)
    try:
        when = date.fromisoformat(raw.get("date") or "")
    except ValueError:
        when = None
    if when is not None and not (today - timedelta(days=366) <= when <= today):
        when = None
    method = raw.get("payment_method")
    return AiReading(
        kind=raw.get("kind") or KIND_OTHER,
        amount=amount if amount > 0 else None,
        currency="USD" if raw.get("currency") == "USD" else "ARS",
        receipt_date=when,
        merchant=(raw.get("merchant") or "").strip()[:120],
        payment_method=method if method in PAYMENT_METHODS else "desconocido",
        category=(raw.get("category") or "").strip(),
    )


async def read_receipt(
    data: bytes, *, categories: list[str], today: date, caption: str = ""
) -> AiReading | None:
    if not enabled():
        return None
    media_type = sniff_media_type(data)
    if media_type is None:
        logger.warning("IA: formato de archivo no reconocido (%d bytes)", len(data))
        return None

    prompt = (
        f"Hoy es {today.isoformat()}.\n"
        f"Categorías: {', '.join(categories) if categories else '(ninguna)'}\n"
        + (f"La persona escribió junto al archivo: {caption}\n" if caption else "")
    )
    answer = await _structured_call(
        _SYSTEM, [_content_block(data, media_type), {"type": "text", "text": prompt}], _SCHEMA,
    )
    if answer is None:
        return None
    raw, input_tokens = answer
    reading = parse_reading(raw, today)
    reading.input_tokens = input_tokens
    return reading


async def _structured_call(system: str, content: list, schema: dict) -> tuple[dict, int | None] | None:
    """Una llamada con salida validada contra `schema` → (json, tokens de
    entrada), o None con un WARNING en el log. Nunca levanta excepción."""
    import anthropic

    # Si el clasificador de seguridad declina (raro con un ticket, pero una
    # foto puede traer cualquier cosa), la API reintenta sola con otro modelo
    # en vez de devolver una negativa. Haiku no lo acepta: ahí va sin.
    fallback = (
        {"betas": ["server-side-fallback-2026-07-01"], "fallbacks": "default"}
        if settings.WA_AI_MODEL in _FALLBACK_MODELS else {}
    )
    client = anthropic.AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY, timeout=90.0, max_retries=1)
    try:
        response = await client.beta.messages.create(
            model=settings.WA_AI_MODEL,
            max_tokens=4096,
            system=system,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": schema}},
            **fallback,
            messages=[{"role": "user", "content": content}],
        )
    except anthropic.APIStatusError as e:
        logger.warning("IA: la API respondió %s: %s", e.status_code, str(e.message)[:300])
        return None
    except anthropic.APIConnectionError as e:
        logger.warning("IA: sin conexión con la API: %s", e)
        return None
    finally:
        await client.close()

    if response.stop_reason in ("refusal", "max_tokens"):
        logger.warning("IA: lectura cortada (%s)", response.stop_reason)
        return None
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        raw = json.loads(text)
    except json.JSONDecodeError:
        logger.warning("IA: la salida no es JSON: %s", text[:200])
        return None
    return raw, getattr(response.usage, "input_tokens", None)


_CATEGORY_SYSTEM = """Clasificás consumos de una tarjeta de crédito de un hogar de la \
Argentina en las categorías que usa ese hogar. Cada consumo viene como lo imprime el \
banco: el nombre del comercio, a veces cortado o con la sucursal ("SHELL AV VELEZ \
SARSFIE", "MERPAGO*KIOSCO", "WWW.FRAVEGA.COM-BNA"). Para cada uno devolvé el nombre \
EXACTO de la categoría que mejor le corresponde, o "" si ninguna encaja con claridad: \
mejor sin categoría que una equivocada."""

MAX_CATEGORY_ITEMS = 80


async def suggest_categories(descriptions: list[str], categories: list[str]) -> dict[int, str]:
    """Categoría sugerida para cada consumo, por posición en `descriptions`:
    {índice: nombre de categoría}. Sólo trae los que la IA pudo ubicar en una
    categoría existente (la salida está atada a la lista: no inventa). Una
    sola llamada para todo el resumen; {} si la IA está apagada o falla."""
    categories = list(dict.fromkeys(c for c in categories if c))
    if not enabled() or not descriptions or not categories:
        return {}
    descriptions = descriptions[:MAX_CATEGORY_ITEMS]
    schema = {
        "type": "object",
        "properties": {
            "items": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "n": {"type": "integer"},
                        "category": {"type": "string", "enum": [*categories, ""]},
                    },
                    "required": ["n", "category"],
                    "additionalProperties": False,
                },
            },
        },
        "required": ["items"],
        "additionalProperties": False,
    }
    listing = "\n".join(f"{i}. {d}" for i, d in enumerate(descriptions))
    prompt = f"Categorías: {', '.join(categories)}\n\nConsumos:\n{listing}"
    answer = await _structured_call(_CATEGORY_SYSTEM, [{"type": "text", "text": prompt}], schema)
    if answer is None:
        return {}
    raw, _tokens = answer
    out: dict[int, str] = {}
    for row in raw.get("items") or []:
        n, cat = row.get("n"), row.get("category")
        if isinstance(n, int) and 0 <= n < len(descriptions) and cat in categories:
            out[n] = cat
    return out
