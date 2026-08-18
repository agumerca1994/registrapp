"""Alias de usuario y búsqueda en el directorio.

El alias es el equivalente al alias de una transferencia bancaria: algo corto
que se puede decir en voz alta o pegar en un chat, para que te compartan un
gasto sin que la otra persona tenga que saber tu mail ni tu teléfono.
"""

from __future__ import annotations

import re

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.user import User
from app.services.search import fold, fold_term

ALIAS_MIN, ALIAS_MAX = 4, 30
_ALIAS_RE = re.compile(r"^[a-z][a-z0-9._]*$")

# Nombres que no puede tomar nadie: o son la app hablando de sí misma, o se
# leen como una cuenta oficial. `rap_` además es el prefijo de los tokens del
# conector MCP, así que un alias con ese arranque se lee como una credencial.
RESERVED_ALIASES = frozenset({
    "admin", "administrador", "registrapp", "soporte", "support", "ayuda",
    "help", "root", "api", "me", "yo", "hogar", "invite", "sistema", "system",
    "null", "undefined", "none", "test",
})


class AliasError(ValueError):
    """Alias inválido. El mensaje es para mostrarle al usuario."""


def validate_alias(raw: str) -> str:
    """Normaliza y valida. Devuelve el alias listo para guardar, en minúscula.

    Levanta `AliasError` con un mensaje en castellano; el router lo convierte
    en 400. La colisión con otro usuario NO se chequea acá — es 409, que es un
    caso distinto y el frontend lo muestra distinto.
    """
    alias = (raw or "").strip().lower()
    if not alias:
        raise AliasError("Escribí un alias.")
    if len(alias) < ALIAS_MIN:
        raise AliasError(f"El alias tiene que tener al menos {ALIAS_MIN} caracteres.")
    if len(alias) > ALIAS_MAX:
        raise AliasError(f"El alias no puede pasar de {ALIAS_MAX} caracteres.")
    if not _ALIAS_RE.match(alias):
        raise AliasError("Sólo letras, números, puntos y guiones bajos, empezando por una letra.")
    if alias.endswith((".", "_")):
        raise AliasError("El alias no puede terminar en punto ni en guión bajo.")
    if ".." in alias or "__" in alias or "._" in alias or "_." in alias:
        raise AliasError("No repitas puntos ni guiones bajos seguidos.")
    if alias in RESERVED_ALIASES or alias.startswith("rap_"):
        raise AliasError("Ese alias está reservado, elegí otro.")
    return alias


async def alias_taken(db: AsyncSession, alias: str, *, exclude_user_id: int | None = None) -> bool:
    q = select(User.id).where(User.alias == alias)
    if exclude_user_id is not None:
        q = q.where(User.id != exclude_user_id)
    return await db.scalar(q.limit(1)) is not None


async def lookup_exact(db: AsyncSession, term: str) -> User | None:
    """Resolución exacta por alias, mail o teléfono.

    Deliberadamente NO mira `discoverable`: esa bandera gobierna sólo la
    búsqueda por nombre. Si apagara también la exacta, alguien que la desactiva
    dejaría de recibir en silencio los gastos que le compartan por mail o
    teléfono — el fallo más caro de este dominio, porque no da error, sólo no
    llega nada.
    """
    from app.services import participants  # ciclo: participants no importa esto

    term = (term or "").strip()
    if not term:
        return None
    if participants.is_email(term):
        return await participants.find_user_by_email(term, db)
    if participants.is_phone(term):
        return await participants.find_user_by_phone(participants.normalize_phone(term), db)
    try:
        alias = validate_alias(term)
    except AliasError:
        return None
    return await db.scalar(select(User).where(User.alias == alias))


async def search_by_name(db: AsyncSession, term: str, *, limit: int = 10) -> list[User]:
    """Búsqueda difusa, sólo por nombre y sólo entre quienes son visibles.

    Sin `offset` ni total a propósito: un offset convierte una búsqueda en un
    volcado de la tabla de usuarios.
    """
    needle = fold_term(term)
    if not needle:
        return []
    rows = await db.scalars(
        select(User)
        .where(
            User.discoverable.is_(True),
            User.display_name.is_not(None),
            fold(User.display_name).like(f"%{needle}%"),
        )
        # Los que empiezan con el término primero: si escribís "mar", Marina
        # antes que Ana Maria.
        .order_by(
            func.coalesce(fold(User.display_name).like(f"{needle}%"), False).desc(),
            User.display_name,
        )
        .limit(limit)
    )
    return list(rows.all())
