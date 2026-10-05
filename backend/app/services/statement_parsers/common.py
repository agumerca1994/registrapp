"""Piezas compartidas por los parsers de resúmenes de tarjeta.

Acá va sólo lo que es idéntico entre bancos (meses en español, la regla del
período, la extracción de texto por página). Las regex de fila y los
`parse_amount` quedan en el módulo de cada banco a propósito: difieren en
detalles chicos (separador de miles, signo negativo al final) y unificarlos
fue justamente lo que los scripts originales evitaron.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from typing import IO

MONTHS = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
}


def assign_period(closing: date) -> tuple[int, int]:
    """Período (year, month) de un resumen a partir de su fecha de cierre.

    Los bancos cierran algunos ciclos en los primeros días del mes siguiente
    (p.ej. cierre 02-Jul para el resumen "de junio"). Si el cierre cae muy
    temprano en el mes, el período se asigna al mes anterior — evita que dos
    resúmenes consecutivos choquen en el mismo (year, month).
    """
    if closing.day <= 5:
        month = closing.month - 1 or 12
        year = closing.year - 1 if closing.month == 1 else closing.year
        return year, month
    return closing.year, closing.month


def extract_pages_text(source: Path | str | bytes | IO[bytes]) -> list[str]:
    """Texto plano de cada página del PDF (una string por página).

    `pdfplumber` se importa adentro para que importar el paquete no requiera
    tenerlo instalado (los tests de parsing trabajan sobre líneas de texto).
    """
    import io

    import pdfplumber

    if isinstance(source, bytes):
        source = io.BytesIO(source)
    elif isinstance(source, (str, Path)):
        source = str(source)

    with pdfplumber.open(source) as pdf:
        return [page.extract_text() or "" for page in pdf.pages]


def pages_to_lines(pages_text: list[str]) -> list[str]:
    """Aplana las páginas en la lista de líneas que consumen los parsers."""
    lines: list[str] = []
    for text in pages_text:
        lines.extend(text.split("\n"))
    return [ln.strip() for ln in lines if ln.strip()]


def extract_lines(pdf_path: Path | str) -> list[str]:
    """Equivalente al `extract_lines` que tenían los scripts por banco."""
    return pages_to_lines(extract_pages_text(pdf_path))
