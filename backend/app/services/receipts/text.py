"""Sacar monto, fecha y contraparte del texto de un comprobante argentino.

No hay un formato: cada billetera y cada banco escribe el suyo, y lo cambian.
Así que esto no parsea una gramática, puntúa candidatos — que es lo que hace
que degrade en vez de romperse cuando aparece un layout nuevo.

Lo que sale bien y lo que no, dicho de frente: **el monto es confiable**, la
fecha bastante, y la **descripción no**. El comercio es texto libre en posición
libre; a veces está etiquetado ("Para:", "Destinatario:") y a veces es una
línea suelta debajo de "Pagaste". Por eso la pantalla siempre pide confirmación
antes de guardar: equivocarse en la descripción cuesta un toque, y el campo que
importa es el que sale bien.
"""
import re
from datetime import date, timedelta

from app.services.receipts.amounts import AMOUNT_RE, MAX_AMOUNT, parse_amount_ar
from app.services.receipts.types import ReceiptDraft

# Palabras que en un comprobante anteceden al importe.
MONEY_HINT_RE = re.compile(
    r"(importe|monto|total|pagaste|pagué|pague|enviaste|envi[aá]ste|transferiste"
    r"|te enviaron|cobraste|valor|\$|u\$s|us\$|usd)",
    re.I,
)

# Palabras que anteceden a un número que NO es plata. Esto es lo que evita
# cargar un gasto de $20.170.099.220 porque el CBU estaba cerca del "$".
NOT_MONEY_HINT_RE = re.compile(
    r"(cbu|cvu|cuit|cuil|dni|alias|c[oó]digo|operaci[oó]n|referencia"
    r"|cup[oó]n|terminada en|n[uú]mero de comprobante|nro\.? de comprobante)",
    re.I,
)

# Una corrida de 10+ dígitos no es un importe: es un CBU (22), un CUIT (11) o
# un número de operación. Se detecta sobre el texto crudo, antes de normalizar.
LONG_DIGIT_RUN_RE = re.compile(r"\d{10,}")

USD_RE = re.compile(r"(u\$s|us\$|usd|d[oó]lar)", re.I)

MONTHS = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6,
    "julio": 7, "agosto": 8, "septiembre": 9, "setiembre": 9, "octubre": 10,
    "noviembre": 11, "diciembre": 12,
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6, "jul": 7,
    "ago": 8, "sep": 9, "set": 9, "oct": 10, "nov": 11, "dic": 12,
}

# Siempre día primero. Un comprobante argentino nunca escribe mm/dd, y asumir
# lo contrario convierte el 3 de agosto en el 8 de marzo sin ninguna señal.
DATE_NUMERIC_RE = re.compile(r"\b(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})\b")
DATE_ISO_RE = re.compile(r"\b(\d{4})-(\d{2})-(\d{2})\b")
DATE_WORDS_RE = re.compile(
    r"\b(\d{1,2})\s*(?:de\s+)?([a-záéíóú]{3,10})\.?\s*(?:de\s+|del\s+)?(\d{4})?\b", re.I
)

# Etiquetas que anteceden a la contraparte.
PARTY_LABEL_RE = re.compile(
    r"^\s*(?:para|destinatario|destino|a\s+nombre\s+de|beneficiario|enviaste\s+a"
    r"|le\s+enviaste\s+a|comercio|motivo|concepto|detalle|descripci[oó]n)\s*[:\-]?\s*(.*)$",
    re.I,
)
# Líneas que nunca son la contraparte aunque estén donde debería.
PARTY_NOISE_RE = re.compile(
    r"(cbu|cvu|cuit|cuil|dni|alias|banco|cuenta|^\s*\$|comprobante|operaci[oó]n"
    r"|transferencia|^\s*\d[\d\s./-]*$)",
    re.I,
)

# Encabezados que toda billetera pone arriba y que no son el comercio.
HEADER_RE = re.compile(
    r"^\s*(transferencia|pagaste|pagu[eé]|enviaste|pago\s+(enviado|recibido|aprobado)"
    r"|compra\s+aprobada|comprobante|recibo|detalle\s+de|te\s+enviaron|cobraste)",
    re.I,
)

MAX_DESCRIPTION = 120
# Una fecha futura es un error de lectura; un año para atrás también.
FUTURE_SLACK = timedelta(days=1)
PAST_LIMIT = timedelta(days=730)


def _candidate_amounts(text: str) -> list[tuple[str, int]]:
    """Todos los números con pinta de plata, con su posición."""
    out = []
    blocked = [m.span() for m in LONG_DIGIT_RUN_RE.finditer(text)]
    for m in AMOUNT_RE.finditer(text):
        # Descartar lo que cae adentro de una corrida larga de dígitos.
        if any(s <= m.start() and m.end() <= e for s, e in blocked):
            continue
        out.append((m.group(0), m.start()))
    return out


def _last_match_pos(pattern: re.Pattern, haystack: str) -> int | None:
    """Dónde arranca la última coincidencia, o None."""
    last = None
    for m in pattern.finditer(haystack):
        last = m.start()
    return last


def _score_amount(text: str, raw: str, pos: int) -> float:
    """Qué tan probable es que este número sea el importe del comprobante.

    Decide por la pista **más cercana**, no por cualquiera de la ventana. Es la
    diferencia entre leer un comprobante de banco y no leerlo: el texto real
    empieza con el título "Comprobante de transferencia" y sigue con
    "Importe: $ 45.000,00", así que buscando "hay alguna palabra negativa en los
    últimos 40 caracteres" el título mataba al importe que tenía pegado. Una
    etiqueta gobierna al número que tiene al lado, no a todo lo que venga
    después.
    """
    before = text[max(0, pos - 40):pos]
    pos_hint = _last_match_pos(MONEY_HINT_RE, before)
    neg_hint = _last_match_pos(NOT_MONEY_HINT_RE, before)

    score = 0.0
    if pos_hint is not None and (neg_hint is None or pos_hint > neg_hint):
        score += 0.50
    elif neg_hint is not None:
        score -= 0.80   # decisivo: mata al candidato

    if "," in raw and re.search(r",\d{2}$", raw):
        score += 0.20   # tiene centavos, es plata
    if "." in raw:
        score += 0.05   # separador de miles
    return score


def _find_amount(text: str) -> tuple[object, float]:
    best_value, best_score = None, -1.0
    for raw, pos in _candidate_amounts(text):
        value = parse_amount_ar(raw)
        if value is None or value <= 0 or value > MAX_AMOUNT:
            continue
        score = _score_amount(text, raw, pos)
        if score <= 0:
            continue
        # A igualdad de señal gana el número más grande: los comprobantes
        # suelen mostrar el total y después comisiones o saldos menores.
        if score > best_score or (score == best_score and best_value is not None and value > best_value):
            best_value, best_score = value, score
    if best_value is None:
        return None, 0.0
    return best_value, min(1.0, best_score)


def _valid(d: date) -> bool:
    today = date.today()
    return today - PAST_LIMIT <= d <= today + FUTURE_SLACK


def _find_date(text: str) -> date | None:
    lowered = text.lower()
    if re.search(r"\bhoy\b", lowered):
        return date.today()
    if re.search(r"\bayer\b", lowered):
        return date.today() - timedelta(days=1)

    for m in DATE_ISO_RE.finditer(text):
        try:
            d = date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
        except ValueError:
            continue
        if _valid(d):
            return d

    for m in DATE_NUMERIC_RE.finditer(text):
        day, month, year = (int(g) for g in m.groups())
        if year < 100:
            year += 2000
        try:
            d = date(year, month, day)     # día primero, siempre
        except ValueError:
            continue
        if _valid(d):
            return d

    for m in DATE_WORDS_RE.finditer(text):
        day_s, month_s, year_s = m.groups()
        month = MONTHS.get(month_s.lower().rstrip("."))
        if month is None:
            continue
        year = int(year_s) if year_s else date.today().year
        try:
            d = date(year, month, int(day_s))
        except ValueError:
            continue
        if _valid(d):
            return d
    return None


def _find_description(text: str) -> str | None:
    lines = [ln.strip() for ln in text.splitlines()]
    for i, line in enumerate(lines):
        m = PARTY_LABEL_RE.match(line)
        if not m:
            continue
        value = m.group(1).strip()
        # La etiqueta puede estar sola y el valor en la línea siguiente, que es
        # como lo maqueta Mercado Pago.
        if not value:
            value = next((l for l in lines[i + 1:i + 3] if l), "")
        value = value.strip(" :-\t")
        if value and not PARTY_NOISE_RE.search(value):
            return value[:MAX_DESCRIPTION]

    # Sin etiqueta. Los pagos por QR no la traen: son un encabezado
    # ("Pagaste"), el importe, y el comercio suelto abajo. Se toma la primera
    # línea que tenga letras, no sea ruido y no sea uno de los encabezados
    # conocidos. Es la parte menos confiable de todo el lector, y por eso el
    # borrador siempre se confirma antes de guardar.
    for line in lines:
        if not line or not re.search(r"[a-záéíóúñ]{3}", line, re.I):
            continue
        if HEADER_RE.match(line) or PARTY_NOISE_RE.search(line):
            continue
        if AMOUNT_RE.search(line) or DATE_NUMERIC_RE.search(line):
            continue
        return line.strip(" :-\t")[:MAX_DESCRIPTION]
    return None


def parse_text(text: str) -> ReceiptDraft:
    """Texto de comprobante → borrador. Nunca levanta."""
    draft = ReceiptDraft(source_kind="text", engine="regex")
    if not text or not text.strip():
        draft.error = "No vino texto para leer."
        return draft

    amount, amount_conf = _find_amount(text)
    when = _find_date(text)
    description = _find_description(text)
    currency = "USD" if USD_RE.search(text) else "ARS"

    draft.amount = amount
    draft.date = when
    draft.description = description
    draft.currency = currency if amount is not None else None

    draft.fields = {
        "amount": round(amount_conf, 3),
        "date": 1.0 if when else 0.0,
        "description": 1.0 if description else 0.0,
    }
    # El monto pesa más que todo lo demás junto: es el campo por el que la
    # lectura vale la pena.
    draft.confidence = round(
        0.7 * amount_conf + 0.15 * (1.0 if when else 0.0) + 0.15 * (1.0 if description else 0.0),
        3,
    )
    if amount is None:
        draft.error = "No encontramos el importe en el comprobante."
    return draft
