"""Gastos recurrentes: la cadena de meses de una serie (models/recurrence.py).

Las reglas, que vinieron del usuario y que nada de acá puede romper:

- **Crear como recurrente o confirmar genera el mes siguiente**, y sólo eso.
  Un pendiente que no se confirma no genera nada: la cadena se corta sola y no
  se acumulan meses que nadie miró.
- **Un pendiente suma y no vence.** Pasada su fecha se puede confirmar igual.
- **"Este mes no" también decide sobre el siguiente**: o sigue (se genera el
  próximo con el último monto) o se da de baja. No hay un tercer camino que
  deje la serie viva sin mes siguiente.
- **Hay a lo sumo un pendiente por serie** (índice único parcial). Confirmar
  dos veces no genera dos meses siguientes.
- Con tarjeta, cada mes va al resumen **del período siguiente** al del mes
  anterior, no al que tocaría por la fecha: la app no sabe el día de cierre.

Igual que el resto de `services/`, **nada de esto hace commit**: decide el que
llama. Los errores son `HTTPException`, que el conector convierte.
"""
from __future__ import annotations

from calendar import monthrange
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import EXPENSE_SOURCE_RECURRENCE, ExpenseEntry
from app.models.recurrence import (
    ENTRY_CONFIRMED,
    ENTRY_PENDING,
    STATUS_ACTIVE,
    STATUS_ENDED,
    Recurrence,
)
from app.services.clock import ar_today

CAPTURE_SOURCE = "recurrence"


def next_date(prev: date, day: int) -> date:
    """El mes siguiente a `prev`, en el día de la serie (o el último del mes).

    Anclado al día de la serie y no al de `prev`: si no, un 31/1 pasa a 28/2 y
    de ahí en más queda en 28 para siempre.
    """
    year, month = (prev.year + 1, 1) if prev.month == 12 else (prev.year, prev.month + 1)
    return date(year, month, min(day, monthrange(year, month)[1]))


def period_after(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


async def card_item_of(db: AsyncSession, entry_id: int) -> CreditCardItem | None:
    """El ítem de tarjeta cuyo espejo es este gasto, con su resumen cargado."""
    return await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.expense_entry_id == entry_id)
        .options(selectinload(CreditCardItem.statement))
    )


async def pending_of(db: AsyncSession, series_id: int) -> ExpenseEntry | None:
    return await db.scalar(
        select(ExpenseEntry).where(
            ExpenseEntry.recurrence_id == series_id,
            ExpenseEntry.recurrence_status == ENTRY_PENDING,
        )
    )


async def get_series(db: AsyncSession, tenant_id: int, series_id: int) -> Recurrence:
    series = await db.get(Recurrence, series_id)
    if series is None or series.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Recurrente no encontrado")
    return series


async def get_entry(db: AsyncSession, tenant_id: int, entry_id: int) -> ExpenseEntry:
    entry = await db.get(ExpenseEntry, entry_id)
    if entry is None or entry.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Gasto no encontrado")
    return entry


async def start_series(
    db: AsyncSession,
    entry: ExpenseEntry,
    *,
    item: CreditCardItem | None = None,
    card: CreditCard | None = None,
    stmt: CreditCardStatement | None = None,
) -> Recurrence:
    """Hace recurrente un gasto recién creado (o uno existente): crea la serie,
    lo marca confirmado y genera el mes siguiente. **Sólo flush.**"""
    if entry.recurrence_id is not None:
        raise HTTPException(status_code=409, detail="Ya es recurrente")
    if item is not None and (item.item_type == "installment" or item.installment_group_id):
        raise HTTPException(status_code=400, detail="Un gasto en cuotas no puede ser recurrente")
    series = Recurrence(
        tenant_id=entry.tenant_id,
        user_id=entry.user_id,
        description=item.description if item is not None else entry.description,
        category_id=entry.category_id,
        currency=entry.currency or "ARS",
        amount=entry.amount,
        day=(item.item_date if item is not None else entry.expense_date).day,
        card_id=card.id if card is not None else None,
        payment_method=None if card is not None else entry.payment_method,
        bank_description=item.bank_description if item is not None else None,
        status=STATUS_ACTIVE,
    )
    db.add(series)
    await db.flush()
    entry.recurrence_id = series.id
    entry.recurrence_status = ENTRY_CONFIRMED
    if item is not None:
        item.item_type = "recurring"
    await db.flush()
    period = (stmt.year, stmt.month) if stmt is not None else None
    prev = item.item_date if item is not None else entry.expense_date
    await _generate_next(db, series, prev, period)
    return series


async def start_series_from_entry(db: AsyncSession, entry: ExpenseEntry) -> Recurrence:
    """"Hacer recurrente" sobre un gasto ya cargado (directo o de tarjeta)."""
    from app.models.shared_expense import SharedExpenseSplit
    from app.models.mortgage import MortgageRecord

    if await db.scalar(
        select(SharedExpenseSplit.id).where(SharedExpenseSplit.expense_entry_id == entry.id).limit(1)
    ):
        raise HTTPException(status_code=400, detail="Un gasto compartido todavía no puede ser recurrente")
    if await db.scalar(select(MortgageRecord.id).where(MortgageRecord.expense_entry_id == entry.id).limit(1)):
        raise HTTPException(status_code=400, detail="La cuota de un crédito ya se repite sola")
    item = await card_item_of(db, entry.id)
    if item is not None:
        from app.models.shared_expense import SharedExpense

        if await db.scalar(
            select(SharedExpense.id).where(SharedExpense.credit_card_item_id == item.id).limit(1)
        ):
            raise HTTPException(status_code=400, detail="Un gasto compartido todavía no puede ser recurrente")
        card = await db.get(CreditCard, item.statement.card_id)
        return await start_series(db, entry, item=item, card=card, stmt=item.statement)
    return await start_series(db, entry)


async def _generate_next(
    db: AsyncSession,
    series: Recurrence,
    prev_date: date,
    prev_period: tuple[int, int] | None,
) -> ExpenseEntry | None:
    """El pendiente del mes siguiente a `prev_date`, si la serie sigue activa.

    Idempotente: si ya hay un pendiente, lo devuelve sin crear otro.
    """
    if series.status != STATUS_ACTIVE:
        return None
    existing = await pending_of(db, series.id)
    if existing is not None:
        return existing

    when = next_date(prev_date, series.day)
    if series.card_id is not None:
        from app.services.credit_cards import create_expense_entry, find_or_create_statement

        card = await db.get(CreditCard, series.card_id)
        if prev_period is None:
            prev_period = (prev_date.year, prev_date.month)
        year, month = period_after(*prev_period)
        stmt = await find_or_create_statement(card, year, month, series.tenant_id, db)
        entry = await create_expense_entry(
            card, when, series.amount, series.description or "", series.category_id,
            series.tenant_id, series.user_id, db, currency=series.currency,
        )
        entry.recurrence_id = series.id
        entry.recurrence_status = ENTRY_PENDING
        db.add(CreditCardItem(
            statement_id=stmt.id,
            description=series.description or "",
            category_id=series.category_id,
            item_date=when,
            item_type="recurring",
            amount=series.amount,
            currency=series.currency,
            expense_entry_id=entry.id,
            bank_description=series.bank_description,
            capture_source=CAPTURE_SOURCE,
        ))
    else:
        entry = ExpenseEntry(
            tenant_id=series.tenant_id,
            user_id=series.user_id,
            category_id=series.category_id,
            amount=series.amount,
            description=series.description,
            expense_date=when,
            currency=series.currency,
            payment_method=series.payment_method,
            source=EXPENSE_SOURCE_RECURRENCE,
            recurrence_id=series.id,
            recurrence_status=ENTRY_PENDING,
        )
        db.add(entry)
    await db.flush()
    return entry


async def _position(db: AsyncSession, entry: ExpenseEntry) -> tuple[date, tuple[int, int] | None, CreditCardItem | None]:
    """Fecha y período de un mes de la serie: de él sale el siguiente."""
    item = await card_item_of(db, entry.id)
    if item is not None:
        return item.item_date, (item.statement.year, item.statement.month), item
    return entry.expense_date, None, None


def _assert_pending(entry: ExpenseEntry) -> None:
    if entry.recurrence_id is None:
        raise HTTPException(status_code=400, detail="No es un gasto recurrente")
    if entry.recurrence_status != ENTRY_PENDING:
        raise HTTPException(status_code=409, detail="Ese mes ya está confirmado")


@dataclass
class ChainResult:
    entry_id: int | None
    next_entry: ExpenseEntry | None


async def confirm(db: AsyncSession, entry: ExpenseEntry, amount: Decimal | None = None) -> ChainResult:
    """Confirma un mes (con el monto cambiado, si viene) y genera el siguiente."""
    _assert_pending(entry)
    if amount is not None and amount <= 0:
        raise HTTPException(status_code=422, detail="El monto tiene que ser mayor que cero")
    series = await db.get(Recurrence, entry.recurrence_id)
    prev_date, period, item = await _position(db, entry)
    if amount is not None and amount != entry.amount:
        entry.amount = amount
        if item is not None:
            item.amount = amount
    entry.recurrence_status = ENTRY_CONFIRMED
    series.amount = entry.amount
    # El pendiente nuevo choca con el índice único si este no se bajó antes.
    await db.flush()
    nxt = await _generate_next(db, series, prev_date, period)
    return ChainResult(entry.id, nxt)


async def _drop_month(db: AsyncSession, entry: ExpenseEntry, item: CreditCardItem | None) -> None:
    if item is not None:
        await db.delete(item)
        await db.flush()
    await db.delete(entry)
    await db.flush()


async def skip(db: AsyncSession, entry: ExpenseEntry, keep_going: bool) -> ChainResult:
    """"Este mes no": borra el pendiente y, según la respuesta, sigue con el
    mes siguiente (con el último monto confirmado) o da de baja la serie."""
    _assert_pending(entry)
    series = await db.get(Recurrence, entry.recurrence_id)
    prev_date, period, item = await _position(db, entry)
    await _drop_month(db, entry, item)
    if not keep_going:
        series.status = STATUS_ENDED
        series.ended_at = ar_today()
        await db.flush()
        return ChainResult(None, None)
    return ChainResult(None, await _generate_next(db, series, prev_date, period))


async def end(db: AsyncSession, series: Recurrence) -> None:
    """Dar de baja: se borra el mes a confirmar y la serie no genera más."""
    pending = await pending_of(db, series.id)
    if pending is not None:
        item = await card_item_of(db, pending.id)
        await _drop_month(db, pending, item)
    series.status = STATUS_ENDED
    series.ended_at = ar_today()
    await db.flush()


async def on_edited(db: AsyncSession, entry: ExpenseEntry, before: dict) -> None:
    """Un mes **confirmado** cambió de monto, descripción o categoría.

    Si la serie todavía tenía el valor viejo, toma el nuevo, y el pendiente que
    ya se generó con el valor viejo también: es la misma suscripción corregida.
    Un pendiente que la persona ya tocó a mano (otro valor) no se pisa. Editar
    un pendiente no cambia la serie: eso es confirmar con otro monto.
    """
    if entry.recurrence_id is None or entry.recurrence_status != ENTRY_CONFIRMED:
        return
    series = await db.get(Recurrence, entry.recurrence_id)
    if series is None:
        return
    pending = await pending_of(db, series.id)
    pending_item = await card_item_of(db, pending.id) if pending is not None else None
    for field in ("amount", "description", "category_id"):
        if field not in before:
            continue
        old = before[field]
        new = getattr(entry, field)
        if old == new or getattr(series, field) != old:
            continue
        setattr(series, field, new)
        if pending is not None and getattr(pending, field) == old:
            setattr(pending, field, new)
            if pending_item is not None:
                setattr(pending_item, field, new)
    await db.flush()


@dataclass
class PendingRow:
    entry_id: int
    recurrence_id: int
    description: str | None
    amount: Decimal
    currency: str
    date: date
    category_id: int
    card_id: int | None
    card_alias: str | None
    statement_id: int | None
    item_id: int | None
    overdue: bool


async def list_pending(
    db: AsyncSession, tenant_id: int, year: int | None = None, month: int | None = None,
) -> list[PendingRow]:
    """Los meses a confirmar del hogar (para el calendario e Inicio)."""
    # Columnas del ítem y no la entidad: sus `column_property` leen
    # `expense_entries` y, con la entidad de arriba en el mismo SELECT, la
    # subconsulta se autocorrelaciona y queda sin FROM.
    q = (
        select(
            ExpenseEntry,
            CreditCardItem.id.label("item_id"),
            CreditCardItem.description.label("item_description"),
            CreditCardStatement.id.label("statement_id"),
            CreditCard.id.label("card_id"),
            CreditCard.alias.label("card_alias"),
        )
        .outerjoin(CreditCardItem, CreditCardItem.expense_entry_id == ExpenseEntry.id)
        .outerjoin(CreditCardStatement, CreditCardStatement.id == CreditCardItem.statement_id)
        .outerjoin(CreditCard, CreditCard.id == CreditCardStatement.card_id)
        .where(
            ExpenseEntry.tenant_id == tenant_id,
            ExpenseEntry.recurrence_status == ENTRY_PENDING,
        )
        .order_by(ExpenseEntry.expense_date, ExpenseEntry.id)
    )
    if year is not None and month is not None:
        first = date(year, month, 1)
        last = date(year, month, monthrange(year, month)[1])
        q = q.where(ExpenseEntry.expense_date >= first, ExpenseEntry.expense_date <= last)
    today = ar_today()
    rows = []
    for entry, item_id, item_description, statement_id, card_id, card_alias in (await db.execute(q)).all():
        rows.append(PendingRow(
            entry_id=entry.id,
            recurrence_id=entry.recurrence_id,
            description=item_description if item_id is not None else entry.description,
            amount=entry.amount,
            currency=entry.currency,
            date=entry.expense_date,
            category_id=entry.category_id,
            card_id=card_id,
            card_alias=card_alias,
            statement_id=statement_id,
            item_id=item_id,
            overdue=entry.expense_date < today,
        ))
    return rows
