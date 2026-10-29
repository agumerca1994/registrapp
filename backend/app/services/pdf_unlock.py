"""PDFs con contraseña: saber si la tienen y sacársela.

Los bancos mandan el resumen protegido (casi siempre con el DNI), y así no lo
lee ni pdfminer ni la API de Claude, que rechaza un PDF protegido con un 400.
Con la contraseña que la persona manda por chat se abre una vez, en memoria,
y lo que sigue (parsers, comprobante, IA, conciliación) recibe el PDF ya sin
protección. Ni el PDF ni la contraseña se guardan.

Usa pypdfium2, que ya viene con pdfplumber: no suma dependencias.
"""
from __future__ import annotations

import io
import logging

logger = logging.getLogger(__name__)


def _open(data: bytes, password: str | None):
    import pypdfium2 as pdfium

    return pdfium.PdfDocument(data, password=password)


def needs_password(data: bytes) -> bool:
    """True si el PDF no abre sin contraseña. Un PDF que sólo tiene permisos
    de dueño (abre sin pedir nada) no cuenta: ese se lee igual."""
    import pypdfium2 as pdfium

    try:
        _open(data, None).close()
        return False
    except pdfium.PdfiumError as e:
        return "password" in str(e).lower()


def unlock(data: bytes, password: str) -> bytes | None:
    """El PDF sin protección, o None si la contraseña no lo abre."""
    import pypdfium2 as pdfium
    import pypdfium2.raw as pdfium_c

    try:
        doc = _open(data, password)
    except pdfium.PdfiumError:
        return None
    try:
        out = io.BytesIO()
        doc.save(out, flags=pdfium_c.FPDF_REMOVE_SECURITY)
        return out.getvalue()
    except Exception:
        logger.warning("PDF: abrió con la contraseña pero no se pudo guardar sin protección", exc_info=True)
        return None
    finally:
        doc.close()
