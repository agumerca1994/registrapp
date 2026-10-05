"""Clasificador de páginas: cuáles traen movimientos y cuáles son relleno.

Un resumen puede tener 8 páginas con consumos sólo en 2 — el resto es texto
legal, publicidad y cuadros de tasas. Hoy el resultado se usa para registrar
en `capture_events` cuántas páginas útiles tiene cada PDF; cuando exista el
respaldo con IA (Fase 4), decide qué páginas recibe el modelo, que es la
diferencia entre mandar 2 páginas y mandar 8.

Es deliberadamente genérico (no por banco): tiene que funcionar también en el
resumen de un banco sin parser, que es justamente el caso que iría a la IA.
"""
from __future__ import annotations

import re

# Unión de los formatos de fecha de los bancos soportados y los habituales:
# 21-Sep-26 · 21-09-26 · 21/09/26 · 21/09/2026
_DATE_RE = re.compile(r"\b\d{2}[-/](?:[A-Za-zÁ-Úá-ú]{3}|\d{2})[-/]\d{2,4}\b")
# Monto argentino, con o sin separador de miles: 1.234,56 · 1234,56 · -84,00
_AMOUNT_RE = re.compile(r"-?\d[\d.]*,\d{2}-?\b")

_SECTION_HINTS = (
    "CONSUMOS",
    "CUOTAS",
    "DETALLE",
    "MOVIMIENTOS",
    "IMPUESTOS",
    "TOTAL",
)

# Una línea de movimiento = fecha + monto en la misma línea. Pocas de esas en
# una página de texto legal; muchas en una de consumos.
_MIN_MOVEMENT_LINES = 2


def _looks_like_movement(line: str) -> bool:
    return bool(_DATE_RE.search(line)) and bool(_AMOUNT_RE.search(line))


def pages_with_movements(pages_text: list[str]) -> list[int]:
    """Índices (0-based) de las páginas que parecen traer movimientos.

    Una página cuenta si tiene al menos `_MIN_MOVEMENT_LINES` líneas con fecha
    y monto, o una sola de esas líneas junto a un encabezado de sección — el
    caso de la última página de un bloque, que puede traer un solo renglón.
    """
    result: list[int] = []
    for idx, text in enumerate(pages_text):
        lines = [ln.strip() for ln in text.split("\n") if ln.strip()]
        movement_lines = sum(1 for ln in lines if _looks_like_movement(ln))
        if movement_lines >= _MIN_MOVEMENT_LINES:
            result.append(idx)
            continue
        if movement_lines >= 1 and any(
            hint in ln.upper() for ln in lines for hint in _SECTION_HINTS
        ):
            result.append(idx)
    return result
