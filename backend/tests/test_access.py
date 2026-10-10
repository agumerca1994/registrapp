"""La guardia de empleados y los accesos del negocio (core/access.py)."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.core.access import Actor, deny_employee, get_actor, get_owner_user, get_staff_user
from app.models.tenant import Tenant
from app.models.user import User, UserRole


def _actor(role, kind="business"):
    return Actor(user=SimpleNamespace(role=role), tenant_kind=kind)


async def test_deny_employee_blocks_only_employees():
    with pytest.raises(HTTPException) as exc:
        await deny_employee(_actor("employee"))
    assert exc.value.status_code == 403

    await deny_employee(_actor(UserRole.admin))
    await deny_employee(_actor(UserRole.member, kind="household"))
    # Sin fila de usuario no decide la guardia: el handler da su propio 401.
    await deny_employee(None)


async def test_staff_is_any_business_member_and_owner_excludes_employees():
    with pytest.raises(HTTPException) as exc:
        await get_staff_user(None)
    assert exc.value.status_code == 401
    with pytest.raises(HTTPException) as exc:
        await get_staff_user(_actor(UserRole.admin, kind="household"))
    assert exc.value.status_code == 403

    employee = await get_staff_user(_actor("employee"))
    with pytest.raises(HTTPException) as exc:
        await get_owner_user(employee)
    assert exc.value.status_code == 403

    owner = await get_owner_user(await get_staff_user(_actor(UserRole.admin)))
    assert owner.is_business and not owner.is_employee


async def test_get_actor_loads_the_tenant_kind(db):
    tenant = Tenant(name="Rotisería", kind="business")
    db.add(tenant)
    await db.flush()
    db.add(User(firebase_uid="uid-roti", tenant_id=tenant.id, email="r@example.com"))
    await db.flush()

    actor = await get_actor({"uid": "uid-roti"}, db)
    assert actor.is_business
    # El tenant queda cargado: un UserOut posterior no dispara lazy load.
    assert actor.user.tenant.name == "Rotisería"
    assert await get_actor({"uid": "nadie"}, db) is None


def test_employees_work_on_today_and_yesterday_only(monkeypatch):
    from datetime import date

    from app.core import access

    monkeypatch.setattr(access, "business_today", lambda: date(2026, 10, 10))
    employee = _actor("employee")
    access.assert_staff_day(employee, date(2026, 10, 10))
    access.assert_staff_day(employee, date(2026, 10, 9))
    with pytest.raises(HTTPException) as exc:
        access.assert_staff_day(employee, date(2026, 10, 8))
    assert exc.value.status_code == 403
    # El dueño no tiene ventana.
    access.assert_staff_day(_actor(UserRole.admin), date(2025, 1, 1))
