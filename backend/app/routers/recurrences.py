"""Gastos recurrentes: confirmar, "este mes no" y dar de baja.

La lógica es `services/recurrences.py`; esto es la cáscara. Cada mes se nombra
por su gasto (`entry_id`), que tienen tanto un gasto directo como el espejo de
un ítem de tarjeta: la pantalla no necesita saber cuál de los dos es.
"""
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, get_actor
from app.core.database import get_db
from app.models.recurrence import STATUS_ACTIVE, Recurrence
from app.services import recurrences

router = APIRouter(prefix="/recurrences", tags=["recurrences"])


async def _actor(actor: Actor | None = Depends(get_actor)) -> Actor:
    if actor is None:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return actor


class PendingRecurrenceOut(BaseModel):
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


class RecurrenceOut(BaseModel):
    model_config = {"from_attributes": True}

    id: int
    description: str | None
    category_id: int
    currency: str
    amount: Decimal
    day: int
    card_id: int | None
    payment_method: str | None
    status: str
    pending_entry_id: int | None = None


class ChainOut(BaseModel):
    """Lo que quedó después de una acción: el mes siguiente, si se generó."""
    next: PendingRecurrenceOut | None = None


class ConfirmBody(BaseModel):
    # Vacío = confirmar con el monto que tenía.
    amount: Decimal | None = None


class SkipBody(BaseModel):
    # La respuesta a "¿y el mes que sigue?": True sigue, False da de baja.
    keep_going: bool


async def _chain_out(db: AsyncSession, tenant_id: int, result: recurrences.ChainResult) -> ChainOut:
    if result.next_entry is None:
        return ChainOut()
    rows = await recurrences.list_pending(db, tenant_id)
    row = next((r for r in rows if r.entry_id == result.next_entry.id), None)
    return ChainOut(next=PendingRecurrenceOut(**row.__dict__) if row else None)


@router.get("", response_model=list[RecurrenceOut])
async def list_series(actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    """Las series activas del hogar, con su mes a confirmar si hay uno."""
    rows = await db.scalars(
        select(Recurrence)
        .where(Recurrence.tenant_id == actor.user.tenant_id, Recurrence.status == STATUS_ACTIVE)
        .order_by(Recurrence.description)
    )
    pending = {p.recurrence_id: p.entry_id for p in await recurrences.list_pending(db, actor.user.tenant_id)}
    out = []
    for s in rows.all():
        o = RecurrenceOut.model_validate(s)
        o.pending_entry_id = pending.get(s.id)
        out.append(o)
    return out


@router.get("/pending", response_model=list[PendingRecurrenceOut])
async def list_pending(
    year: int | None = Query(default=None, ge=2000, le=2100),
    month: int | None = Query(default=None, ge=1, le=12),
    actor: Actor = Depends(_actor),
    db: AsyncSession = Depends(get_db),
):
    """Los meses a confirmar: para el calendario (con `year`/`month`) e Inicio (todos)."""
    rows = await recurrences.list_pending(db, actor.user.tenant_id, year, month)
    return [PendingRecurrenceOut(**r.__dict__) for r in rows]


@router.post("/entries/{entry_id}/start", response_model=ChainOut)
async def start_from_entry(
    entry_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    """"Hacer recurrente" un gasto ya cargado: nace la serie y el mes siguiente."""
    entry = await recurrences.get_entry(db, actor.user.tenant_id, entry_id)
    series = await recurrences.start_series_from_entry(db, entry)
    nxt = await recurrences.pending_of(db, series.id)
    await db.commit()
    return await _chain_out(db, actor.user.tenant_id, recurrences.ChainResult(entry.id, nxt))


@router.post("/entries/{entry_id}/confirm", response_model=ChainOut)
async def confirm(
    entry_id: int, body: ConfirmBody, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    entry = await recurrences.get_entry(db, actor.user.tenant_id, entry_id)
    result = await recurrences.confirm(db, entry, body.amount)
    await db.commit()
    return await _chain_out(db, actor.user.tenant_id, result)


@router.post("/entries/{entry_id}/skip", response_model=ChainOut)
async def skip(
    entry_id: int, body: SkipBody, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    entry = await recurrences.get_entry(db, actor.user.tenant_id, entry_id)
    result = await recurrences.skip(db, entry, body.keep_going)
    await db.commit()
    return await _chain_out(db, actor.user.tenant_id, result)


@router.post("/{series_id}/end", status_code=204)
async def end_series(series_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    series = await recurrences.get_series(db, actor.user.tenant_id, series_id)
    await recurrences.end(db, series)
    await db.commit()
