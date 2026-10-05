"""Parser de comprobantes de transferencia/pago (PDF con texto).

Un comprobante no es un resumen: es un documento de UNA operación — monto,
fecha, destinatario — y su estructura es lo bastante regular entre Mercado
Pago y los bancos como para leerla con heurísticas, sin IA y sin un parser
por emisor (al revés que los resúmenes, donde cada banco necesita el suyo).
Las fotos/capturas siguen yendo al embudo `needs_ai`: OCR sí es IA.

Deliberadamente conservador: si no encuentra un monto claro devuelve None y
el flujo cae al mensaje de "no pude leer" — un comprobante mal leído que
registra un gasto equivocado es peor que preguntar.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from app.services.quick_capture import MAX_AMOUNT
from app.services.search import fold_text
from app.services.statement_parsers.common import MONTHS

# Tiene que parecer un comprobante (grupo A) de una operación (grupo B).
_A_HINTS = ("comprobante", "transferiste", "enviaste", "pago enviado", "le enviaste", "transferencia enviada")
_B_HINTS = ("transferencia", "cbu", "cvu", "alias", "operacion", "pago", "monto")

_AMOUNT_RE = re.compile(r"\$\s*([\d.]{1,13}(?:,\d{1,2})?)")
_USD_RE = re.compile(r"(?<!\w)(u\$s|usd|u\$d)(?!\w)", re.IGNORECASE)
_DATE_NUM_RE = re.compile(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})")
# "5 de octubre de 2026", "05 de Octubre 2026"
_DATE_WORDS_RE = re.compile(
    r"(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de)?\s+(\d{4})", re.IGNORECASE
)
_LABELS = ("para", "destinatario", "beneficiario", "a nombre de", "titular", "nombre")
_NAME_RE = re.compile(r"^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñ .'-]{2,59}$")


@dataclass
class ReceiptDraft:
    amount: Decimal
    currency: str
    receipt_date: date | None
    counterparty: str | None


def _parse_amount(raw: str) -> Decimal | None:
    try:
        if "," in raw:
            value = Decimal(raw.replace(".", "").replace(",", "."))
        else:
            value = Decimal(raw.replace(".", ""))
    except Exception:
        return None
    return value if 0 < value <= MAX_AMOUNT else None


def _find_date(text: str) -> date | None:
    m = _DATE_NUM_RE.search(text)
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            pass
    m = _DATE_WORDS_RE.search(text)
    if m:
        month = MONTHS.get(fold_text(m.group(2))[:3])
        if month:
            try:
                return date(int(m.group(3)), month, int(m.group(1)))
            except ValueError:
                pass
    return None


def _find_counterparty(lines: list[str]) -> str | None:
    for i, line in enumerate(lines):
        folded = fold_text(line)
        for label in _LABELS:
            value = None
            if folded == label and i + 1 < len(lines):
                value = lines[i + 1].strip()
            elif folded.startswith(label + ":"):
                value = line.split(":", 1)[1].strip()
            if value and _NAME_RE.match(value) and fold_text(value) not in _LABELS:
                return value
    return None


def parse_transfer_receipt(pages_text: list[str]) -> ReceiptDraft | None:
    text = "\n".join(pages_text)
    lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
    low = fold_text(text)

    if not (any(h in low for h in _A_HINTS) and any(h in low for h in _B_HINTS)):
        return None

    # El monto de la operación es el más grande del documento: los demás
    # (comisiones, saldos parciales) son menores o cero.
    amounts = [a for raw in _AMOUNT_RE.findall(text) if (a := _parse_amount(raw))]
    if not amounts:
        return None
    amount = max(amounts)

    currency = "USD" if _USD_RE.search(text) else "ARS"

    return ReceiptDraft(
        amount=amount,
        currency=currency,
        receipt_date=_find_date(text),
        counterparty=_find_counterparty(lines),
    )
