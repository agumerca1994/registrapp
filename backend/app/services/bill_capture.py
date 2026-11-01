"""Facturas de servicios (luz, gas, teléfono, internet) que llegan por el bot.

Una factura no es un pago: es algo que vence más adelante, y con débito
automático la plata sale por otro lado (casi siempre la tarjeta). Cargarla
como gasto simple la duplicaba con el ítem que la persona ya carga en el
resumen de la tarjeta (caso real: Personal, cargado todos los meses en la
tarjeta, entró además como gasto suelto).

Acá sólo se decide; el bot pregunta y escribe. La pieza central es el
historial: si ese comercio ya se cargó en una tarjeta en los últimos meses, la
factura va ahí, en el resumen siguiente al último donde figura.
"""
from __future__ import annotations

import calendar
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.services.category_suggest import normalize

MONTHS = (
    "enero", "febrero", "marzo", "abril", "mayo", "junio", "julio",
    "agosto", "septiembre", "octubre", "noviembre", "diciembre",
)

# Hasta cuántos meses entre el último resumen con el comercio y la factura se
# sigue proponiendo "el resumen que sigue". Más que eso es un hueco que el bot
# no puede rellenar adivinando: va a la app.
MAX_GAP_MONTHS = 2


@dataclass
class CardTarget:
    """Dónde va la factura: la tarjeta, el período del resumen y cómo se cargó
    la última vez (descripción, categoría, día del mes)."""
    card_id: int
    card_label: str
    year: int
    month: int
    item_date: date
    description: str
    category_id: int | None
    # Ya hay un ítem de ese comercio con el mismo monto en los últimos resúmenes.
    already_loaded: bool = False


def same_merchant(a: str, b: str) -> bool:
    """"Personal" y "PERSONAL FLOW 0800" son el mismo comercio; alcanza con que
    los tokens de uno estén todos en el otro."""
    ta, tb = set(normalize(a)), set(normalize(b))
    return bool(ta and tb) and (ta <= tb or tb <= ta)


def _month_index(year: int, month: int) -> int:
    return year * 12 + month - 1


def _from_index(i: int) -> tuple[int, int]:
    return i // 12, i % 12 + 1


def period_label(year: int, month: int, today: date) -> str:
    return MONTHS[month - 1] if year == today.year else f"{MONTHS[month - 1]} {year}"


async def card_target(
    db: AsyncSession, tenant_id: int, merchant: str, amount: Decimal, ref: date
) -> CardTarget | None:
    """El resumen donde va esta factura, según dónde se cargó ese comercio
    antes. None = no hay historial en tarjeta, o es demasiado viejo como para
    saber qué resumen sigue (`ref` es el vencimiento de la factura, o su fecha)."""
    if not merchant:
        return None
    rows = (await db.execute(
        select(CreditCardItem, CreditCardStatement, CreditCard)
        .join(CreditCardStatement, CreditCardItem.statement_id == CreditCardStatement.id)
        .join(CreditCard, CreditCardStatement.card_id == CreditCard.id)
        .where(
            CreditCardStatement.tenant_id == tenant_id,
            CreditCardItem.item_type != "installment",
            CreditCardStatement.year * 12 + CreditCardStatement.month - 1
            >= _month_index(ref.year, ref.month) - 12,
        )
        .order_by(CreditCardStatement.year.desc(), CreditCardStatement.month.desc(), CreditCardItem.id.desc())
    )).all()
    matches = [
        (item, stmt, card) for item, stmt, card in rows
        if same_merchant(merchant, item.description or "")
        or same_merchant(merchant, item.bank_description or "")
    ]
    if not matches:
        return None
    item, stmt, card = matches[0]
    last = _month_index(stmt.year, stmt.month)
    if _month_index(ref.year, ref.month) - last > MAX_GAP_MONTHS:
        return None

    year, month = _from_index(last + 1)
    day = min(item.item_date.day, calendar.monthrange(year, month)[1])
    # La misma factura cargada a mano en algún resumen reciente: un monto igual
    # (al peso) del mismo comercio en esa tarjeta.
    loaded = any(
        s.card_id == card.id and abs(i.amount - amount) <= 1
        and _month_index(s.year, s.month) >= last - 1
        for i, s, _c in matches
    )
    label = card.alias if not card.bank or card.bank.lower() in card.alias.lower() else f"{card.alias} de {card.bank}"
    return CardTarget(
        card_id=card.id, card_label=label, year=year, month=month,
        item_date=date(year, month, day), description=item.description,
        category_id=item.category_id,
        already_loaded=loaded,
    )
