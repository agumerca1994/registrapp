"""Objetivos de ahorro: lo juntado, lo que falta por mes y los retiros."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException

from app.models.savings import SavingsGoal
from app.models.tenant import Tenant
from app.models.user import User
from app.services import savings


async def _goal(db, **kw) -> SavingsGoal:
    db.add(Tenant(id=1, name="Casa"))
    db.add(User(id=1, tenant_id=1, firebase_uid="u1", email="a@a.com", display_name="Ana"))
    goal = SavingsGoal(tenant_id=1, user_id=1, name="Vacaciones", currency="USD",
                       target_amount=Decimal("1200"), **kw)
    db.add(goal)
    await db.flush()
    return goal


@pytest.mark.asyncio
async def test_per_month_needed_counts_the_current_month(db):
    goal = await _goal(db, target_date=date(2027, 4, 15))
    await savings.add_contribution(db, goal, 1, Decimal("200"), date(2026, 11, 1), None)
    s = await savings.summarize(db, goal, date(2026, 11, 20))
    assert s.saved == Decimal("200") and s.remaining == Decimal("1000")
    assert s.months_left == 6  # nov, dic, ene, feb, mar, abr
    assert s.per_month_needed == Decimal("166.67")
    assert s.pct == 16.7


@pytest.mark.asyncio
async def test_pace_and_eta(db):
    goal = await _goal(db)
    await savings.add_contribution(db, goal, 1, Decimal("100"), date(2026, 9, 3), None)
    await savings.add_contribution(db, goal, 1, Decimal("200"), date(2026, 10, 3), None)
    s = await savings.summarize(db, goal, date(2026, 11, 20))
    assert s.pace_per_month == Decimal("100.00")  # 300 en 3 meses
    assert s.eta == date(2027, 8, 1)  # faltan 900: 9 meses más
    assert s.months_left is None and not s.overdue


@pytest.mark.asyncio
async def test_withdrawal_cannot_go_negative_and_achieved(db):
    goal = await _goal(db, target_date=date(2026, 10, 1))
    await savings.add_contribution(db, goal, 1, Decimal("100"), date(2026, 9, 1), None)
    with pytest.raises(HTTPException):
        await savings.add_contribution(db, goal, 1, Decimal("-150"), date(2026, 9, 2), None)
    s = await savings.summarize(db, goal, date(2026, 11, 1))
    assert s.overdue and not s.achieved
    await savings.add_contribution(db, goal, 1, Decimal("1100"), date(2026, 11, 1), None)
    s = await savings.summarize(db, goal, date(2026, 11, 1))
    assert s.achieved and not s.overdue and s.remaining == 0


@pytest.mark.asyncio
async def test_deleting_a_contribution_a_withdrawal_used_is_refused(db):
    goal = await _goal(db)
    first = await savings.add_contribution(db, goal, 1, Decimal("100"), date(2026, 9, 1), None)
    await savings.add_contribution(db, goal, 1, Decimal("-80"), date(2026, 9, 2), None)
    with pytest.raises(HTTPException):
        await savings.delete_contribution(db, first)


@pytest.mark.asyncio
async def test_what_was_already_saved_is_not_pace(db):
    goal = await _goal(db)
    await savings.add_contribution(db, goal, 1, Decimal("800"), date(2026, 11, 1), savings.INITIAL_NOTE)
    s = await savings.summarize(db, goal, date(2026, 11, 20))
    assert s.saved == Decimal("800") and s.pace_per_month is None and s.eta is None
    await savings.add_contribution(db, goal, 1, Decimal("100"), date(2026, 11, 10), None)
    s = await savings.summarize(db, goal, date(2026, 11, 20))
    assert s.pace_per_month == Decimal("100.00")


@pytest.mark.asyncio
async def test_monthly_plan_is_due_from_its_day_until_something_is_put(db):
    goal = await _goal(db, plan_amount=Decimal("200"), plan_day=10)
    assert not (await savings.summarize(db, goal, date(2026, 11, 9))).plan_due
    s = await savings.summarize(db, goal, date(2026, 11, 10))
    assert s.plan_due and s.plan_due_amount == Decimal("200")
    assert s.plan_eta == date(2027, 4, 1)  # 1.200 en cuotas de 200: nov a abr
    await savings.add_contribution(db, goal, 1, Decimal("200"), date(2026, 11, 12), savings.PLAN_NOTE)
    s = await savings.summarize(db, goal, date(2026, 11, 20))
    assert not s.plan_due and s.plan_paid_this_month and s.plan_eta == date(2027, 4, 1)
    goal.plan_paused = True
    assert (await savings.summarize(db, goal, date(2026, 12, 15))).plan_due_amount is None


@pytest.mark.asyncio
async def test_the_last_monthly_payment_only_covers_what_is_left(db):
    goal = await _goal(db, plan_amount=Decimal("500"), plan_day=1)
    await savings.add_contribution(db, goal, 1, Decimal("1000"), date(2026, 10, 1), None)
    s = await savings.summarize(db, goal, date(2026, 11, 2))
    assert s.plan_due_amount == Decimal("200")
