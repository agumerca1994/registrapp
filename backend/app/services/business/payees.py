"""Proveedores y empleados de un negocio: a quién se le paga.

Una sola tabla para los dos (ver models/business.py). **Nada de esto hace
commit.** Un payee no se borra: se archiva (`is_active=false`), y los gastos
viejos conservan a quién se le pagó.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import PAYEE_KINDS, Payee
from app.services.search import fold_text

MAX_NAME = 120


def name_and_key(raw: str | None) -> tuple[str, str]:
    name = " ".join((raw or "").split())
    if not name:
        raise HTTPException(status_code=422, detail="El nombre es obligatorio")
    if len(name) > MAX_NAME:
        raise HTTPException(status_code=422, detail=f"El nombre no puede pasar de {MAX_NAME} caracteres")
    return name, fold_text(name)


def _check_kind(kind: str) -> str:
    if kind not in PAYEE_KINDS:
        raise HTTPException(status_code=422, detail=f"kind debe ser uno de {PAYEE_KINDS}")
    return kind


async def _check_category(db: AsyncSession, tenant_id: int, category_id: int | None) -> None:
    if category_id is not None:
        from app.routers.expenses import assert_owns_category  # import tardío: ciclo router↔service

        await assert_owns_category(category_id, tenant_id, db)


async def assert_owns_payee(db: AsyncSession, tenant_id: int, payee_id: int) -> Payee:
    payee = await db.get(Payee, payee_id)
    if payee is None or payee.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Proveedor o empleado no encontrado")
    return payee


async def _assert_name_free(db: AsyncSession, tenant_id: int, key: str, exclude_id: int | None = None) -> None:
    q = select(Payee.id).where(Payee.tenant_id == tenant_id, Payee.name_key == key)
    if exclude_id is not None:
        q = q.where(Payee.id != exclude_id)
    if await db.scalar(q) is not None:
        # 409 y no 400: "ya existe" se arregla eligiendo el que está, no
        # corrigiendo el formulario.
        raise HTTPException(status_code=409, detail="Ya hay un proveedor o empleado con ese nombre")


async def list_payees(db: AsyncSession, tenant_id: int, *, include_inactive: bool = False) -> list[Payee]:
    q = select(Payee).where(Payee.tenant_id == tenant_id)
    if not include_inactive:
        q = q.where(Payee.is_active.is_(True))
    return list((await db.scalars(q.order_by(Payee.name_key))).all())


async def create_payee(
    db: AsyncSession,
    tenant_id: int,
    *,
    name: str,
    kind: str,
    default_category_id: int | None = None,
    notes: str | None = None,
) -> Payee:
    name, key = name_and_key(name)
    await _assert_name_free(db, tenant_id, key)
    await _check_category(db, tenant_id, default_category_id)
    payee = Payee(
        tenant_id=tenant_id, name=name, name_key=key, kind=_check_kind(kind),
        default_category_id=default_category_id, notes=(notes or "").strip() or None,
    )
    db.add(payee)
    await db.flush()
    return payee


async def update_payee(db: AsyncSession, payee: Payee, tenant_id: int, updates: dict) -> Payee:
    """Aplica sólo las claves presentes en `updates` (un `None` explícito en
    `default_category_id` o `notes` las borra)."""
    if "name" in updates:
        name, key = name_and_key(updates["name"])
        await _assert_name_free(db, tenant_id, key, exclude_id=payee.id)
        payee.name, payee.name_key = name, key
    if "kind" in updates:
        payee.kind = _check_kind(updates["kind"])
    if "default_category_id" in updates:
        await _check_category(db, tenant_id, updates["default_category_id"])
        payee.default_category_id = updates["default_category_id"]
    if "notes" in updates:
        payee.notes = (updates["notes"] or "").strip() or None
    if "is_active" in updates:
        payee.is_active = bool(updates["is_active"])
    await db.flush()
    return payee


async def resolve_payee(db: AsyncSession, tenant_id: int, term: str) -> list[Payee]:
    """Del texto de una persona ("juan", "la verdu") a los payees activos que
    pueden ser: el nombre exacto plegado gana solo; si no, los que tienen una
    palabra que empieza con cada palabra del término. Lista vacía o de varios
    = hay que preguntar."""
    key = fold_text(term or "").strip()
    if not key:
        return []
    payees = await list_payees(db, tenant_id)
    exact = [p for p in payees if p.name_key == key]
    if exact:
        return exact
    tokens = key.split()
    return [
        p for p in payees
        if all(any(word.startswith(tok) for word in p.name_key.split()) for tok in tokens)
    ]
