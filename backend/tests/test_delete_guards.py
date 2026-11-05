"""Lo que no se puede borrar suelto, y los totales de un resumen por moneda."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.credit_card import CreditCard, CreditCardItem
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.mortgage import MortgageRecord
from app.models.shared_expense import SharedExpense
from app.schemas.credit_card import totals_by_currency
from app.services.credit_cards import assert_no_shared_items, find_or_create_statement
from app.services.expenses import assert_deletable


def test_totals_never_mix_currencies():
    items = [
        SimpleNamespace(amount=Decimal("100"), currency="ARS"),
        SimpleNamespace(amount=Decimal("50"), currency="ARS"),
        SimpleNamespace(amount=Decimal("7"), currency="USD"),
    ]
    assert totals_by_currency(items) == (Decimal("150"), Decimal("7"))
    assert totals_by_currency([]) == (Decimal("0"), Decimal("0"))


async def _entry(db, **kw) -> ExpenseEntry:
    cat = ExpenseCategory(tenant_id=1, name="Varios", color="#ef4444", is_fixed=False)
    db.add(cat)
    await db.flush()
    entry = ExpenseEntry(tenant_id=1, user_id=1, category_id=cat.id, amount=Decimal("10"),
                         expense_date=date(2026, 9, 1), currency="ARS", **kw)
    db.add(entry)
    await db.flush()
    return entry


async def _item(db) -> CreditCardItem:
    entry = await _entry(db, payment_method="tarjeta_credito")
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa", last_4_digits="4919")
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 9, 1, db)
    item = CreditCardItem(statement_id=stmt.id, description="Súper", item_date=date(2026, 9, 1),
                          item_type="single", amount=Decimal("10"), currency="ARS",
                          expense_entry_id=entry.id, category_id=entry.category_id)
    db.add(item)
    await db.flush()
    return item


async def test_simple_expense_can_be_deleted(db):
    await assert_deletable(db, await _entry(db, payment_method="efectivo"))


async def test_card_mirror_cannot_be_deleted_alone(db):
    item = await _item(db)
    entry = await db.get(ExpenseEntry, item.expense_entry_id)
    with pytest.raises(HTTPException) as exc:
        await assert_deletable(db, entry)
    assert exc.value.status_code == 409


async def test_mortgage_cuota_cannot_be_deleted_through_its_expense(db):
    entry = await _entry(db, payment_method="debito")
    db.add(MortgageRecord(tenant_id=1, period_date=date(2026, 9, 1), payment_amount=Decimal("10"),
                          expense_entry_id=entry.id))
    await db.flush()
    with pytest.raises(HTTPException) as exc:
        await assert_deletable(db, entry)
    assert exc.value.status_code == 409


async def test_shared_item_blocks_delete(db):
    item = await _item(db)
    await assert_no_shared_items([item.id], db)  # sin compartir, pasa
    db.add(SharedExpense(tenant_id=1, created_by_user_id=1, title="Súper", total_amount=Decimal("10"),
                         category_id=item.category_id, split_type="equal", expense_date=date(2026, 9, 1),
                         payment_date=date(2026, 10, 1), credit_card_item_id=item.id))
    await db.flush()
    with pytest.raises(HTTPException) as exc:
        await assert_no_shared_items([item.id], db)
    assert exc.value.status_code == 409
    await assert_no_shared_items([], db)
