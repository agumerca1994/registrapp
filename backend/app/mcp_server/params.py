"""Argument parsing shared by the tools.

Models send dates as strings and sometimes get creative about it, so parsing
happens once, here, and fails with a message the model can act on rather than a
stack trace.
"""
from datetime import date

from mcp.server.fastmcp.exceptions import ToolError
from sqlalchemy.ext.asyncio import AsyncSession

from app.services.people import people_of
from app.services.search import fold_text

MAX_SERIES_MONTHS = 60
MAX_LIMIT = 200


def parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value.strip())
    except (ValueError, AttributeError):
        raise ToolError(f"{field} debe tener formato YYYY-MM-DD (recibí: {value!r})")


def parse_range(date_from: str, date_to: str) -> tuple[date, date]:
    """Half-open `[start, end)` from an inclusive user-facing range."""
    start = parse_date(date_from, "date_from")
    end_inclusive = parse_date(date_to, "date_to")
    if end_inclusive < start:
        raise ToolError("date_to no puede ser anterior a date_from")
    # The database columns are dates, so "up to and including" means "< the next day".
    return start, date.fromordinal(end_inclusive.toordinal() + 1)


def clamp(value: int, low: int, high: int) -> int:
    return max(low, min(high, value))


def check_month(month: int) -> None:
    if not 1 <= month <= 12:
        raise ToolError("month debe estar entre 1 y 12")


async def person_id(db: AsyncSession, tenant_id: int, name: str | None) -> int | None:
    """El id de quien se nombra en `loaded_by`. Un nombre que no resuelve a una
    sola persona es un error: filtrar por otra daría un total creíble y falso."""
    if not name or not name.strip():
        return None
    people = await people_of(db, tenant_id)
    term = fold_text(name)
    matches = [p for p in people if fold_text(p.name) == term] or [
        p for p in people if term in fold_text(p.name)
    ]
    if len(matches) == 1:
        return matches[0].id
    names = ", ".join(p.name for p in people) or "(nadie)"
    problem = "es más de una persona" if matches else "no es nadie de esta cuenta"
    raise ToolError(f"«{name}» {problem}. Personas: {names}")
