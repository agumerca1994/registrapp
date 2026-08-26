"""Montos en formato argentino, un solo lugar.

Esta función vivía como `_parse_amount` dentro de `routers/whatsapp.py`. Se
promovió acá cuando el lector de comprobantes necesitó exactamente lo mismo:
el repo ya tenía tres implementaciones del parseo de montos argentinos (el
`parseAmount` del frontend, la del bot y las de los scripts de importación), y
una cuarta es cómo empiezan a discrepar entre sí sin que nadie se entere.
"""
import re
from decimal import Decimal, InvalidOperation

# 999.999.999,00 — el techo que el bot ya imponía. Un comprobante con un número
# más grande es casi con seguridad un CBU o un número de operación mal leído.
MAX_AMOUNT = Decimal("999999999.00")

# Un monto argentino: o tiene separadores de miles con punto ("1.500.000",
# "12.500,50"), o es un número corto con coma decimal opcional ("1500",
# "1500,50"). Los `(?<![\d.,])` / `(?![\d.,])` son lo que impide agarrar un
# pedazo del medio de un CBU de 22 dígitos y creer que es plata.
AMOUNT_RE = re.compile(
    r"(?<![\d.,])"
    r"(?:"
    r"\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?"   # 12.500 / 12.500,50 / 1.500.000
    r"|"
    r"\d{1,9}(?:,\d{1,2})?"               # 1500 / 1500,50 — tope de 9 dígitos
    r"|"
    r"\d{1,3}(?:,\d{3})+\.\d{2}"          # 12,500.50 — formato US, ver abajo
    r")"
    r"(?![\d.,])"
)


def parse_amount_ar(raw: str) -> Decimal | None:
    """Texto → Decimal, interpretando el formato argentino.

    La ambigüedad real es "1.500": en argentino son mil quinientos, en inglés
    uno coma cinco. Se resuelve como argentino porque ése es el contexto de la
    app, con una sola excepción explícita: si el número tiene comas como
    separador de miles Y un punto decimal ("12,500.50"), es inequívocamente
    formato US y se lo trata como tal. Aparece en comprobantes de servicios
    internacionales.
    """
    cleaned = raw.strip()
    if not cleaned:
        return None
    try:
        if "," in cleaned and "." in cleaned:
            # El separador decimal es el que aparece último.
            if cleaned.rindex(",") > cleaned.rindex("."):
                cleaned = cleaned.replace(".", "").replace(",", ".")   # AR
            else:
                cleaned = cleaned.replace(",", "")                     # US
        elif "," in cleaned:
            cleaned = cleaned.replace(",", ".")
        elif "." in cleaned:
            # Sólo puntos. "1.500" es AR (miles); "1.50" es decimal — un punto
            # seguido de exactamente dos dígitos al final y nada más.
            if re.fullmatch(r"\d+\.\d{1,2}", cleaned):
                pass                       # ya está en notación decimal
            else:
                cleaned = cleaned.replace(".", "")
        return Decimal(cleaned)
    except InvalidOperation:
        return None
