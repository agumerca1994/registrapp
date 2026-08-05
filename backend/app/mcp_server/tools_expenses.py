"""Spending queries."""
from decimal import Decimal
from typing import Any

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.params import MAX_LIMIT, clamp, parse_range
from app.mcp_server.serialize import f0, guard, pct
from app.services import analytics

_CARD_NOTE = (
    "Los gastos pagados con tarjeta ya están incluidos acá "
    "(payment_method='tarjeta_credito'): no los sumes aparte."
)
_USD_NOTE = (
    "Todos los gastos en USD caen en la única categoría 'Consumo en dólares', "
    "por eso se agrupan por descripción."
)


def _shape(result: dict, *, currency: str, group_by: str) -> dict:
    total = result["total"]
    return {
        "currency": currency,
        "total": f0(total),
        "count": result["count"],
        "group_by": group_by,
        "groups": [
            {
                "key": g["key"],
                "total": f0(g["total"]),
                "count": g["count"],
                "pct": pct(g["total"], total),
            }
            for g in result["groups"]
        ],
        "entries": (
            None if result["entries"] is None else
            [{**e, "amount": f0(e["amount"])} for e in result["entries"]]
        ),
        "truncated": result["truncated"],
    }


@mcp.tool()
async def list_expenses(
    date_from: str,
    date_to: str,
    currency: str = "ARS",
    category: str | None = None,
    payment_method: str | None = None,
    entity: str | None = None,
    search: str | None = None,
    min_amount: float | None = None,
    group_by: str = "category",
    limit: int = 50,
) -> dict[str, Any]:
    """Gastos del hogar en un rango de fechas, agregados o detallados.

    Por defecto devuelve el total agrupado por categoría, que es mucho más
    compacto que la lista de movimientos. Pedí group_by="none" sólo si
    necesitás ver los movimientos uno por uno.

    Args:
        date_from: Fecha inicial inclusive, YYYY-MM-DD.
        date_to: Fecha final inclusive, YYYY-MM-DD.
        currency: "ARS", "USD" o "all". Con "all" se devuelven dos bloques
            separados: los montos de distintas monedas nunca se suman entre sí.
        category: Nombre (o parte del nombre) de la categoría.
        payment_method: "tarjeta_credito" para ver sólo consumos con tarjeta,
            "otros" para el resto (efectivo, débito, transferencias).
        entity: Alias de tarjeta o entidad, búsqueda parcial.
        search: Texto a buscar en la descripción del gasto.
        min_amount: Monto mínimo, útil para encontrar gastos grandes.
        group_by: "category", "month", "description", "entity" o "none".
        limit: Máximo de filas cuando group_by es "none", "description" o "entity".
    """
    start, end = parse_range(date_from, date_to)
    limit = clamp(limit, 1, MAX_LIMIT)
    currency = currency.upper() if currency else "ARS"
    if currency not in ("ARS", "USD", "ALL"):
        currency = "ARS"

    async with tool_session() as db:
        caller = await current_caller(db)
        common = dict(
            category=category,
            payment_method=payment_method,
            entity=entity,
            search=search,
            min_amount=Decimal(str(min_amount)) if min_amount is not None else None,
            limit=limit,
        )

        if currency == "ALL":
            ars = await analytics.expense_aggregate(
                db, caller.tenant_id, start, end,
                currency="ARS", group_by=group_by, **common,
            )
            # A category breakdown of USD spending is meaningless — every USD
            # entry shares one category — so it groups by description instead.
            usd_group = "description" if group_by == "category" else group_by
            usd = await analytics.expense_aggregate(
                db, caller.tenant_id, start, end,
                currency="USD", group_by=usd_group, **common,
            )
            payload = {
                "range": {"from": date_from, "to": date_to},
                "ars": _shape(ars, currency="ARS", group_by=group_by),
                "usd": _shape(usd, currency="USD", group_by=usd_group),
                "notes": [
                    "ARS y USD se informan por separado a propósito: no existe un "
                    "total combinado.",
                    _CARD_NOTE, _USD_NOTE,
                ],
            }
            return guard(payload)

        if currency == "USD" and group_by == "category":
            group_by = "description"

        result = await analytics.expense_aggregate(
            db, caller.tenant_id, start, end,
            currency=currency, group_by=group_by, **common,
        )

    notes = [_CARD_NOTE]
    if currency == "USD":
        notes.append(_USD_NOTE)
    return guard({
        "range": {"from": date_from, "to": date_to},
        **_shape(result, currency=currency, group_by=group_by),
        "notes": notes,
    })
