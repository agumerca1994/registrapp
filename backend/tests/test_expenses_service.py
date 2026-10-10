"""`services/expenses.py`: el código que comparten el router de egresos y las
tools `save_expense` / `delete_expense` del conector."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.credit_card import CreditCard
from app.models.expense import EXPENSE_SOURCE_MCP, ExpenseCategory, ExpenseEntry
from app.models.shared_expense import SharedExpenseSplit
from app.schemas.credit_card import CreditCardItemCreate
from app.services import expenses as svc
from app.services.credit_cards import create_item_in_statement, find_or_create_statement

USER = SimpleNamespace(id=1, tenant_id=1)


async def _cat(db, name="Verdulería", tenant_id=1):
    cat = ExpenseCategory(tenant_id=tenant_id, name=name, color="#22c55e", is_fixed=False)
    db.add(cat)
    await db.flush()
    return cat


async def test_create_simple_expense(db):
    cat = await _cat(db)
    entry = await svc.create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal("12000"), expense_date=date(2026, 10, 9),
        category_id=cat.id, description="Verdulería", payment_method="efectivo",
        source=EXPENSE_SOURCE_MCP,
    )
    assert entry.id is not None
    assert entry.source == "mcp"
    assert entry.payment_method == "efectivo"
    assert await svc.linked_to(db, entry) is None


async def test_usd_without_category_falls_back(db):
    entry = await svc.create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal("20"), expense_date=date(2026, 10, 9),
        category_id=None, currency="USD", source=EXPENSE_SOURCE_MCP,
    )
    cat = await db.get(ExpenseCategory, entry.category_id)
    assert cat.name == "Consumo en dólares"


async def test_ars_requires_category(db):
    with pytest.raises(HTTPException) as exc:
        await svc.create_expense(
            db, tenant_id=1, user_id=1, amount=Decimal("100"), expense_date=date(2026, 10, 9),
            category_id=None, source=EXPENSE_SOURCE_MCP,
        )
    assert exc.value.status_code == 422


async def test_category_of_another_household_is_refused(db):
    foreign = await _cat(db, "Ajena", tenant_id=2)
    with pytest.raises(HTTPException):
        await svc.create_expense(
            db, tenant_id=1, user_id=1, amount=Decimal("100"), expense_date=date(2026, 10, 9),
            category_id=foreign.id, source=EXPENSE_SOURCE_MCP,
        )


async def test_update_and_delete(db):
    cat = await _cat(db)
    other = await _cat(db, "Varios")
    entry = await svc.create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal("5000"), expense_date=date(2026, 10, 9),
        category_id=cat.id, source=EXPENSE_SOURCE_MCP,
    )
    await svc.update_expense(db, entry, 1, {"amount": Decimal("5500"), "category_id": other.id})
    assert entry.amount == Decimal("5500")
    assert entry.category_id == other.id

    entry_id = entry.id
    await svc.delete_expense(db, entry, 1)
    assert await db.get(ExpenseEntry, entry_id) is None


async def test_card_mirror_is_detected(db):
    """El espejo de un ítem de tarjeta no es un gasto simple: la tool lo rechaza."""
    cat = await _cat(db)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa")
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 10, 1, db)
    item = await create_item_in_statement(
        stmt, card,
        CreditCardItemCreate(description="SUPER", category_id=cat.id, item_date=date(2026, 10, 2),
                             item_type="single", amount=Decimal("8000")),
        USER, db,
    )
    mirror = await db.get(ExpenseEntry, item.expense_entry_id)
    assert await svc.linked_to(db, mirror) == "tarjeta"


async def test_shared_split_mirror_is_detected_and_delete_resets_split(db):
    cat = await _cat(db)
    entry = await svc.create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal("3000"), expense_date=date(2026, 10, 9),
        category_id=cat.id, source="shared_split",
    )
    split = SharedExpenseSplit(
        shared_expense_id=1, user_id=1, member_name="Yo", amount=Decimal("3000"),
        status="accepted", expense_entry_id=entry.id,
    )
    db.add(split)
    await db.flush()
    assert await svc.linked_to(db, entry) == "compartido"

    # El router sí lo borra (comportamiento de siempre): el split vuelve a pendiente.
    await svc.delete_expense(db, entry, 1)
    await db.refresh(split)
    assert split.expense_entry_id is None
    assert split.status == "pending"
