"""Encontrar a otros usuarios de RegistrApp para compartirles un gasto.

Dos endpoints deliberadamente asimétricos:

- **`/lookup`** resuelve un dato exacto (alias, mail o teléfono). No revela
  nada nuevo: `POST /shared-expenses` ya resuelve cualquier mail o teléfono
  contra la tabla global de usuarios desde siempre. Esto lo hace explícito, y
  por lo tanto limitable y auditable.
- **`/search`** busca por nombre, que sí es superficie nueva. Por eso mira
  `discoverable`, exige un mínimo de caracteres y no tiene `offset`.
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.schemas.directory import DirectoryLookupOut, DirectoryUserOut
from app.services import rate_limit, user_directory

router = APIRouter(prefix="/directory", tags=["directory"])

SEARCH_MIN_CHARS = 3


async def _caller(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=404, detail="Usuario no encontrado")
    # Una cuenta recién creada y sin verificar no tiene por qué enumerar
    # usuarios: es el perfil exacto de una cuenta hecha para raspar.
    if user.whatsapp_gate_pending:
        raise HTTPException(status_code=403, detail="Verificá tu cuenta antes de buscar usuarios")
    return user


def _out(u: User, caller: User) -> DirectoryUserOut:
    return DirectoryUserOut(
        id=u.id,
        display_name=u.display_name,
        alias=u.alias,
        # Se calcula acá: el tenant_id no viaja nunca.
        same_household=u.tenant_id == caller.tenant_id,
    )


def _limit(request: Request, user: User, scope: str, per_min: int, per_hour: int | None = None) -> None:
    """Dos baldes: por usuario y por IP.

    El de usuario frena que una cuenta raspe; el de IP frena rotar cuentas
    desde el mismo host. Ninguno de los dos alcanza solo.
    """
    rate_limit.enforce_key(str(user.id), f"{scope}:user", per_min, 60)
    rate_limit.enforce(request, f"{scope}:ip", per_min * 3, 60)
    if per_hour is not None:
        rate_limit.enforce_key(str(user.id), f"{scope}:user:h", per_hour, 3600)


@router.get("/lookup", response_model=DirectoryLookupOut)
async def lookup(
    request: Request,
    q: str = Query(min_length=1, max_length=255),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    caller = await _caller(firebase_user, db)
    _limit(request, caller, "dir_lookup", 60)

    found = await user_directory.lookup_exact(db, q)
    if not found or found.id == caller.id:
        return DirectoryLookupOut(found=False)
    return DirectoryLookupOut(found=True, user=_out(found, caller))


@router.get("/search", response_model=list[DirectoryUserOut])
async def search(
    request: Request,
    q: str = Query(min_length=1, max_length=120),
    limit: int = Query(default=10, ge=1, le=10),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    caller = await _caller(firebase_user, db)
    if len(q.strip()) < SEARCH_MIN_CHARS:
        raise HTTPException(
            status_code=400,
            detail=f"Escribí al menos {SEARCH_MIN_CHARS} caracteres para buscar.",
        )
    _limit(request, caller, "dir_search", 30, per_hour=200)

    rows = await user_directory.search_by_name(db, q, limit=limit)
    return [_out(u, caller) for u in rows if u.id != caller.id]
