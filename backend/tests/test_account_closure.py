"""Pausar y eliminar la cuenta (services/account_closure.py)."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.core.access import get_actor
from app.models.device_token import DeviceToken
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.mcp_auth import McpToken
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.tenant import Tenant
from app.models.user import User, UserRole
from app.routers import auth as auth_router
from app.services import account_closure, push
from app.services.mcp_tokens import holder_paused, token_holder_valid


@pytest.fixture(autouse=True)
def _no_firebase(monkeypatch):
    deleted = []

    async def fake_delete(uid):
        deleted.append(uid)

    monkeypatch.setattr(account_closure, "delete_firebase_user", fake_delete)
    return deleted


def fb(uid):
    return {"uid": uid, "email": f"{uid}@example.com"}


async def _tenant(db, name="Casa Gómez", code="HOGAR001", kind="household"):
    t = Tenant(name=name, code=code, kind=kind)
    db.add(t)
    await db.flush()
    return t


async def _user(db, tenant, uid, role=UserRole.admin, **kw):
    u = User(firebase_uid=uid, tenant_id=tenant.id, email=f"{uid}@example.com", role=role,
             first_name="Ana", last_name="Gómez", display_name="Ana Gómez", alias=f"{uid}.alias",
             whatsapp_phone=kw.pop("whatsapp_phone", None), **kw)
    db.add(u)
    await db.flush()
    return u


async def _expense(db, tenant, user, description="Supermercado Día"):
    cat = ExpenseCategory(tenant_id=tenant.id, name="Súper", color="#22c55e", is_fixed=False)
    db.add(cat)
    await db.flush()
    e = ExpenseEntry(tenant_id=tenant.id, user_id=user.id, category_id=cat.id, amount=Decimal("12000"),
                     expense_date=date(2026, 10, 9), description=description, notes="con Juan")
    db.add(e)
    await db.flush()
    return cat, e


# ── Pausa ────────────────────────────────────────────────────────────────────

async def test_a_paused_account_is_frozen_and_reactivating_restores_it(db):
    t = await _tenant(db)
    u = await _user(db, t, "ana")
    await auth_router.pause_account(firebase_user=fb("ana"), db=db)
    with pytest.raises(HTTPException) as exc:
        await get_actor(firebase_user=fb("ana"), db=db)
    assert exc.value.status_code == 423
    # Ver su perfil sí puede: es lo que muestra la pantalla de "en pausa".
    me = await auth_router.me(firebase_user=fb("ana"), db=db)
    assert me.paused_at is not None

    out = await auth_router.unpause_account(firebase_user=fb("ana"), db=db)
    assert out.paused_at is None
    assert (await get_actor(firebase_user=fb("ana"), db=db)).user.id == u.id


async def test_pausing_freezes_only_that_person(db):
    t = await _tenant(db)
    await _user(db, t, "ana")
    await _user(db, t, "beto", role=UserRole.member)
    await auth_router.pause_account(firebase_user=fb("ana"), db=db)
    actor = await get_actor(firebase_user=fb("beto"), db=db)
    assert actor.user.tenant_id == t.id
    # Y el dueño en pausa sigue siendo el dueño.
    ana = await db.scalar(select(User).where(User.firebase_uid == "ana"))
    assert ana.role == UserRole.admin


async def test_a_paused_account_gets_no_push_and_its_connector_waits_without_revoking(db):
    t = await _tenant(db)
    u = await _user(db, t, "ana")
    db.add(DeviceToken(tenant_id=t.id, user_id=u.id, token="tok-ana"))
    token = McpToken(kind="pat", token_hash="h" * 64, token_prefix="rap_pat_x", grant_id="g1",
                     tenant_id=t.id, user_id=u.id, scopes="registrapp:read")
    db.add(token)
    await db.flush()
    assert [r.token for r in await push.tokens_for_users(db, [u.id])] == ["tok-ana"]
    assert await token_holder_valid(db, token)

    await account_closure.pause(db, u)
    await db.flush()
    assert await push.tokens_for_users(db, [u.id]) == []
    assert not await token_holder_valid(db, token)
    assert await holder_paused(db, token)
    assert token.revoked_at is None

    await account_closure.unpause(db, u)
    await db.flush()
    assert await token_holder_valid(db, token)


# ── Eliminación ──────────────────────────────────────────────────────────────

async def test_delete_needs_the_typed_confirmation(db):
    t = await _tenant(db)
    await _user(db, t, "ana")
    with pytest.raises(HTTPException) as exc:
        await auth_router.delete_account(auth_router.DeleteAccountBody(confirm="si"),
                                         firebase_user=fb("ana"), db=db)
    assert exc.value.status_code == 400


async def test_deleting_the_last_member_keeps_amounts_and_shreds_every_text(db, _no_firebase):
    t = await _tenant(db)
    u = await _user(db, t, "ana", whatsapp_phone="+5493834000000")
    cat, e = await _expense(db, t, u)
    db.add(DeviceToken(tenant_id=t.id, user_id=u.id, token="tok-ana"))
    await db.flush()

    await auth_router.delete_account(auth_router.DeleteAccountBody(confirm=" Eliminar "),
                                     firebase_user=fb("ana"), db=db)
    assert _no_firebase == ["ana"]

    await db.refresh(u)
    await db.refresh(e)
    await db.refresh(cat)
    await db.refresh(t)
    # La fila queda, sin nada que identifique a nadie.
    assert u.deleted_at is not None
    for value in (u.email, u.first_name, u.last_name, u.display_name, u.alias, u.whatsapp_phone):
        assert "ana" not in value.lower() and "gómez" not in value.lower() and "+549" not in value
    assert u.firebase_uid.startswith("deleted:")
    assert not u.discoverable
    # Lo que coherencia necesita, intacto.
    assert e.amount == Decimal("12000") and e.expense_date == date(2026, 10, 9)
    assert e.category_id == cat.id and e.user_id == u.id
    # El texto, ilegible.
    assert e.description != "Supermercado Día" and len(e.description) == 64
    assert e.notes != "con Juan"
    assert cat.name != "Súper"
    assert t.name != "Casa Gómez" and t.code is None
    assert await db.scalar(select(DeviceToken.id)) is None


async def test_equal_texts_stay_equal_so_unique_names_dont_collide(db):
    t = await _tenant(db)
    u = await _user(db, t, "ana")
    _, a = await _expense(db, t, u, "Kiosco")
    b = ExpenseEntry(tenant_id=t.id, user_id=u.id, category_id=a.category_id, amount=Decimal("1"),
                     expense_date=date(2026, 10, 9), description="Kiosco")
    c = ExpenseEntry(tenant_id=t.id, user_id=u.id, category_id=a.category_id, amount=Decimal("1"),
                     expense_date=date(2026, 10, 9), description="Farmacia")
    db.add_all([b, c])
    await db.flush()
    await account_closure.delete_account(db, u)
    for row in (a, b, c):
        await db.refresh(row)
    assert a.description == b.description != c.description


async def test_each_deletion_uses_a_fresh_key(db):
    t1 = await _tenant(db, code="HOGAR001")
    t2 = await _tenant(db, code="HOGAR002")
    u1 = await _user(db, t1, "ana")
    u2 = await _user(db, t2, "beto")
    _, e1 = await _expense(db, t1, u1, "Kiosco")
    _, e2 = await _expense(db, t2, u2, "Kiosco")
    await account_closure.delete_account(db, u1)
    await account_closure.delete_account(db, u2)
    await db.refresh(e1)
    await db.refresh(e2)
    # Sin clave compartida, no se puede ni saber que eran el mismo texto.
    assert e1.description != e2.description


async def test_deleting_one_member_leaves_the_household_untouched(db):
    t = await _tenant(db)
    ana = await _user(db, t, "ana")
    beto = await _user(db, t, "beto", role=UserRole.member)
    cat, e = await _expense(db, t, ana)

    await account_closure.delete_account(db, ana)
    await db.refresh(e)
    await db.refresh(t)
    await db.refresh(beto)
    assert e.description == "Supermercado Día" and e.tenant_id == t.id
    assert t.name == "Casa Gómez" and t.code == "HOGAR001"
    # Sale del hogar y el dueño pasa a ser quien queda.
    assert ana.tenant_id != t.id
    assert beto.role == UserRole.admin


async def test_a_business_owner_with_only_employees_left_cannot_delete(db):
    t = await _tenant(db, kind="business", code="NEGOCIO1")
    owner = await _user(db, t, "duenio")
    await _user(db, t, "emp", role=UserRole.employee)
    with pytest.raises(HTTPException) as exc:
        await account_closure.delete_account(db, owner)
    assert exc.value.status_code == 400


async def test_a_shared_expense_with_another_account_keeps_its_title(db):
    t = await _tenant(db)
    other_t = await _tenant(db, name="Casa Pérez", code="HOGAR002")
    ana = await _user(db, t, "ana")
    juan = await _user(db, other_t, "juan")
    cat, _ = await _expense(db, t, ana)

    def shared(title):
        return SharedExpense(tenant_id=t.id, created_by_user_id=ana.id, title=title,
                             total_amount=Decimal("100"), category_id=cat.id, split_type="equal",
                             expense_date=date(2026, 10, 9), payment_date=date(2026, 10, 9))
    with_juan, alone = shared("Asado"), shared("Regalo")
    db.add_all([with_juan, alone])
    await db.flush()
    db.add_all([
        SharedExpenseSplit(shared_expense_id=with_juan.id, user_id=juan.id, member_name="Juan Pérez",
                           amount=Decimal("50"), status="accepted"),
        SharedExpenseSplit(shared_expense_id=alone.id, user_id=None, member_name="Tía Marta",
                           amount=Decimal("50"), status="pending", invite_token="tok"),
    ])
    await db.flush()

    await account_closure.delete_account(db, ana)
    await db.refresh(with_juan)
    await db.refresh(alone)
    splits = {s.shared_expense_id: s for s in (await db.scalars(select(SharedExpenseSplit))).all()}
    assert with_juan.title == "Asado" and splits[with_juan.id].member_name == "Juan Pérez"
    assert alone.title != "Regalo" and splits[alone.id].member_name != "Tía Marta"
    assert splits[alone.id].invite_token is None
