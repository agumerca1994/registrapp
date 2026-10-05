"""Parser de resúmenes BBVA Mastercard.

El formato del PDF es idéntico al de Visa (`bbva.py` parsea los dos); lo único
propio es el hint de titular para la revisión manual del JSON. Existe como
módulo para que `scripts/import_bbva_mastercard_statements.py` siga teniendo
de dónde importar con nombre propio.
"""
from __future__ import annotations

from app.services.statement_parsers.bbva import (  # noqa: F401 — re-export para el script
    AMOUNT_RE,
    AMOUNT_TOKEN_RE,
    CONSUMOS_PREFIX,
    CUOTA_RE,
    DATE_PREFIX_RE,
    DATE_TOKEN_RE,
    IMPUESTOS_HEADER,
    MASTERCARD_CARDHOLDER_HINTS,
    PAGOS_HEADER,
    ROW_HEADERS,
    TOTAL_CONSUMOS_PREFIX,
    TRAILING_DIGITS_RE,
    detect,
    parse_amount,
    parse_header,
    parse_row,
    parse_short_date,
)
from app.services.statement_parsers.bbva import parse_lines as _parse_lines

BANK_ID = "bbva_mastercard"

CARDHOLDER_CARD_HINTS = MASTERCARD_CARDHOLDER_HINTS


def parse_lines(lines: list[str], hints: dict[str, dict] | None = None) -> dict:
    return _parse_lines(lines, hints=hints or CARDHOLDER_CARD_HINTS)
