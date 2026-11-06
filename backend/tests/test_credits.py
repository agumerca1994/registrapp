"""Créditos: el cálculo de cuotas, la sincronización y lo que ve el analytics."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from sqlalchemy import select

from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.macro_variable import MacroVariable
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.models.tenant import Tenant
from app.models.user import User
from app.services import analytics, credits


def _loan(**kw) -> MortgageLoan:
    base = dict(
        tenant_id=1, kind="personal", adjustment="fija", amortization="frances", method="formula",
        currency="ARS", loan_type="tasa_fija", total_cuotas=12,
        first_payment_date=date(2026, 1, 1), payment_day=10, is_active=True,
    )
    base.update(kw)
    return MortgageLoan(**base)


def test_french_cuota_is_level_and_pays_off():
    loan = _loan(capital=Decimal("1200000"), tna=Decimal("60"))
    rows = [credits.schedule_row(loan, n) for n in range(1, 13)]
    first = rows[0].cuota
    assert all(abs(r.cuota - first) < Decimal("0.01") for r in rows)
    # 60% TNA → 5% mensual: cuota de 1.200.000 en 12 = 135.390,49
    assert round(first, 2) == Decimal("135390.49")
    assert rows[-1].balance < Decimal("0.01")
    assert round(rows[0].interest, 2) == Decimal("60000.00")


def test_german_capital_is_level_and_cuota_drops():
    loan = _loan(capital=Decimal("1200000"), tna=Decimal("60"), amortization="aleman")
    r1, r2, r12 = (credits.schedule_row(loan, n) for n in (1, 2, 12))
    assert r1.capital == r2.capital == Decimal("100000")
    assert r1.cuota > r2.cuota > r12.cuota
    assert r12.balance == 0


def test_american_pays_interest_then_capital():
    loan = _loan(capital=Decimal("1000"), tna=Decimal("12"), amortization="americano", total_cuotas=3)
    r1, r3 = credits.schedule_row(loan, 1), credits.schedule_row(loan, 3)
    assert r1.cuota == Decimal("10") and r1.capital == 0
    assert r3.cuota == Decimal("1010")


def test_no_interest_splits_capital_evenly():
    loan = _loan(capital=Decimal("90000"), tna=None, total_cuotas=3)
    assert [credits.schedule_row(loan, n).cuota for n in (1, 2, 3)] == [Decimal("30000")] * 3


def test_known_cuota_and_manual():
    known = _loan(method="cuota", cuota_pesos=Decimal("85000"), total_cuotas=18)
    assert credits.schedule_row(known, 5).cuota == Decimal("85000")
    assert credits.schedule_row(known, 19) is None
    assert credits.schedule_row(_loan(method="manual", kind="plan_ahorro"), 1) is None


def test_legacy_types_round_trip():
    for legacy in ("uva_frances", "uva_aleman", "tasa_fija", "tasa_variable"):
        f = credits.from_legacy_type(legacy)
        assert credits.legacy_loan_type(f["adjustment"], f["amortization"], f["method"]) == legacy


async def _household(db) -> User:
    db.add(Tenant(id=1, name="Casa"))
    user = User(id=1, tenant_id=1, firebase_uid="u1", email="a@a.com", display_name="Ana")
    db.add(user)
    await db.flush()
    return user


@pytest.mark.asyncio
async def test_sync_registers_due_cuotas_once_and_stops_at_the_end(db):
    user = await _household(db)
    loan = _loan(method="cuota", cuota_pesos=Decimal("50000"), total_cuotas=3, first_payment_date=date(2026, 1, 1))
    db.add(loan)
    await db.flush()
    with patch("app.services.credits.ar_today", return_value=date(2026, 11, 5)):
        assert await credits.sync_loan(db, loan, user.id) == 3
        assert await credits.sync_loan(db, loan, user.id) == 0
    records = (await db.scalars(select(MortgageRecord).order_by(MortgageRecord.period_date))).all()
    assert [r.cuota_number for r in records] == [1, 2, 3]
    entry = await db.get(ExpenseEntry, records[0].expense_entry_id)
    assert entry.expense_date == date(2026, 1, 10) and entry.source == "mortgage"
    cat = await db.get(ExpenseCategory, entry.category_id)
    assert cat.name == "Préstamo personal"


@pytest.mark.asyncio
async def test_hipoteca_reuses_existing_category_regardless_of_case(db):
    user = await _household(db)
    db.add(ExpenseCategory(tenant_id=1, name="hipoteca", color="#000"))
    loan = _loan(kind="hipotecario", method="cuota", cuota_pesos=Decimal("1"), total_cuotas=1)
    db.add(loan)
    await db.flush()
    with patch("app.services.credits.ar_today", return_value=date(2026, 11, 5)):
        await credits.sync_loan(db, loan, user.id)
    names = (await db.scalars(select(ExpenseCategory.name))).all()
    assert names == ["hipoteca"]


@pytest.mark.asyncio
async def test_uva_cuota_uses_the_uva_of_its_payment_day(db):
    user = await _household(db)
    db.add(MacroVariable(period_date=date(2026, 1, 10), uva_value=Decimal("1500")))
    db.add(MacroVariable(period_date=date(2026, 2, 10), uva_value=Decimal("1600")))
    loan = _loan(adjustment="uva", method="cuota", cuota_uva=Decimal("100"), total_cuotas=2,
                 loan_type="uva_frances", kind="hipotecario")
    db.add(loan)
    await db.flush()
    with patch("app.services.credits.ar_today", return_value=date(2026, 3, 1)):
        await credits.sync_loan(db, loan, user.id)
    amounts = (await db.scalars(select(MortgageRecord.payment_amount).order_by(MortgageRecord.period_date))).all()
    assert amounts == [Decimal("150000"), Decimal("160000")]


@pytest.mark.asyncio
async def test_month_projection_adds_every_ars_loan_and_skips_recorded_and_usd(db):
    user = await _household(db)
    a = _loan(method="cuota", cuota_pesos=Decimal("100"), first_payment_date=date(2026, 11, 1))
    b = _loan(method="cuota", cuota_pesos=Decimal("200"), first_payment_date=date(2026, 11, 1))
    usd = _loan(method="cuota", cuota_pesos=Decimal("50"), currency="USD", first_payment_date=date(2026, 11, 1))
    manual = _loan(method="manual", kind="plan_ahorro", first_payment_date=date(2026, 11, 1))
    db.add_all([a, b, usd, manual])
    await db.flush()
    start, end = date(2026, 11, 1), date(2026, 12, 1)
    assert await analytics.mortgage_payment_for_month(db, 1, start, end) == (Decimal("300"), True)

    await credits.record_payment(db, a, user.id, period=start, pay_day=date(2026, 11, 10),
                                 amount=Decimal("100"), number=1)
    # Lo que falta es sólo la del otro: la registrada ya es un egreso.
    assert await analytics.mortgage_payment_for_month(db, 1, start, end) == (Decimal("200"), True)
    await credits.record_payment(db, b, user.id, period=start, pay_day=date(2026, 11, 10),
                                 amount=Decimal("200"), number=1)
    assert await analytics.mortgage_payment_for_month(db, 1, start, end) == (Decimal("300"), False)


@pytest.mark.asyncio
async def test_summary_counts_paid_and_balance(db):
    user = await _household(db)
    loan = _loan(capital=Decimal("90000"), tna=None, total_cuotas=3, first_payment_date=date(2026, 10, 1))
    db.add(loan)
    await db.flush()
    with patch("app.services.credits.ar_today", return_value=date(2026, 11, 20)):
        await credits.sync_loan(db, loan, user.id)
        s = await credits.summarize(db, loan, date(2026, 11, 20))
    assert s.cuotas_pagadas == 2 and s.cuota_numero == 3
    assert s.balance == Decimal("30000")
    assert s.next_amount == Decimal("30000")
    assert s.total_paid == Decimal("60000")


@pytest.mark.asyncio
async def test_manual_payment_can_be_deleted_but_synced_cannot(db):
    user = await _household(db)
    loan = _loan(method="manual", kind="plan_ahorro")
    db.add(loan)
    await db.flush()
    rec = await credits.record_payment(db, loan, user.id, period=date(2026, 1, 1), pay_day=date(2026, 1, 15),
                                       amount=Decimal("80000"), number=1, manual=True)
    await credits.delete_manual_payment(db, rec)
    assert (await db.scalars(select(ExpenseEntry))).all() == []

    synced = await credits.record_payment(db, loan, user.id, period=date(2026, 2, 1), pay_day=date(2026, 2, 15),
                                          amount=Decimal("1"), number=2)
    with pytest.raises(Exception):
        await credits.delete_manual_payment(db, synced)


@pytest.mark.asyncio
async def test_manual_counts_what_was_loaded_not_the_calendar(db):
    user = await _household(db)
    loan = _loan(method="manual", kind="plan_ahorro", total_cuotas=84, first_payment_date=date(2026, 10, 1))
    db.add(loan)
    await db.flush()
    s = await credits.summarize(db, loan, date(2026, 11, 20))
    assert s.cuotas_pagadas == 0 and s.pct_completado == 0
    await credits.record_payment(db, loan, user.id, period=date(2026, 11, 1), pay_day=date(2026, 11, 5),
                                 amount=Decimal("90000"), number=2, manual=True)
    s = await credits.summarize(db, loan, date(2026, 11, 20))
    assert s.cuotas_pagadas == 1 and s.this_month_paid == Decimal("90000")
