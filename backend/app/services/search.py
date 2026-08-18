"""Text matching for the list endpoints' search boxes.

One home for it so `/income/entries` and `/expenses/entries` can't drift into
matching differently — a search that finds "Inversión" typing `inversion` on
one screen and not on the other is worse than neither doing it.
"""
from sqlalchemy import func

# Postgres' ILIKE is accent-sensitive and nobody types the accents into a
# search box. `unaccent()` would do this properly but needs the extension
# installed by a migration, so both sides get folded with translate() instead.
ACCENTED = "áéíóúüñÁÉÍÓÚÜÑ"
PLAIN = "aeiouunAEIOUUN"

_TABLE = str.maketrans(ACCENTED, PLAIN)


def fold(col):
    """Lowercase + strip accents, SQL side. Pair with `fold_term`."""
    return func.translate(func.lower(col), ACCENTED.lower(), PLAIN.lower())


def fold_text(q: str) -> str:
    """Lowercase + strip accents, Python side. Sin comodines.

    Separado de `fold_term` porque no todo lo que se pliega es un patrón de
    búsqueda: `services/contacts.person_key` lo usa para armar una clave de
    identidad, y ahí un `%` alrededor la corrompe.
    """
    return q.strip().translate(_TABLE).lower()


def fold_term(q: str) -> str:
    """The user's term as a `LIKE` pattern, folded the same way."""
    return f"%{fold_text(q)}%"
