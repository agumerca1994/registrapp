"""Escritura de tarjetas, resúmenes e ítems, compartida por el router y el conector MCP.

Mismo motivo que `services/income.py`: que editar o borrar desde la app y desde
una IA sea el mismo código — el espejo en `expense_entries`, la propagación y el
borrado en cascada de las cuotas, y qué pasa con los egresos al borrar un
resumen o una tarjeta. **Nada de esto hace commit**: decide el que llama.
"""
from calendar import monthrange
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.credit_card import CreditCard, CreditCardStatement, CreditCardItem
from app.models.expense import EXPENSE_SOURCE_CREDIT_CARD, ExpenseEntry
from app.routers.expenses import assert_owns_category
from app.schemas.credit_card import CreditCardItemCreate
from app.services.currency import get_or_create_usd_category


def next_month_date(d: date, months_ahead: int) -> date:
    month = d.month + months_ahead
    year = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


async def find_or_create_statement(
    card: CreditCard, year: int, month: int, tenant_id: int, db: AsyncSession
) -> CreditCardStatement:
    stmt = await db.scalar(
        select(CreditCardStatement).where(
            CreditCardStatement.card_id == card.id,
            CreditCardStatement.year == year,
            CreditCardStatement.month == month,
        )
    )
    if not stmt:
        stmt = CreditCardStatement(
            tenant_id=tenant_id,
            card_id=card.id,
            year=year,
            month=month,
            status="open",
        )
        db.add(stmt)
        await db.flush()
    return stmt


async def create_expense_entry(
    card: CreditCard,
    item_date: date,
    amount: Decimal,
    description: str,
    category_id: int,
    tenant_id: int,
    user_id: int,
    db: AsyncSession,
    currency: str = "ARS",
) -> ExpenseEntry:
    entry = ExpenseEntry(
        tenant_id=tenant_id,
        user_id=user_id,
        category_id=category_id,
        amount=amount,
        description=description,
        expense_date=item_date,
        payment_method="tarjeta_credito",
        entity=card.bank,
        currency=currency,
        source=EXPENSE_SOURCE_CREDIT_CARD,
    )
    db.add(entry)
    await db.flush()
    return entry


async def create_item_in_statement(
    stmt: CreditCardStatement,
    card: CreditCard,
    body: CreditCardItemCreate,
    user,
    db: AsyncSession,
    propagate: bool = True,
) -> CreditCardItem:
    """Crea un ítem en `stmt`, su egreso espejo y, si es en cuotas, las cuotas
    futuras en los resúmenes que correspondan. **Sólo hace flush, nunca commit.**

    Existe para que el alta desde un resumen (`create_item`) y el alta desde el
    formulario unificado de egresos (`create_item_for_card`) sean la misma
    implementación: la segunda además puede compartir el ítem en la misma
    transacción, y eso sólo es posible si nadie confirma a mitad de camino.
    """
    cuota_label = ""
    if body.item_type == "installment":
        cuota_label = f" ({body.installment_number}/{body.installment_count})"

    category_id = body.category_id
    if body.currency == "USD":
        category_id = await get_or_create_usd_category(user.tenant_id, db)
    elif category_id is None:
        raise HTTPException(status_code=422, detail="category_id es requerido para gastos en ARS")
    else:
        await assert_owns_category(category_id, user.tenant_id, db)

    entry = await create_expense_entry(
        card, body.item_date, body.amount,
        f"{body.description}{cuota_label}",
        category_id, user.tenant_id, user.id, db,
        currency=body.currency,
    )

    item = CreditCardItem(
        statement_id=stmt.id,
        description=body.description,
        category_id=category_id,
        item_date=body.item_date,
        item_type=body.item_type,
        amount=body.amount,
        currency=body.currency,
        installment_count=body.installment_count,
        installment_number=body.installment_number if body.item_type == "installment" else None,
        purchase_total=body.purchase_total,
        expense_entry_id=entry.id,
    )
    db.add(item)
    await db.flush()  # need item.id for installment_group_id

    # Un plan puede entrar empezado (`installment_number > 1`): el resumen del
    # banco trae "cuota 8/12" y las cuotas 1..7 vivieron en resúmenes que no
    # están cargados. La cuota que entra es la raíz del grupo y se propagan
    # sólo las que faltan (n+1..N) — mismo camino que los importadores por
    # banco, que hasta ahora eran el único lugar que sabía hacerlo.
    # `propagate=False` la crea suelta: lo usa la conciliación de un resumen
    # viejo, donde las cuotas siguientes pueden existir ya cargadas a mano y
    # propagarlas duplicaría el plan.
    start = body.installment_number or 1
    if propagate and body.item_type == "installment" and body.installment_count and start < body.installment_count:
        for offset in range(1, body.installment_count - start + 1):
            cuota_n = start + offset
            future_date = next_month_date(date(stmt.year, stmt.month, 1), offset)
            future_stmt = await find_or_create_statement(
                card, future_date.year, future_date.month, user.tenant_id, db
            )
            future_item_date = next_month_date(body.item_date, offset)
            # La categoría ya resuelta y no `body.category_id`: hoy da lo mismo
            # porque las cuotas son sólo en pesos, pero es la que se validó.
            future_entry = await create_expense_entry(
                card, future_item_date, body.amount,
                f"{body.description} ({cuota_n}/{body.installment_count})",
                category_id, user.tenant_id, user.id, db,
                currency=body.currency,
            )
            future_item = CreditCardItem(
                statement_id=future_stmt.id,
                description=body.description,
                category_id=category_id,
                item_date=future_item_date,
                item_type="installment",
                amount=body.amount,
                currency=body.currency,
                installment_count=body.installment_count,
                installment_number=cuota_n,
                purchase_total=body.purchase_total,
                installment_group_id=item.id,
                expense_entry_id=future_entry.id,
            )
            db.add(future_item)
        # Las cuotas hijas tienen que existir en la sesión antes de que alguien
        # las busque por `installment_group_id` (compartir en la misma
        # transacción lo hace).
        await db.flush()

    return item


async def _apply_updates_to_item(item: CreditCardItem, updates: dict, db: AsyncSession) -> None:
    """Aplica `updates` a un ítem y replica el cambio en su egreso espejo."""
    for field, value in updates.items():
        setattr(item, field, value)

    if item.expense_entry_id:
        entry = await db.get(ExpenseEntry, item.expense_entry_id)
        if entry:
            if "description" in updates:
                entry.description = updates["description"]
            if "category_id" in updates:
                entry.category_id = updates["category_id"]
            if "item_date" in updates:
                entry.expense_date = updates["item_date"]
            if "amount" in updates:
                entry.amount = updates["amount"]


async def apply_item_update(
    item: CreditCardItem,
    updates: dict,
    tenant_id: int,
    db: AsyncSession,
    scope: str = "root",
) -> None:
    """Edita un ítem y replica el cambio en su egreso espejo.

    `scope` decide qué puede tocarse, y el default es la regla de siempre:

    - `"root"`: sólo la cuota raíz; editar una hija es 400. Las hijas son
      copias que la raíz generó, y editarlas sueltas dejaría el plan con
      montos distintos por cuota.
    - `"item"`: edita exactamente este ítem, sea raíz o cuota 2..N, sin tocar
      hermanas. Existe para la conciliación: el banco redondea distinto una
      cuota puntual y corregirla no puede obligar a reescribir el plan entero.
    - `"root_and_future"`: edita la raíz y replica monto/descripción/categoría
      en las cuotas de resúmenes posteriores al mes actual. Las pasadas no se
      tocan — son meses ya cerrados o conciliados, y reescribirlos en silencio
      fue un error real (se editó la cuota 1 de agosto y hubo que revertirla).
    """
    if scope not in ("root", "item", "root_and_future"):
        raise ValueError(f"scope inválido: {scope!r}")
    if scope != "item" and item.installment_group_id is not None:
        raise HTTPException(status_code=400, detail="Para editar una cuota, ve al resumen de la cuota 1")
    if "category_id" in updates:
        await assert_owns_category(updates["category_id"], tenant_id, db)

    await _apply_updates_to_item(item, updates, db)

    if scope == "root_and_future" and item.item_type == "installment":
        today = date.today()
        children = await db.scalars(
            select(CreditCardItem)
            .join(CreditCardStatement, CreditCardItem.statement_id == CreditCardStatement.id)
            .where(
                CreditCardItem.installment_group_id == item.id,
                (CreditCardStatement.year * 100 + CreditCardStatement.month)
                > today.year * 100 + today.month,
            )
        )
        # item_date no se propaga: cada cuota tiene la suya (compra + n meses).
        propagated = {k: v for k, v in updates.items() if k in ("amount", "description", "category_id")}
        if propagated:
            for child in children.all():
                await _apply_updates_to_item(child, propagated, db)


async def _delete_entry(entry_id: int | None, db: AsyncSession) -> None:
    if entry_id:
        entry = await db.get(ExpenseEntry, entry_id)
        if entry:
            await db.delete(entry)


async def delete_item_tree(item: CreditCardItem, db: AsyncSession) -> None:
    """Borra un ítem y su egreso; si es la raíz de un plan en cuotas, todas las cuotas."""
    if item.installment_group_id is not None:
        raise HTTPException(status_code=400, detail="Para eliminar, ve al resumen de la cuota 1")

    if item.item_type == "installment":
        group_items = await db.scalars(
            select(CreditCardItem).where(CreditCardItem.installment_group_id == item.id)
        )
        for gi in group_items.all():
            await _delete_entry(gi.expense_entry_id, db)
            await db.delete(gi)
        await db.flush()

    await _delete_entry(item.expense_entry_id, db)
    await db.delete(item)


async def delete_statement_tree(
    stmt: CreditCardStatement, keep_expenses: bool, db: AsyncSession,
) -> None:
    """Borra un resumen (con `items` cargado). `keep_expenses` deja sus egresos en Egresos."""
    if not keep_expenses:
        for item in stmt.items:
            await _delete_entry(item.expense_entry_id, db)
        await db.flush()
    await db.delete(stmt)


async def delete_card_tree(card: CreditCard, keep_expenses: bool, db: AsyncSession) -> None:
    """Borra una tarjeta (con `statements.items` cargado) y todos sus resúmenes."""
    if not keep_expenses:
        for stmt in card.statements:
            for item in stmt.items:
                await _delete_entry(item.expense_entry_id, db)
        await db.flush()
    await db.delete(card)
