"""Quién cargó cada cosa, para mostrarlo en un hogar con más de una persona.

Las filas exponen `user_id` y la pantalla lo cruza con `people_of`, igual que
`payee_id` con /payees: una relación a `User` en la serialización es el
MissingGreenlet de siempre. No alcanza con /auth/members porque quien se fue del
hogar ya no está ahí y lo que cargó sí.
"""
from sqlalchemy import func, select, union
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.currency_operation import CurrencyOperation
from app.models.expense import ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource
from app.models.user import User, UserRole
from app.schemas.user import PersonOut
from app.services.search import fold

DELETED_LABEL = "Cuenta eliminada"
NO_NAME_LABEL = "Sin nombre"


def _first_name(user: User) -> str:
    if user.first_name:
        return user.first_name
    if user.display_name and user.display_name.strip():
        return user.display_name.split()[0]
    return user.alias or NO_NAME_LABEL


async def people_of(db: AsyncSession, tenant_id: int) -> list[PersonOut]:
    """Quienes están en el tenant y quienes dejaron algo cargado en él.

    Un empleado de negocio no cuenta si sólo está: no carga gastos, y sumarlo
    haría que el dueño viera "Vos" en cada fila. Tampoco cuenta el ingreso por
    día de las ventas, que lo arma el sistema (`system_key`).

    Se muestra el nombre de pila, y el completo si dos lo comparten. Nunca el
    mail: quien se fue del hogar no autorizó que siga a la vista.
    """
    ids = union(
        select(User.id).where(User.tenant_id == tenant_id, User.role != UserRole.employee),
        select(ExpenseEntry.user_id).where(ExpenseEntry.tenant_id == tenant_id),
        select(IncomeEntry.user_id)
        .join(IncomeSource, IncomeSource.id == IncomeEntry.source_id)
        .where(IncomeEntry.tenant_id == tenant_id, IncomeSource.system_key.is_(None)),
        select(CurrencyOperation.user_id).where(CurrencyOperation.tenant_id == tenant_id),
    )
    users = (
        await db.scalars(select(User).where(User.id.in_(select(ids.subquery()))).order_by(User.created_at, User.id))
    ).all()

    live = [u for u in users if u.deleted_at is None]
    firsts = [_first_name(u).casefold() for u in live]

    def label(user: User) -> str:
        if user.deleted_at is not None:
            return DELETED_LABEL
        name = _first_name(user)
        if firsts.count(name.casefold()) > 1 and user.display_name:
            return user.display_name
        return name

    return [PersonOut(id=u.id, name=label(u)) for u in users]


def loaded_by_match(column, term: str, viewer_id: int):
    """Para la búsqueda: las filas de otra persona cuyo nombre coincide.

    La fila propia dice "Vos", no el nombre, y en un hogar de una sola persona
    no dice nada: si matcheara, buscar tu nombre traería todos tus gastos sin
    que se vea por qué.
    """
    return column.in_(
        select(User.id).where(
            User.id != viewer_id,
            User.deleted_at.is_(None),
            fold(func.coalesce(User.display_name, "")).like(term),
        )
    )
