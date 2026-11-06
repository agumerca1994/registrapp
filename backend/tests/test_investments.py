"""Inversiones: cuánto vale cada tipo, renovar un plazo fijo y rescatar."""
from datetime import date
from decimal import Decimal
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from app.models.investment import Investment, InvestmentMovement
from app.models.tenant import Tenant
from app.models.user import User
from app.services import investments as svc


def _inv(**kw) -> Investment:
    base = dict(id=1, tenant_id=1, name="X", kind="efectivo", currency="ARS", start_date=date(2026, 1, 1))
    base.update(kw)
    return Investment(**base)


def _mv(i, kind, amount, day) -> InvestmentMovement:
    return InvestmentMovement(id=i, tenant_id=1, investment_id=1, kind=kind, amount=Decimal(amount), movement_date=day)


def test_plazo_fijo_simple_interest_until_maturity():
    inv = _inv(kind="plazo_fijo", tna=Decimal("36.5"), maturity_date=date(2026, 1, 31))
    ms = [_mv(1, "deposit", "1000000", date(2026, 1, 1))]
    mid = svc.valuate(inv, ms, date(2026, 1, 11))
    assert mid.value == Decimal("1010000.00") and mid.calculated and not mid.matured
    after = svc.valuate(inv, ms, date(2026, 3, 1))  # no sigue rindiendo después de vencer
    assert after.value == Decimal("1030000.00") == after.value_at_maturity and after.matured
    assert after.gain == Decimal("30000.00") and after.gain_pct == 3.0


def test_cuenta_compounds_daily_and_follows_movements():
    inv = _inv(kind="cuenta", tna=Decimal("36.5"))
    ms = [_mv(1, "deposit", "1000", date(2026, 1, 1)), _mv(2, "withdrawal", "500", date(2026, 1, 3))]
    v = svc.valuate(inv, ms, date(2026, 1, 3))
    # 1000 · 1,001² − 500
    assert v.value == Decimal("502.00") and v.invested == Decimal("500.00")


def test_market_uses_last_value_plus_what_came_after():
    inv = _inv(kind="fci")
    ms = [
        _mv(1, "deposit", "1000", date(2026, 1, 1)),
        _mv(2, "valuation", "1200", date(2026, 2, 1)),
        _mv(3, "deposit", "300", date(2026, 2, 10)),
    ]
    v = svc.valuate(inv, ms, date(2026, 3, 3))
    assert v.value == Decimal("1500.00") and v.invested == Decimal("1300.00") and v.gain == Decimal("200.00")
    assert v.value_date == date(2026, 2, 1) and v.stale_days == 30 and not v.calculated


def test_without_any_value_a_market_investment_is_worth_what_you_put():
    v = svc.valuate(_inv(kind="acciones"), [_mv(1, "deposit", "800", date(2026, 1, 1))], date(2026, 1, 21))
    assert v.value == Decimal("800.00") and v.gain == 0 and v.stale_days == 20


def test_closed_reports_the_realized_result():
    inv = _inv(kind="cripto", closed_at=date(2026, 5, 1))
    ms = [_mv(1, "deposit", "1000", date(2026, 1, 1)), _mv(2, "withdrawal", "900", date(2026, 5, 1))]
    v = svc.valuate(inv, ms, date(2026, 6, 1))
    assert v.value == 0 and v.gain == Decimal("-100.00") and v.gain_pct == -10.0


async def _stored(db, **kw) -> Investment:
    db.add(Tenant(id=1, name="Casa"))
    db.add(User(id=1, tenant_id=1, firebase_uid="u1", email="a@a.com", display_name="Ana"))
    inv = _inv(**kw)
    inv.id = None
    db.add(inv)
    await db.flush()
    return inv


@pytest.mark.asyncio
async def test_renew_carries_the_interest_into_the_new_term(db):
    inv = await _stored(db, kind="plazo_fijo", tna=Decimal("36.5"), maturity_date=date(2026, 1, 31))
    with patch("app.services.investments.ar_today", return_value=date(2026, 2, 1)):
        await svc.add_movement(db, inv, 1, "deposit", Decimal("1000000"), date(2026, 1, 1))
        await svc.renew(db, inv, 1, date(2026, 3, 2), Decimal("73"), None, Decimal("30000"))
    v = svc.valuate(inv, await svc.movements_of(db, inv.id), date(2026, 2, 10))
    # Se sacó el interés: arranca de nuevo en 1.000.000 al 73% desde el 31/1.
    assert v.value == Decimal("1020000.00")
    assert inv.start_date == date(2026, 1, 31) and not v.matured


@pytest.mark.asyncio
async def test_cannot_take_more_than_it_is_worth_and_close(db):
    inv = await _stored(db, kind="efectivo")
    with patch("app.services.investments.ar_today", return_value=date(2026, 2, 1)):
        await svc.add_movement(db, inv, 1, "deposit", Decimal("100"), date(2026, 1, 1))
        with pytest.raises(HTTPException):
            await svc.add_movement(db, inv, 1, "withdrawal", Decimal("150"), date(2026, 1, 2))
    await svc.close(db, inv, 1, Decimal("100"), date(2026, 2, 1))
    with pytest.raises(HTTPException):
        await svc.add_movement(db, inv, 1, "deposit", Decimal("1"), date(2026, 2, 2))
