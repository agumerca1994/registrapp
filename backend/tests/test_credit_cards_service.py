"""Tests de `services/credit_cards.py`: planes que entran empezados y el
`scope` de edición — las dos piezas de la Fase 0 de conciliación."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.credit_card import CreditCard, CreditCardItem
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.schemas.credit_card import CreditCardItemCreate
from app.services.credit_cards import (
    apply_item_update,
    create_item_in_statement,
    find_or_create_statement,
    next_month_date,
)

USER = SimpleNamespace(id=1, tenant_id=1)


async def _setup(db, year: int, month: int):
    cat = ExpenseCategory(tenant_id=1, name="Varios", color="#ef4444", is_fixed=False)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa Black", last_4_digits="4919")
    db.add_all([cat, card])
    await db.flush()
    stmt = await find_or_create_statement(card, year, month, 1, db)
    return cat, card, stmt


def _body(**kw) -> CreditCardItemCreate:
    base = dict(
        description="CHANGOMAS",
        item_date=date(2026, 9, 25),
        item_type="installment",
        amount=Decimal("100.00"),
        installment_count=12,
        installment_number=1,
    )
    base.update(kw)
    return CreditCardItemCreate(**base)


async def test_mid_plan_item_propagates_only_remaining_cuotas(db):
    """Cuota 8/12 del resumen del banco: crea 8..12 y nada más (ni 1..7)."""
    cat, card, stmt = await _setup(db, 2026, 9)

    root = await create_item_in_statement(
        stmt, card, _body(category_id=cat.id, installment_number=8), USER, db
    )

    items = (await db.scalars(select(CreditCardItem).order_by(CreditCardItem.id))).all()
    assert [i.installment_number for i in items] == [8, 9, 10, 11, 12]
    assert root.installment_number == 8
    assert all(i.installment_group_id == root.id for i in items[1:])

    # Las cuotas restantes caen en los 4 meses siguientes al período.
    periods = []
    for i in items[1:]:
        s = await db.get(type(stmt), i.statement_id)
        periods.append((s.year, s.month))
    assert periods == [(2026, 10), (2026, 11), (2026, 12), (2027, 1)]

    # Cada cuota tiene su egreso espejo con la etiqueta (n/N).
    entries = (await db.scalars(select(ExpenseEntry).order_by(ExpenseEntry.id))).all()
    assert len(entries) == 5
    assert entries[0].description == "CHANGOMAS (8/12)"
    assert entries[-1].description == "CHANGOMAS (12/12)"


async def test_full_plan_unchanged(db):
    """El caso de siempre (cuota 1) sigue creando el plan entero."""
    cat, card, stmt = await _setup(db, 2026, 9)
    await create_item_in_statement(stmt, card, _body(category_id=cat.id), USER, db)
    items = (await db.scalars(select(CreditCardItem))).all()
    assert sorted(i.installment_number for i in items) == list(range(1, 13))


def test_schema_rejects_cuota_out_of_range():
    with pytest.raises(ValueError):
        _body(installment_number=13)
    with pytest.raises(ValueError):
        _body(installment_number=0)


async def test_update_scope_root_refuses_child(db):
    cat, card, stmt = await _setup(db, 2026, 9)
    root = await create_item_in_statement(
        stmt, card, _body(category_id=cat.id, installment_count=3), USER, db
    )
    child = await db.scalar(
        select(CreditCardItem).where(CreditCardItem.installment_group_id == root.id)
    )
    with pytest.raises(HTTPException):
        await apply_item_update(child, {"amount": Decimal("101.00")}, 1, db)


async def test_update_scope_item_touches_only_that_cuota(db):
    """El redondeo de una cuota puntual (2..N) se corrige sin tocar hermanas."""
    cat, card, stmt = await _setup(db, 2026, 9)
    root = await create_item_in_statement(
        stmt, card, _body(category_id=cat.id, installment_count=3), USER, db
    )
    children = (
        await db.scalars(
            select(CreditCardItem)
            .where(CreditCardItem.installment_group_id == root.id)
            .order_by(CreditCardItem.installment_number)
        )
    ).all()

    await apply_item_update(children[0], {"amount": Decimal("99.97")}, 1, db, scope="item")

    assert children[0].amount == Decimal("99.97")
    assert root.amount == Decimal("100.00")
    assert children[1].amount == Decimal("100.00")
    # El espejo de la cuota corregida también.
    entry = await db.get(ExpenseEntry, children[0].expense_entry_id)
    assert entry.amount == Decimal("99.97")


async def test_update_scope_root_and_future_skips_past_cuotas(db):
    """Editar la raíz propaga a las cuotas de resúmenes futuros; las de meses
    ya cerrados no se tocan (reescribirlas fue un error real)."""
    today = date.today()
    start = next_month_date(date(today.year, today.month, 1), -2)
    cat, card, stmt = await _setup(db, start.year, start.month)

    root = await create_item_in_statement(
        stmt,
        card,
        _body(category_id=cat.id, installment_count=4, item_date=start),
        USER,
        db,
    )
    children = (
        await db.scalars(
            select(CreditCardItem)
            .where(CreditCardItem.installment_group_id == root.id)
            .order_by(CreditCardItem.installment_number)
        )
    ).all()
    # Períodos: raíz hace 2 meses; cuotas en -1, mes actual y +1.
    assert len(children) == 3

    await apply_item_update(root, {"amount": Decimal("103.00")}, 1, db, scope="root_and_future")

    assert root.amount == Decimal("103.00")
    amounts = [c.amount for c in children]
    # Sólo la cuota del mes siguiente (período > hoy) cambió.
    assert amounts == [Decimal("100.00"), Decimal("100.00"), Decimal("103.00")]
