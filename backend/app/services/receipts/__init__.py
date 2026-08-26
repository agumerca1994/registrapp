"""Leer un comprobante de pago y proponer un gasto.

**Dos invariantes, y las dos son estructurales, no buenas intenciones:**

1. **Nunca escribe.** No hay un solo `db.add` en este paquete. Devuelve un
   borrador; el único que crea un gasto sigue siendo `POST /expenses/entries`,
   después de que una persona miró el formulario y apretó Guardar. Que la app
   lea un comprobante no la autoriza a registrar plata sola.

2. **Nunca levanta.** Cualquier falla vuelve como un `ReceiptDraft` vacío con
   `error` puesto, y el endpoint contesta 200. Un 4xx pondría a la persona en
   una pantalla de error cuando el resultado correcto de "no pude leer esto" es
   un formulario en blanco que llena en diez segundos. Escrito así, la regla no
   se puede perder en un `try` que alguien reescriba.

Lo que puede leer hoy es texto y PDF con capa de texto, que es gratis,
instantáneo y no suma ninguna dependencia. Las imágenes (la captura de un pago
por QR) necesitan OCR y quedaron deliberadamente afuera de esta versión: el
dispatch de abajo es el punto donde entra una implementación nueva sin tocar
nada más.
"""
import logging

from app.services.receipts.pdf import parse_pdf
from app.services.receipts.text import parse_text
from app.services.receipts.types import ReceiptDraft

logger = logging.getLogger(__name__)

PDF_MIME = "application/pdf"
PDF_MAGIC = b"%PDF"
IMAGE_MIMES = frozenset({"image/jpeg", "image/png", "image/webp", "image/gif", "image/heic"})

__all__ = ["read_receipt", "ReceiptDraft", "parse_text", "parse_pdf"]


async def read_receipt(
    *,
    text: str | None = None,
    data: bytes | None = None,
    media_type: str | None = None,
) -> ReceiptDraft:
    """Punto de entrada único. Texto, PDF o archivo → borrador de gasto."""
    try:
        if text and text.strip():
            return parse_text(text)

        if data:
            mime = (media_type or "").split(";")[0].strip().lower()
            # El magic number manda sobre el Content-Type: el que declara el
            # tipo es el cliente, y las hojas de compartir mandan cualquier cosa.
            if mime == PDF_MIME or data[:4] == PDF_MAGIC:
                return await parse_pdf(data)
            if mime in IMAGE_MIMES:
                return ReceiptDraft(
                    source_kind="image", engine="none",
                    error="Todavía no leemos imágenes. Cargá el gasto a mano.",
                )
            return ReceiptDraft(error="No reconocimos el tipo de archivo.")

        return ReceiptDraft(error="No vino nada para leer.")
    except Exception as e:
        # La red de contención del invariante 2. Si algo se escapa de los
        # parsers, el usuario igual recibe un formulario, no un 500.
        logger.exception("read_receipt falló inesperadamente: %s", e)
        return ReceiptDraft(error="No pudimos leer el comprobante.")
