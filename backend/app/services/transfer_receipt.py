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

# Tiene que parecer un comprobante (grupo A: la acción) de una operación
# (grupo B: la jerga). El grupo A separa transferencias de compras — un pago
# con billetera ("Compraste en…", Personal Pay/MP) es un gasto igual, pero
# no es una transferencia y el medio de pago no debe decir que lo es.
_A_TRANSFER = ("transferiste", "enviaste", "pago enviado", "le enviaste", "transferencia enviada", "comprobante de transferencia")
_A_PURCHASE = ("compraste", "pagaste", "compra realizada", "pago realizado")
_B_HINTS = ("transferencia", "cbu", "cvu", "alias", "operacion", "pago", "monto", "comprobante")

_AMOUNT_RE = re.compile(r"\$\s*([\d.]{1,13}(?:,\d{1,2})?)")
# Centavos en superíndice pegados al monto: la capa de texto de Personal Pay
# (y recibos parecidos) imprime "$3.60000" para $3.600,00. Sin este caso, la
# regex normal lo lee como 360.000 — cien veces el gasto real. El grupo 1
# tiene que ser una agrupación de miles VÁLIDA completa; los dos dígitos que
# sobran son los centavos ("$15.000" liso no matchea: no le sobra nada).
_AMOUNT_SUPERSCRIPT_RE = re.compile(r"\$\s*(\d{1,3}(?:\.\d{3})+)(\d{2})(?!\d)")
# El monto grande estilizado puede perder el "$" en la capa de texto (caso
# real: Personal Pay extrae "3.60000" pelado). Sin el "$" sólo se acepta una
# LÍNEA ENTERA con formato de monto — un CBU o un código de operación no
# tienen puntos de miles, así que no confunden.
_LINE_AMOUNT_SUPER_RE = re.compile(r"^(\d{1,3}(?:\.\d{3})+)(\d{2})$")   # 3.60000 → 3.600,00
_LINE_AMOUNT_RE = re.compile(r"^(\d{1,3}(?:\.\d{3})*,\d{2})$")           # 1.234,56
_LINE_AMOUNT_MILES_RE = re.compile(r"^(\d{1,3}(?:\.\d{3})+)$")            # 15.000
_USD_RE = re.compile(r"(?<!\w)(u\$s|usd|u\$d)(?!\w)", re.IGNORECASE)
_DATE_NUM_RE = re.compile(r"(\d{1,2})[/-](\d{1,2})[/-](\d{4})")
# "5 de octubre de 2026", "05 de Octubre 2026"
_DATE_WORDS_RE = re.compile(
    r"(\d{1,2})\s+de\s+([a-záéíóú]+)(?:\s+de)?\s+(\d{4})", re.IGNORECASE
)
_LABELS = ("para", "destinatario", "beneficiario", "a nombre de", "titular", "nombre")
# Dígitos permitidos adentro: los nombres de comercio los traen ("Kiosco24").
_NAME_RE = re.compile(r"^[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-z0-9ÁÉÍÓÚÑáéíóúñ .'-]{2,59}$")
# El otro formato de contraparte: en la misma frase de la acción
# ("Compraste en X", "Le transferiste a X", "Pagaste a X").
_INLINE_PARTY_RE = re.compile(
    r"(?:compraste en|pagaste a|le transferiste a|le enviaste a|enviaste a|transferiste a)\s+(.{3,60})",
    re.IGNORECASE,
)


@dataclass
class ReceiptDraft:
    amount: Decimal
    currency: str
    receipt_date: date | None
    counterparty: str | None
    kind: str = "transferencia"  # "transferencia" | "pago" (compra con billetera)


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


def _find_counterparty(lines: list[str], full_text: str) -> str | None:
    m = _INLINE_PARTY_RE.search(full_text)
    if m:
        value = m.group(1).strip().rstrip(".")
        if _NAME_RE.match(value):
            return value
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

    is_transfer = any(h in low for h in _A_TRANSFER)
    is_purchase = any(h in low for h in _A_PURCHASE)
    if not ((is_transfer or is_purchase) and any(h in low for h in _B_HINTS)):
        return None

    # Primero los montos con centavos en superíndice, y se tapan sus spans
    # para que la regex normal no los relea mal; después el resto. El monto
    # de la operación es el más grande (comisiones y saldos son menores).
    amounts: list[Decimal] = []
    masked = text
    for m in list(_AMOUNT_SUPERSCRIPT_RE.finditer(text)):
        value = _parse_amount(f"{m.group(1)},{m.group(2)}")
        if value is not None:
            amounts.append(value)
        masked = masked[: m.start()] + " " * (m.end() - m.start()) + masked[m.end():]
    amounts.extend(a for raw in _AMOUNT_RE.findall(masked) if (a := _parse_amount(raw)))
    if not amounts:
        # Sin "$" a la vista: líneas que son un monto y nada más.
        for ln in lines:
            m = _LINE_AMOUNT_SUPER_RE.match(ln)
            if m:
                value = _parse_amount(f"{m.group(1)},{m.group(2)}")
            else:
                m2 = _LINE_AMOUNT_RE.match(ln) or _LINE_AMOUNT_MILES_RE.match(ln)
                value = _parse_amount(m2.group(1)) if m2 else None
            if value is not None:
                amounts.append(value)
    if not amounts:
        return None
    amount = max(amounts)

    currency = "USD" if _USD_RE.search(text) else "ARS"

    return ReceiptDraft(
        amount=amount,
        currency=currency,
        receipt_date=_find_date(text),
        counterparty=_find_counterparty(lines, text),
        kind="transferencia" if is_transfer else "pago",
    )


def diagnose(pages_text: list[str]) -> dict:
    """Por qué (no) matcheó un comprobante: pistas, montos, tamaño. Para el
    log de diagnóstico del bot — datos sobre el match, no el contenido."""
    text = "\n".join(pages_text)
    low = fold_text(text)
    amounts = len(_AMOUNT_RE.findall(text)) + len(_AMOUNT_SUPERSCRIPT_RE.findall(text))
    return {
        "a_transfer": [h for h in _A_TRANSFER if h in low],
        "a_purchase": [h for h in _A_PURCHASE if h in low],
        "b": [h for h in _B_HINTS if h in low],
        "amounts_found": amounts,
        "lines": len([ln for ln in text.split("\n") if ln.strip()]),
        "chars": len(text),
        # Muestra acotada del texto plegado: los metadatos solos no alcanzaron
        # (el caso del "$" perdido se adivinó dos veces antes de verlo).
        "sample": fold_text(text)[:300],
    }
