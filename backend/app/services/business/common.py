"""Lo que comparten los catálogos de un negocio (proveedores, productos): el
nombre normalizado y cómo se encuentra uno a partir de lo que escribe una
persona en el bot o en el conector ("la verdu", "coca")."""
from __future__ import annotations

from typing import Protocol, Sequence, TypeVar

from fastapi import HTTPException

from app.services.search import fold_text

MAX_NAME = 120


def name_and_key(raw: str | None) -> tuple[str, str]:
    """Nombre prolijo (espacios colapsados) y su clave plegada, la que es
    única por negocio: "Verdulería" y "verduleria" son lo mismo."""
    name = " ".join((raw or "").split())
    if not name:
        raise HTTPException(status_code=422, detail="El nombre es obligatorio")
    if len(name) > MAX_NAME:
        raise HTTPException(status_code=422, detail=f"El nombre no puede pasar de {MAX_NAME} caracteres")
    return name, fold_text(name)


class _Named(Protocol):
    name_key: str


T = TypeVar("T", bound=_Named)


def match_by_name(items: Sequence[T], term: str) -> list[T]:
    """El nombre exacto plegado gana solo; si no, los que tienen una palabra
    que empieza con cada palabra del término. Vacío o varios = preguntar."""
    key = fold_text(term or "").strip()
    if not key:
        return []
    exact = [it for it in items if it.name_key == key]
    if exact:
        return exact
    tokens = key.split()
    return [
        it for it in items
        if all(any(word.startswith(tok) for word in it.name_key.split()) for tok in tokens)
    ]
