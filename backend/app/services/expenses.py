"""Escritura de egresos simples, compartida por el router y el conector MCP.

Mismo motivo que `services/income.py` y `services/credit_cards.py`: que cargar,
editar o borrar un gasto desde la app y desde una IA sea el mismo código — la
categoría de USD, el chequeo de propiedad de la categoría, la invalidación de
sugerencias y qué pasa con la hipoteca o el split al borrar. **Nada de esto
hace commit**: decide el que llama.

`linked_to()` existe por el conector: el router deja editar y borrar cualquier
egreso porque el frontend ya esconde los botones de los que son espejo de una
tarjeta, un compartido o la hipoteca. Una IA no tiene esa red, así que la regla
tiene que poder preguntarse en el backend. Se mira el **vínculo real** (la fila
que apunta al egreso), no la columna `source`: las filas viejas la tienen NULL.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credit_card import CreditCardItem
from app.models.expense import ExpenseEntry
from app.models.mortgage import MortgageRecord
from app.models.shared_expense import SharedExpenseSplit
from app.services import category_suggest
from app.services.currency import get_or_create_usd_category

PAYMENT_METHODS = ("efectivo", "debito", "transferencia")


async def linked_to(db: AsyncSession, entry: ExpenseEntry) -> str | None:
    """De qué es espejo este egreso, si de algo: "tarjeta", "compartido",
    "hipoteca" o None (un gasto simple, cargado a mano)."""
    if entry.payment_method == "tarjeta_credito" or await db.scalar(
        select(CreditCardItem.id).where(CreditCardItem.expense_entry_id == entry.id).limit(1)
    ):
        return "tarjeta"
    if await db.scalar(
        select(SharedExpenseSplit.id).where(SharedExpenseSplit.expense_entry_id == entry.id).limit(1)
    ):
        return "compartido"
    if await db.scalar(
        select(MortgageRecord.id).where(MortgageRecord.expense_entry_id == entry.id).limit(1)
    ):
        return "hipoteca"
    return None


async def resolve_category_id(
    db: AsyncSession, tenant_id: int, category_id: int | None, currency: str
) -> int:
    """La categoría de un alta: la elegida (si es del hogar) o, en USD,
    "Consumo en dólares" como respaldo. En ARS es obligatoria."""
    if category_id is None:
        if currency == "USD":
            return await get_or_create_usd_category(tenant_id, db)
        raise HTTPException(status_code=422, detail="category_id es requerido para gastos en ARS")
    from app.routers.expenses import assert_owns_category  # import tardío: ciclo router↔service

    await assert_owns_category(category_id, tenant_id, db)
    return category_id


async def create_expense(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    amount: Decimal,
    expense_date: date,
    category_id: int | None,
    currency: str = "ARS",
    description: str | None = None,
    notes: str | None = None,
    payment_method: str | None = None,
    source: str,
) -> ExpenseEntry:
    """Crea un gasto simple. **Sólo flush.**"""
    entry = ExpenseEntry(
        tenant_id=tenant_id,
        user_id=user_id,
        category_id=await resolve_category_id(db, tenant_id, category_id, currency),
        amount=amount,
        description=description,
        expense_date=expense_date,
        notes=notes,
        currency=currency,
        payment_method=payment_method,
        source=source,
    )
    db.add(entry)
    await db.flush()
    # El corpus de sugerencias cambió. Best-effort: si esto faltara, el gasto
    # nuevo tardaría hasta CACHE_TTL en poder ser sugerido, nunca un dato malo.
    category_suggest.invalidate(tenant_id)
    return entry


async def update_expense(
    db: AsyncSession, entry: ExpenseEntry, tenant_id: int, updates: dict
) -> None:
    """Aplica `updates` a un egreso. **Sólo flush.**"""
    if "category_id" in updates:
        from app.routers.expenses import assert_owns_category

        await assert_owns_category(updates["category_id"], tenant_id, db)
    for field, value in updates.items():
        setattr(entry, field, value)
    await db.flush()
    category_suggest.invalidate(tenant_id)


async def delete_expense(db: AsyncSession, entry: ExpenseEntry, tenant_id: int) -> None:
    """Borra un egreso y suelta lo que lo referencia. **Sólo flush.**

    Un registro de hipoteca que apunta al egreso se borra primero (si no, la
    FK lo impide); un split compartido vuelve a "pending" sin su egreso — el
    mismo comportamiento que tuvo siempre el router.
    """
    mortgage_rec = await db.scalar(
        select(MortgageRecord).where(MortgageRecord.expense_entry_id == entry.id)
    )
    if mortgage_rec:
        await db.delete(mortgage_rec)
        await db.flush()
    split = await db.scalar(
        select(SharedExpenseSplit).where(SharedExpenseSplit.expense_entry_id == entry.id)
    )
    if split:
        split.expense_entry_id = None
        split.status = "pending"
        await db.flush()
    await db.delete(entry)
    await db.flush()
    category_suggest.invalidate(tenant_id)
