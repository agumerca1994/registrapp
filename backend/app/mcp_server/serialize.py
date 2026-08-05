"""Shaping tool payloads: numbers the model can read, responses it can afford.

Two jobs:

1. `f()` turns SQLAlchemy `Decimal`s into plain floats. Returning `Decimal`
   makes FastMCP emit an `anyOf: [number, string]` output schema and serialize
   the value as a string — noisy for something that is a display number.
2. `guard()` is the last line of defence against a tool answer that would eat
   the client's context. Aggregates are cheap and always survive; detail arrays
   are what get dropped, with a note telling the model how to ask again.
"""
import json
from decimal import Decimal
from typing import Any

MAX_RESPONSE_BYTES = 48_000


def f(value: Decimal | float | int | None, places: int = 2) -> float | None:
    """Decimal/number → rounded float, passing None through."""
    if value is None:
        return None
    return round(float(value), places)


def f0(value: Decimal | float | int | None, places: int = 2) -> float:
    """Same as `f`, but None becomes 0.0 (for totals that are always numbers)."""
    return round(float(value), places) if value is not None else 0.0


def pct(part: Decimal | float | None, whole: Decimal | float | None) -> float | None:
    """`part` as a percentage of `whole`, or None when the base is zero."""
    if part is None or not whole:
        return None
    return round(float(part) / float(whole) * 100, 2)


def _size(payload: Any) -> int:
    return len(json.dumps(payload, ensure_ascii=False, default=str))


def _list_keys(payload: dict[str, Any]) -> list[tuple[str, int]]:
    """Top-level keys holding a non-empty list, biggest first."""
    sizes = [(k, _size(v)) for k, v in payload.items() if isinstance(v, list) and v]
    return sorted(sizes, key=lambda kv: kv[1], reverse=True)


def guard(payload: dict[str, Any], max_bytes: int = MAX_RESPONSE_BYTES) -> dict[str, Any]:
    """Drop detail arrays until the payload fits, explaining what was dropped.

    Never touches scalars, so the headline numbers of a tool answer always
    survive — only the row-level detail behind them is sacrificed.
    """
    if _size(payload) <= max_bytes:
        return payload

    notes: list[str] = list(payload.get("notes") or [])
    changed = False

    # First pass: thin out nested lists inside a top-level list of objects
    # (e.g. `months[].installments`), keeping the outer structure intact.
    for key, _ in _list_keys(payload):
        if _size(payload) <= max_bytes:
            break
        items = payload[key]
        if not all(isinstance(i, dict) for i in items):
            continue
        trimmed = False
        for item in items:
            for sub_key, sub_val in list(item.items()):
                if isinstance(sub_val, list) and len(sub_val) > 3:
                    item[sub_key] = sub_val[:3]
                    item[f"{sub_key}_truncated"] = True
                    trimmed = True
        if trimmed:
            changed = True
            notes.append(f"Se recortó el detalle dentro de '{key}' por tamaño.")

    # Second pass: drop whole detail arrays, biggest first.
    for key, _ in _list_keys(payload):
        if _size(payload) <= max_bytes:
            break
        dropped = len(payload[key])
        payload[key] = None
        changed = True
        notes.append(
            f"Se omitió '{key}' ({dropped} filas) porque la respuesta era demasiado "
            f"grande. Volvé a consultar con un rango de fechas más corto, un filtro "
            f"más específico o un group_by agregado."
        )

    # Only claim truncation when something was actually removed — a payload
    # that is large but has no detail arrays to drop comes back intact.
    if changed:
        payload["truncated"] = True
    payload["notes"] = notes
    return payload
