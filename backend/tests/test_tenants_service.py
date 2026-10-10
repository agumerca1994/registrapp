"""Hogar o negocio: la conversión del piloto y las categorías sembradas."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource, IncomeType
from app.models.tenant import Tenant
from app.models.user import User
from app.services import tenants as tenants_service
from app.services.tenants import BUSINESS_CATEGORIES


async def _tenant(db, name="Rotisería"):
    tenant = Tenant(name=name)
    db.add(tenant)
    await db.flush()
    user = User(firebase_uid=f"uid-{tenant.id}", tenant_id=tenant.id, email="x@example.com")
    db.add(user)
    await db.flush()
    return tenant, user


async def test_seed_is_idempotent_and_respects_existing_names(db):
    tenant, _ = await _tenant(db)
    # Ya existe escrita distinto: no se duplica.
    db.add(ExpenseCategory(tenant_id=tenant.id, name="mercaderia", color="#000000", is_fixed=False))
    await db.flush()

    assert await tenants_service.seed_business_categories(db, tenant.id) == len(BUSINESS_CATEGORIES) - 1
    assert await tenants_service.seed_business_categories(db, tenant.id) == 0
    sueldos = await db.scalar(select(ExpenseCategory).where(ExpenseCategory.name == "Sueldos"))
    assert sueldos.is_fixed


async def test_convert_refuses_a_tenant_with_household_only_data(db):
    tenant, user = await _tenant(db, "Casa")
    source = IncomeSource(tenant_id=tenant.id, name="Sueldo", income_type=IncomeType.salary)
    db.add(source)
    await db.flush()
    db.add(IncomeEntry(
        tenant_id=tenant.id, user_id=user.id, source_id=source.id,
        amount=Decimal("100"), period_date=date(2026, 9, 1),
    ))
    await db.flush()

    with pytest.raises(HTTPException) as exc:
        await tenants_service.set_kind(db, tenant, "business")
    assert exc.value.status_code == 409
    assert "ingresos" in exc.value.detail
    assert tenant.kind == "household"


async def test_convert_keeps_expenses_and_seeds_categories(db):
    # El dueño pudo haber empezado a cargar gastos antes de la conversión:
    # un negocio los usa igual, así que no bloquean.
    tenant, user = await _tenant(db)
    cat = ExpenseCategory(tenant_id=tenant.id, name="Varios", color="#000000", is_fixed=False)
    db.add(cat)
    await db.flush()
    db.add(ExpenseEntry(
        tenant_id=tenant.id, user_id=user.id, category_id=cat.id,
        amount=Decimal("5000"), expense_date=date(2026, 10, 1),
    ))
    await db.flush()

    seeded = await tenants_service.set_kind(db, tenant, "business")
    assert tenant.kind == "business"
    assert seeded == len(BUSINESS_CATEGORIES)
    assert await tenants_service.tenant_has_data(db, tenant.id)


async def test_unknown_kind_is_rejected(db):
    tenant, _ = await _tenant(db)
    with pytest.raises(HTTPException) as exc:
        await tenants_service.set_kind(db, tenant, "empresa")
    assert exc.value.status_code == 422
