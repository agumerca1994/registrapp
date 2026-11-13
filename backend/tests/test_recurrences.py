"""Gastos recurrentes (`services/recurrences.py`): la cadena de meses.

Las reglas que fijan estos tests son del usuario: crear o confirmar genera el
mes siguiente y nada más; un pendiente suma y no vence; "este mes no" sigue o da
de baja; con tarjeta, el mes siguiente va al resumen del período siguiente.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.recurrence import Recurrence
from app.schemas.credit_card import CreditCardItemCreate
from app.services import recurrences
from app.services.credit_cards import (
    apply_item_update,
    create_item_in_statement,
    find_or_create_statement,
)
from app.services.expenses import create_expense, update_expense

USER = SimpleNamespace(id=1, tenant_id=1)


async def _cat(db) -> ExpenseCategory:
    cat = ExpenseCategory(tenant_id=1, name="Suscripciones", color="#ef4444", is_fixed=False)
    db.add(cat)
    await db.flush()
    return cat


async def _direct(db, cat, *, amount="10000", when=date(2026, 11, 11)) -> ExpenseEntry:
    return await create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal(amount), expense_date=when,
        category_id=cat.id, description="Gimnasio", payment_method="debito",
        source="manual", recurring=True,
    )


async def _pendings(db) -> list[ExpenseEntry]:
    return (await db.scalars(
        select(ExpenseEntry).where(ExpenseEntry.recurrence_status == "pending").order_by(ExpenseEntry.id)
    )).all()


def test_next_date_keeps_the_series_day():
    """31/1 → 28/2 → 31/3: anclado al día de la serie, no al del mes anterior."""
    feb = recurrences.next_date(date(2027, 1, 31), 31)
    assert feb == date(2027, 2, 28)
    assert recurrences.next_date(feb, 31) == date(2027, 3, 31)
    assert recurrences.next_date(date(2026, 12, 11), 11) == date(2027, 1, 11)


async def test_creating_a_recurring_expense_generates_next_month(db):
    cat = await _cat(db)
    first = await _direct(db, cat)

    assert first.recurrence_status == "confirmed"
    [pending] = await _pendings(db)
    assert pending.expense_date == date(2026, 12, 11)
    assert pending.amount == Decimal("10000")
    assert pending.payment_method == "debito"
    assert pending.description == "Gimnasio"
    assert pending.recurrence_id == first.recurrence_id
    assert pending.source == "recurrence"


async def test_unconfirmed_month_does_not_generate_more(db):
    """Sin confirmar no aparece el mes siguiente: un solo pendiente, siempre."""
    cat = await _cat(db)
    await _direct(db, cat)
    total = await db.scalar(select(func.count()).select_from(ExpenseEntry))
    assert total == 2


async def test_confirm_with_new_amount_updates_series_and_chains(db):
    cat = await _cat(db)
    first = await _direct(db, cat)
    [dec] = await _pendings(db)

    result = await recurrences.confirm(db, dec, Decimal("12500"))

    assert dec.recurrence_status == "confirmed"
    assert dec.amount == Decimal("12500")
    series = await db.get(Recurrence, first.recurrence_id)
    assert series.amount == Decimal("12500")
    assert result.next_entry.expense_date == date(2027, 1, 11)
    assert result.next_entry.amount == Decimal("12500")
    assert [p.id for p in await _pendings(db)] == [result.next_entry.id]

    with pytest.raises(HTTPException) as e:
        await recurrences.confirm(db, dec)
    assert e.value.status_code == 409


async def test_overdue_pending_can_still_be_confirmed(db):
    """No vence: un pendiente con fecha pasada se confirma igual."""
    cat = await _cat(db)
    await _direct(db, cat, when=date(2025, 1, 5))
    [pending] = await _pendings(db)
    rows = await recurrences.list_pending(db, 1)
    assert rows[0].overdue is True
    result = await recurrences.confirm(db, pending)
    assert result.next_entry.expense_date == date(2025, 3, 5)


async def test_skip_and_keep_going_generates_the_following_month(db):
    cat = await _cat(db)
    await _direct(db, cat)
    [dec] = await _pendings(db)

    result = await recurrences.skip(db, dec, keep_going=True)

    dates = (await db.scalars(select(ExpenseEntry.expense_date).order_by(ExpenseEntry.expense_date))).all()
    assert dates == [date(2026, 11, 11), date(2027, 1, 11)]  # diciembre no está
    assert result.next_entry.expense_date == date(2027, 1, 11)
    assert result.next_entry.amount == Decimal("10000")


async def test_skip_and_stop_ends_the_series(db):
    cat = await _cat(db)
    first = await _direct(db, cat)
    [dec] = await _pendings(db)

    result = await recurrences.skip(db, dec, keep_going=False)

    assert result.next_entry is None
    assert await _pendings(db) == []
    series = await db.get(Recurrence, first.recurrence_id)
    assert series.status == "ended"


async def test_end_series_deletes_the_pending_month(db):
    cat = await _cat(db)
    first = await _direct(db, cat)
    series = await db.get(Recurrence, first.recurrence_id)
    await recurrences.end(db, series)
    assert await _pendings(db) == []
    assert series.status == "ended"
    # El mes confirmado se queda: es un gasto que pasó.
    assert await db.get(ExpenseEntry, first.id) is not None


async def test_correcting_a_confirmed_amount_updates_the_untouched_pending(db):
    cat = await _cat(db)
    first = await _direct(db, cat)
    await update_expense(db, first, 1, {"amount": Decimal("11000")})
    [pending] = await _pendings(db)
    assert pending.amount == Decimal("11000")
    assert (await db.get(Recurrence, first.recurrence_id)).amount == Decimal("11000")


async def test_card_recurring_goes_to_next_period_statement(db):
    """Con tarjeta, el mes siguiente es un ítem del resumen del período siguiente,
    aunque la fecha caiga en otro mes. Y en dólares también se puede."""
    await _cat(db)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa", last_4_digits="4919")
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 12, 1, db)
    body = CreditCardItemCreate(
        description="NETFLIX", item_date=date(2026, 11, 28), item_type="recurring",
        amount=Decimal("9.99"), currency="USD",
    )
    item = await create_item_in_statement(stmt, card, body, USER, db)

    [pending] = await _pendings(db)
    p_item = await db.scalar(select(CreditCardItem).where(CreditCardItem.expense_entry_id == pending.id))
    p_stmt = await db.get(CreditCardStatement, p_item.statement_id)
    assert (p_stmt.year, p_stmt.month) == (2027, 1)
    assert p_item.item_date == date(2026, 12, 28)
    assert p_item.item_type == "recurring"
    assert p_item.currency == "USD"
    assert pending.payment_method == "tarjeta_credito"

    # Confirmar desde el ítem: el siguiente va a febrero.
    result = await recurrences.confirm(db, pending, Decimal("10.99"))
    assert p_item.amount == Decimal("10.99")
    n_item = await db.scalar(
        select(CreditCardItem).where(CreditCardItem.expense_entry_id == result.next_entry.id)
    )
    n_stmt = await db.get(CreditCardStatement, n_item.statement_id)
    assert (n_stmt.year, n_stmt.month) == (2027, 2)
    assert n_item.amount == Decimal("10.99")

    # Corregir el ítem confirmado de origen no pisa un pendiente ya confirmado
    # con otro monto (la serie ya tiene 10,99).
    await apply_item_update(item, {"amount": Decimal("8.99")}, 1, db)
    assert n_item.amount == Decimal("10.99")


async def test_card_skip_removes_the_item_too(db):
    cat = await _cat(db)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa", last_4_digits="4919")
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 11, 1, db)
    await create_item_in_statement(stmt, card, CreditCardItemCreate(
        description="SPOTIFY", category_id=cat.id, item_date=date(2026, 11, 3),
        item_type="recurring", amount=Decimal("4500"),
    ), USER, db)
    [pending] = await _pendings(db)
    await recurrences.skip(db, pending, keep_going=False)
    count = await db.scalar(select(func.count()).select_from(CreditCardItem))
    assert count == 1


async def test_installment_cannot_become_recurring(db):
    cat = await _cat(db)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa", last_4_digits="4919")
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 11, 1, db)
    item = await create_item_in_statement(stmt, card, CreditCardItemCreate(
        description="HELADERA", category_id=cat.id, item_date=date(2026, 11, 3),
        item_type="installment", amount=Decimal("100"), installment_count=3,
    ), USER, db)
    entry = await db.get(ExpenseEntry, item.expense_entry_id)
    with pytest.raises(HTTPException) as e:
        await recurrences.start_series_from_entry(db, entry)
    assert e.value.status_code == 400


async def test_existing_expense_can_be_made_recurring(db):
    cat = await _cat(db)
    entry = await create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal("80000"), expense_date=date(2026, 11, 1),
        category_id=cat.id, description="Alquiler", payment_method="transferencia", source="manual",
    )
    await recurrences.start_series_from_entry(db, entry)
    [pending] = await _pendings(db)
    assert pending.expense_date == date(2026, 12, 1)
    with pytest.raises(HTTPException) as e:
        await recurrences.start_series_from_entry(db, entry)
    assert e.value.status_code == 409


async def test_usd_installments_still_rejected():
    with pytest.raises(ValueError):
        CreditCardItemCreate(
            description="X", item_date=date(2026, 11, 1), item_type="installment",
            amount=Decimal("10"), currency="USD", installment_count=3,
        )


async def test_direct_pending_shows_in_upcoming_and_card_pending_does_not(db):
    """Lo que viene en Inicio: el recurrente directo aparece; el de tarjeta ya
    está en el total de su resumen y no se suma de nuevo."""
    from app.services.analytics import _upcoming_items

    cat = await _cat(db)
    await _direct(db, cat, when=date(2026, 11, 11))
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa", last_4_digits="4919")
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 11, 1, db)
    await create_item_in_statement(stmt, card, CreditCardItemCreate(
        description="SPOTIFY", category_id=cat.id, item_date=date(2026, 11, 3),
        item_type="recurring", amount=Decimal("4500"),
    ), USER, db)

    items = await _upcoming_items(db, 1, date(2026, 11, 20), date(2027, 1, 4))
    recurring = [i for i in items if i.kind == "recurring"]
    assert [(i.title, i.date, i.amount) for i in recurring] == [("Gimnasio", date(2026, 12, 11), Decimal("10000"))]
