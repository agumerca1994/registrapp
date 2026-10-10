"""Quién puede qué, en un solo lugar.

Hasta el negocio, cualquier miembro de un hogar veía y editaba todo, y la
resolución del usuario está copiada en 12 routers (`_get_db_user`). Un empleado
con acceso limitado no se puede hacer con un `if` en cada endpoint: alcanza con
que falte en uno para que vea los números del negocio. Por eso la regla va al
revés —denegado por defecto— y vive acá:

- `deny_employee`: a nivel de router (`include_router(..., dependencies=...)`)
  en todo router que pide usuario en todas sus rutas, y por endpoint en los
  mixtos (los que además tienen rutas públicas o con otra autenticación: ahí un
  `Depends(get_current_user)` a nivel router le pediría token a la ruta
  pública). Un empleado recibe 403; nadie más nota nada — sin fila de usuario
  pasa de largo y el handler da su propio 401.
- `employee_allowed`: marca explícita de lo que un empleado sí puede usar (su
  perfil, registrar el push). No hace nada: existe para que la decisión quede
  escrita al lado de la ruta y para que el test la vea.
- `get_staff_user` / `get_owner_user`: lo que usan los routers del negocio, y
  de paso les dan el usuario sin una copia más de `_get_db_user`.

`tests/test_route_policies.py` recorre `app.routes` y falla si una ruta que pide
usuario no tiene ninguna de estas, o si aparece una ruta pública que no está en
su lista. Agregar un router sin guardia rompe un test, no la privacidad.
"""
from __future__ import annotations

from dataclasses import dataclass

from fastapi import Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import joinedload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.tenant import TENANT_KIND_BUSINESS
from app.models.user import User

EMPLOYEE_ROLE = "employee"


@dataclass(frozen=True)
class Actor:
    user: User
    tenant_kind: str

    @property
    def is_employee(self) -> bool:
        return getattr(self.user.role, "value", self.user.role) == EMPLOYEE_ROLE

    @property
    def is_business(self) -> bool:
        return self.tenant_kind == TENANT_KIND_BUSINESS


async def get_actor(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
) -> Actor | None:
    """El usuario con su tenant, o None si todavía no se registró.

    `joinedload` y no una consulta suelta del kind: el usuario queda en el
    identity map con `tenant` cargado, así un handler que después lo serializa
    como `UserOut` no dispara un lazy load (`MissingGreenlet`).
    """
    user = await db.scalar(
        select(User).options(joinedload(User.tenant)).where(User.firebase_uid == firebase_user["uid"])
    )
    if user is None:
        return None
    return Actor(user=user, tenant_kind=user.tenant.kind)


async def deny_employee(actor: Actor | None = Depends(get_actor)) -> None:
    if actor is not None and actor.is_employee:
        raise HTTPException(status_code=403, detail="No disponible para empleados")


async def employee_allowed() -> None:
    """Marca: esta ruta la puede usar un empleado. No valida nada."""


async def get_staff_user(actor: Actor | None = Depends(get_actor)) -> Actor:
    """Cualquier miembro de un negocio, empleados incluidos."""
    if actor is None:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    if not actor.is_business:
        raise HTTPException(status_code=403, detail="Disponible sólo para negocios")
    return actor


async def get_owner_user(actor: Actor = Depends(get_staff_user)) -> Actor:
    """Dueño o socio de un negocio: todo menos los empleados."""
    if actor.is_employee:
        raise HTTPException(status_code=403, detail="No disponible para empleados")
    return actor
