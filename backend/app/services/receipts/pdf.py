"""Comprobantes en PDF.

Los comprobantes de transferencia de bancos y billeteras argentinas **tienen
capa de texto real**: no son escaneos. Así que acá no hace falta OCR, alcanza
con extraer el texto y pasárselo al mismo parser que el texto pegado a mano —
una sola implementación de la heurística, el PDF sólo aporta los caracteres.

Esto NO es el importador de resúmenes de tarjeta. Un comprobante de una
operación y un resumen mensual son documentos distintos y no comparten parser;
`backend/scripts/import_*.py` sigue intacto y sin tocar.
"""
import asyncio
import logging

from app.services.receipts.text import parse_text
from app.services.receipts.types import ReceiptDraft

logger = logging.getLogger(__name__)

# Un comprobante de transferencia es una página. El tope existe para que un PDF
# de 400 páginas no ocupe el único worker de uvicorn.
MAX_PAGES = 3
MAX_PDF_BYTES = 2 * 1024 * 1024

# Menos que esto no es un comprobante con texto: es un escaneo o una imagen
# metida adentro de un PDF.
MIN_TEXT_CHARS = 30


def _extract_sync(data: bytes) -> str:
    import pdfplumber      # import perezoso: pdfplumber tarda en cargar
    from io import BytesIO

    chunks = []
    with pdfplumber.open(BytesIO(data)) as pdf:
        for page in pdf.pages[:MAX_PAGES]:
            chunks.append(page.extract_text() or "")
    return "\n".join(chunks)


async def parse_pdf(data: bytes) -> ReceiptDraft:
    """PDF → borrador. Nunca levanta."""
    if len(data) > MAX_PDF_BYTES:
        return ReceiptDraft(
            source_kind="pdf", engine="pdfplumber",
            error=f"El PDF supera los {MAX_PDF_BYTES // (1024 * 1024)} MB.",
        )
    try:
        # `pdfplumber` es sincrónico y bloquea el event loop. Con un solo worker
        # de uvicorn, tres segundos de parseo son tres segundos de backend
        # entero indisponible para todos los hogares. Es la misma clase de bug
        # que `send_each_for_multicast` en push.py, y la misma solución.
        text = await asyncio.to_thread(_extract_sync, data)
    except Exception as e:
        logger.warning("No se pudo leer el PDF del comprobante: %s", e)
        return ReceiptDraft(
            source_kind="pdf", engine="pdfplumber",
            error="No pudimos leer el PDF.",
        )

    if len(text.strip()) < MIN_TEXT_CHARS:
        return ReceiptDraft(
            source_kind="pdf", engine="pdfplumber",
            error="El PDF no tiene texto; parece un escaneo o una imagen.",
        )

    draft = parse_text(text)
    draft.source_kind = "pdf"
    draft.engine = "pdfplumber"
    return draft
