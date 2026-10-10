"""Proveedores y empleados de un negocio, y el gasto pagado a cada uno."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from types import SimpleNamespace

from app.models.credit_card import CreditCard
from app.models.expense import EXPENSE_SOURCE_MANUAL, ExpenseCategory, ExpenseEntry
from app.schemas.credit_card import CreditCardItemCreate
from app.services import expenses as expenses_service
from app.services.business import payees as svc
from app.services.business.analytics import spend_by_payee
from app.services.credit_cards import create_item_in_statement, find_or_create_statement


async def _cat(db, name="Sueldos", tenant_id=1):
    cat = ExpenseCategory(tenant_id=tenant_id, name=name, color="#8b5cf6", is_fixed=True)
    db.add(cat)
    await db.flush()
    return cat


async def test_names_are_unique_folded_per_business(db):
    p = await svc.create_payee(db, 1, name="  Verdulería   Don José ", kind="proveedor")
    assert p.name == "Verdulería Don José"
    with pytest.raises(HTTPException) as exc:
        await svc.create_payee(db, 1, name="verduleria don jose", kind="proveedor")
    assert exc.value.status_code == 409
    # Otro negocio puede tener uno con el mismo nombre.
    await svc.create_payee(db, 2, name="Verdulería Don José", kind="proveedor")


async def test_default_category_must_be_from_the_same_business(db):
    other = await _cat(db, tenant_id=2)
    with pytest.raises(HTTPException) as exc:
        await svc.create_payee(db, 1, name="Juan", kind="empleado", default_category_id=other.id)
    assert exc.value.status_code in (403, 404)

    mine = await _cat(db)
    juan = await svc.create_payee(db, 1, name="Juan", kind="empleado", default_category_id=mine.id)
    assert juan.default_category_id == mine.id


async def test_update_renames_archives_and_clears(db):
    cat = await _cat(db)
    juan = await svc.create_payee(db, 1, name="Juan", kind="empleado", default_category_id=cat.id, notes="turno noche")
    await svc.create_payee(db, 1, name="Pedro", kind="empleado")

    with pytest.raises(HTTPException) as exc:
        await svc.update_payee(db, juan, 1, {"name": "pedro"})
    assert exc.value.status_code == 409

    await svc.update_payee(db, juan, 1, {"default_category_id": None, "notes": None, "is_active": False})
    assert juan.default_category_id is None and juan.notes is None and not juan.is_active
    # Archivado: no aparece en la lista, pero sigue existiendo.
    assert [p.name for p in await svc.list_payees(db, 1)] == ["Pedro"]
    assert len(await svc.list_payees(db, 1, include_inactive=True)) == 2


async def test_resolve_by_exact_name_then_word_prefixes(db):
    await svc.create_payee(db, 1, name="Juan Pérez", kind="empleado")
    await svc.create_payee(db, 1, name="Juana Gómez", kind="empleado")
    await svc.create_payee(db, 1, name="Carnicería El Toro", kind="proveedor")

    assert [p.name for p in await svc.resolve_payee(db, 1, "juan perez")] == ["Juan Pérez"]
    assert {p.name for p in await svc.resolve_payee(db, 1, "juan")} == {"Juan Pérez", "Juana Gómez"}
    assert [p.name for p in await svc.resolve_payee(db, 1, "carni toro")] == ["Carnicería El Toro"]
    assert await svc.resolve_payee(db, 1, "") == []


async def test_expense_payee_must_belong_to_the_business(db):
    cat = await _cat(db)
    foreign = await svc.create_payee(db, 2, name="Ajeno", kind="proveedor")
    with pytest.raises(HTTPException) as exc:
        await expenses_service.create_expense(
            db, tenant_id=1, user_id=1, amount=Decimal("100"), expense_date=date(2026, 10, 1),
            category_id=cat.id, payee_id=foreign.id, source=EXPENSE_SOURCE_MANUAL,
        )
    assert exc.value.status_code == 404

    juan = await svc.create_payee(db, 1, name="Juan", kind="empleado")
    entry = await expenses_service.create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal("100"), expense_date=date(2026, 10, 1),
        category_id=cat.id, payee_id=juan.id, source=EXPENSE_SOURCE_MANUAL,
    )
    assert entry.payee_id == juan.id
    with pytest.raises(HTTPException):
        await expenses_service.update_expense(db, entry, 1, {"payee_id": foreign.id})
    await expenses_service.update_expense(db, entry, 1, {"payee_id": None})
    assert entry.payee_id is None


async def test_spend_by_payee_counts_by_payment_date_and_keeps_currencies_apart(db):
    cat = await _cat(db, "Mercadería")
    distri = await svc.create_payee(db, 1, name="Distribuidora", kind="proveedor")
    juan = await svc.create_payee(db, 1, name="Juan", kind="empleado")

    async def expense(amount, day, payee, currency="ARS"):
        await expenses_service.create_expense(
            db, tenant_id=1, user_id=1, amount=Decimal(amount), expense_date=day,
            category_id=cat.id, currency=currency, payee_id=payee.id, source=EXPENSE_SOURCE_MANUAL,
        )

    await expense("50000", date(2026, 10, 3), distri)
    await expense("30000", date(2026, 10, 20), distri)
    await expense("15", date(2026, 10, 5), distri, currency="USD")
    await expense("80000", date(2026, 10, 7), juan)
    await expense("99999", date(2026, 9, 30), juan)  # septiembre: afuera

    rows = await spend_by_payee(db, 1, date(2026, 10, 1), date(2026, 11, 1))
    by_name = {r.name: r for r in rows}
    assert by_name["Distribuidora"].total == Decimal("80000")
    assert by_name["Distribuidora"].total_usd == Decimal("15")
    assert by_name["Distribuidora"].count == 3
    assert by_name["Juan"].total == Decimal("80000")
    assert by_name["Juan"].kind == "empleado"


async def test_card_purchase_counts_when_the_statement_is_due(db):
    # Comprado en octubre con tarjeta, se paga en noviembre: es gasto de noviembre.
    cat = await _cat(db, "Mercadería")
    distri = await svc.create_payee(db, 1, name="Distribuidora", kind="proveedor")
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa negocio", due_day=10)
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 10, 1, db)
    # Con vencimiento cargado: la estimación (resumen sin fecha) es Postgres
    # puro y el SQLite de los tests no la reproduce (ver conftest).
    stmt.due_date = date(2026, 11, 10)
    item = await create_item_in_statement(
        stmt, card,
        CreditCardItemCreate(
            description="Mayorista", amount=Decimal("120000"), item_date=date(2026, 10, 15),
            category_id=cat.id, item_type="single",
        ),
        SimpleNamespace(id=1, tenant_id=1), db,
    )
    mirrored = await db.get(ExpenseEntry, item.expense_entry_id)
    mirrored.payee_id = distri.id
    await db.flush()

    october = await spend_by_payee(db, 1, date(2026, 10, 1), date(2026, 11, 1))
    november = await spend_by_payee(db, 1, date(2026, 11, 1), date(2026, 12, 1))
    assert october == []
    assert november[0].total == Decimal("120000")


async def test_card_installments_carry_the_payee_to_every_cuota(db):
    cat = await _cat(db, "Mercadería")
    distri = await svc.create_payee(db, 1, name="Distribuidora", kind="proveedor")
    foreign = await svc.create_payee(db, 2, name="Ajeno", kind="proveedor")
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa negocio", due_day=10)
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 10, 1, db)
    user = SimpleNamespace(id=1, tenant_id=1)

    def body(payee_id):
        return CreditCardItemCreate(
            description="Heladera", amount=Decimal("100000"), item_date=date(2026, 10, 5),
            category_id=cat.id, item_type="installment", installment_count=3, payee_id=payee_id,
        )

    with pytest.raises(HTTPException) as exc:
        await create_item_in_statement(stmt, card, body(foreign.id), user, db)
    assert exc.value.status_code == 404

    await create_item_in_statement(stmt, card, body(distri.id), user, db)
    mirrors = (await db.scalars(
        select(ExpenseEntry).where(ExpenseEntry.description.like("Heladera%"))
    )).all()
    assert len(mirrors) == 3
    assert {m.payee_id for m in mirrors} == {distri.id}
