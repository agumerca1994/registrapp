"""Parsers de resúmenes de tarjeta, como librería.

Antes cada parser vivía dentro de su script CLI (`backend/scripts/import_*.py`)
y sólo se podía usar copiando el script adentro del contenedor. Ahora los
scripts importan de acá, y el mismo código queda disponible para la
conciliación in-app, el bot de WhatsApp y el conector MCP.

El punto de entrada es `detect_and_parse(pdf_bytes)`: prueba el `detect()` de
cada banco en orden y devuelve un `ParseResult` que o trae los datos o dice
por qué no ("no_parser", "encrypted", "no_text"). El control de totales
(sumar los ítems contra el total que imprime el banco) NO va acá — es regla
de la conciliación, no de la lectura — pero cada parser ya entrega el
`block_total` por titular para que ese control sea posible.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.services.statement_parsers import (
    banco_nacion,
    banco_nacion_mastercard,
    bbva,
    naranjax,
)
from app.services.statement_parsers.common import extract_pages_text, pages_to_lines
from app.services.statement_parsers.pages import pages_with_movements

# Orden: los detect() más específicos primero. BBVA cubre Visa y Mastercard
# (formato idéntico); BN Mastercard va antes que BN Visa porque sus marcadores
# no se pisan y el de Visa es el más genérico de los dos.
REGISTRY = [bbva, naranjax, banco_nacion_mastercard, banco_nacion]


@dataclass
class ParseResult:
    status: str  # "ok" | "no_parser" | "encrypted" | "no_text"
    bank_id: str | None = None
    data: dict | None = None  # el dict de parse_lines() del banco detectado
    pages_total: int = 0
    pages_with_movements: list[int] = field(default_factory=list)
    # Qué leería una IA de respaldo (sólo las páginas con movimientos, como
    # texto), en tokens estimados (~4 caracteres por token). Alimenta el
    # costo proyectado de `capture_events` aunque la IA no exista todavía.
    est_input_tokens: int = 0

    @property
    def ok(self) -> bool:
        return self.status == "ok"


def detect_and_parse(pdf_bytes: bytes) -> ParseResult:
    """Lee un PDF de resumen y lo parsea con el banco que lo reconozca."""
    try:
        pages = extract_pages_text(pdf_bytes)
    except Exception as exc:  # pdfminer no exporta una jerarquía estable
        name = type(exc).__name__
        if "Password" in name or "Encrypt" in name:
            return ParseResult(status="encrypted")
        # Archivo corrupto, no-PDF, o un PDF del que no se puede extraer
        # texto (escaneado): para el embudo es lo mismo — no hay texto.
        return ParseResult(status="no_text")

    movements = pages_with_movements(pages)
    est_tokens = sum(len(pages[i]) for i in movements) // 4
    lines = pages_to_lines(pages)
    if not lines:
        return ParseResult(status="no_text", pages_total=len(pages))

    for module in REGISTRY:
        if module.detect(lines):
            return ParseResult(
                status="ok",
                bank_id=module.BANK_ID,
                data=module.parse_lines(lines),
                pages_total=len(pages),
                pages_with_movements=movements,
                est_input_tokens=est_tokens,
            )

    return ParseResult(
        status="no_parser",
        pages_total=len(pages),
        pages_with_movements=movements,
        est_input_tokens=est_tokens,
    )
