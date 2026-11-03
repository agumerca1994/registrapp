"""El registro de lo que el código no resolvió, para convertirlo en código.

Cada vez que hizo falta la IA, o que alguien deshizo una carga enseguida, se
anota la FORMA del mensaje: las palabras que no identifican a nadie quedan, y el
resto se enmascara ("gaste 99mil en aaaaa"). Se enmascara acá, en código y por
lista blanca, porque el repo es público y estas formas terminan en un PR: una
palabra que no está en la lista no sale nunca, aunque la lista quede corta.

Nunca hace commit ni levanta: perder un caso es perder una pista, no un gasto.
"""
from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.bot_case import BotCase
from app.services.search import fold_text

logger = logging.getLogger(__name__)

KIND_TEXT_AI = "text_ai"
KIND_TEXT_UNRESOLVED = "text_unresolved"
KIND_UNDONE = "undone"
KIND_DOC_AI = "doc_ai"
KIND_STATEMENT_AI = "statement_ai"

KEEP_DAYS = 90
MAX_SHAPE = 1500

# Palabras de formularios y de cómo habla la gente de plata. Ningún nombre propio
# de una persona: "mercado" y "pago" están por Mercado Pago, y el apellido Mercado
# queda igual de anónimo sin el resto del nombre.
_SAFE_WORDS = frozenset("""
a al algo ante aca ahi alias ayer anteayer antes aviso banco bancos bien bruto cada cambiar categoria categorias
cbu cierre cierra cobre cobramos cobro codigo comercio como comprobante compra compras compre compraste
compartido compartir compartilo con concepto consumo consumos contrato cuenta cuil cuit cuota cuotas cvu
de debito del dejalo descripcion deshacer destino destinatario detalle dia dias dinero divido dividido dolar
dolares domicilio efectivo egreso el empresa en entre entro enviaste envio es esa ese esta este esto fecha
fuente gasto gaste gastamos hoy id importe impuesto impuestos ingreso ingresos interes intereses la las lo
los lucas mandaron me medias medio mercado mes mil mitad monto mp motivo mis mi neto no nos nro numero nueva
nuevo o operacion origen otra otro otros pagado pagar pagamos pago pague pagaste pagos palos para pay pesos
por puedo que quiero recibi recibido recibiste recibo referencia registrar reintegro resumen saldo se si sin
sueldo sucursal super tarjeta te terminada ticket titular total transferencia transferiste tu un una usd varios
vence vencimiento venta ventas vendi visa master mastercard y ya yo
enero febrero marzo abril mayo junio julio agosto septiembre setiembre octubre noviembre diciembre
lunes martes miercoles jueves viernes sabado domingo
""".split())

_WORD_RE = re.compile(r"[a-z]+")


def mask(text: str) -> str:
    """La forma del texto. Conserva los renglones, los signos y las palabras de
    la lista; lo demás no se puede volver a leer."""
    folded = re.sub(r"\d", "9", fold_text(text or ""))
    masked = _WORD_RE.sub(lambda m: m.group(0) if m.group(0) in _SAFE_WORDS else "a" * len(m.group(0)), folded)
    return re.sub(r"[ \t]+", " ", masked).strip()[:MAX_SHAPE]


async def record(db: AsyncSession, kind: str, text: str | None, resolution: dict | None = None) -> None:
    """Sólo flush. Sin restricción única a propósito: dos filas iguales por una
    carrera se suman al leer, y un error de unicidad tiraría la transacción del gasto."""
    shape = mask(text or "")
    if not shape:
        return
    key = hashlib.sha256(f"{kind}:{shape}".encode()).hexdigest()
    try:
        row = await db.scalar(
            select(BotCase).where(BotCase.kind == kind, BotCase.shape_hash == key).limit(1)
        )
        if row is None:
            db.add(BotCase(kind=kind, shape=shape, shape_hash=key, resolution=resolution, count=1))
        else:
            row.count += 1
            row.last_seen = datetime.now()
            if resolution:
                row.resolution = resolution
        await db.flush()
    except Exception:
        logger.exception("No pude registrar un caso del bot (%s)", kind)


async def purge_old(db: AsyncSession) -> int:
    result = await db.execute(
        delete(BotCase).where(BotCase.last_seen < datetime.now() - timedelta(days=KEEP_DAYS))
    )
    await db.commit()
    return result.rowcount or 0
