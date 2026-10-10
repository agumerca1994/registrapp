"""Empleados de un negocio: cómo se entra, quién cambia el rol, quién hereda
el negocio y qué deja de ver un empleado."""
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.routers.auth import (
    MemberRoleBody, join_tenant, leave_household, set_member_role,
)
from app.schemas.user import UserJoinTenant


async def _tenant(db, kind="business", code="NEGOCIO1"):
    tenant = Tenant(name="Rotisería", code=code, kind=kind)
    db.add(tenant)
    await db.flush()
    return tenant


async def _user(db, tenant, uid, role=UserRole.member):
    user = User(firebase_uid=uid, tenant_id=tenant.id, email=f"{uid}@example.com", role=role)
    db.add(user)
    await db.flush()
    return user


def fb(uid):
    return {"uid": uid, "email": f"{uid}@example.com"}


async def test_joining_a_business_makes_you_an_employee(db):
    await _tenant(db, code="NEGOCIO1")
    await _tenant(db, kind="household", code="HOGAR001")
    emp = await join_tenant(UserJoinTenant(tenant_code="negocio1"), firebase_user=fb("emp"), db=db)
    assert emp.role == UserRole.employee
    # El código es la credencial para sumarse: un empleado no lo ve.
    assert emp.tenant_code is None
    member = await join_tenant(UserJoinTenant(tenant_code="HOGAR001"), firebase_user=fb("fam"), db=db)
    assert member.role == UserRole.member
    assert member.tenant_code == "HOGAR001"


async def test_only_the_owner_changes_roles_and_never_their_own(db):
    tenant = await _tenant(db)
    owner = await _user(db, tenant, "owner", UserRole.admin)
    emp = await _user(db, tenant, "emp", UserRole.employee)
    partner = await _user(db, tenant, "partner", UserRole.member)

    promoted = await set_member_role(emp.id, MemberRoleBody(role="member"), firebase_user=fb("owner"), db=db)
    assert promoted.role == UserRole.member
    with pytest.raises(HTTPException) as exc:
        await set_member_role(emp.id, MemberRoleBody(role="employee"), firebase_user=fb("partner"), db=db)
    assert exc.value.status_code == 403
    with pytest.raises(HTTPException) as exc:
        await set_member_role(owner.id, MemberRoleBody(role="employee"), firebase_user=fb("owner"), db=db)
    assert exc.value.status_code == 400
    assert partner.role == UserRole.member


async def test_households_have_no_employees(db):
    tenant = await _tenant(db, kind="household")
    await _user(db, tenant, "owner", UserRole.admin)
    other = await _user(db, tenant, "fam")
    with pytest.raises(HTTPException) as exc:
        await set_member_role(other.id, MemberRoleBody(role="employee"), firebase_user=fb("owner"), db=db)
    assert exc.value.status_code == 400


async def test_the_owner_cannot_leave_the_business_to_an_employee(db):
    tenant = await _tenant(db)
    await _user(db, tenant, "owner", UserRole.admin)
    emp = await _user(db, tenant, "emp", UserRole.employee)
    with pytest.raises(HTTPException) as exc:
        await leave_household(firebase_user=fb("owner"), db=db)
    assert exc.value.status_code == 400
    assert emp.role == UserRole.employee

    partner = await _user(db, tenant, "partner", UserRole.member)
    await leave_household(firebase_user=fb("owner"), db=db)
    assert partner.role == UserRole.admin
    assert emp.role == UserRole.employee
