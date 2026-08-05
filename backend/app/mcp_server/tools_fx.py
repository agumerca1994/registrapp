"""Foreign currency and macro variables."""
from datetime import date, timedelta
from typing import Any

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.params import MAX_SERIES_MONTHS, check_month, clamp
from app.mcp_server.serialize import f, f0, guard
from app.services import analytics
from app.services.currency import (
    get_fx_ars_flow, get_latest_rate, get_tenant_rate_type, get_usd_holding,
)

DEFAULT_MACRO_COLUMNS = ["inflation_monthly_pct", "uva_value", "usd_blue"]
MAX_MACRO_COLUMNS = 6


@mcp.tool()
async def get_usd_position(year: int | None = None, month: int | None = None) -> dict[str, Any]:
    """Tenencia en dólares del hogar y movimientos de divisas del mes.

    Distingue dos cosas que no hay que mezclar: el *stock* (cuántos dólares hay
    ahora, que se arrastra de mes a mes) y el *flujo* del mes elegido (compras,
    ventas y gastos en USD).

    Args:
        year: Año del mes a informar. Por defecto, el mes actual.
        month: Mes 1-12.
    """
    today = date.today()
    year = year or today.year
    month = month or today.month
    check_month(month)
    start, end = analytics.month_bounds(year, month)

    async with tool_session() as db:
        caller = await current_caller(db)
        tid = caller.tenant_id

        holding = await get_usd_holding(db, tid)
        rate_type = await get_tenant_rate_type(db, tid)
        rate = await get_latest_rate(db, rate_type)
        bought_ars, sold_ars = await get_fx_ars_flow(db, tid, start, end)

        # The month's flow is the difference between two cumulative snapshots.
        # `as_of` is inclusive, so the bounds are the last day of this month and
        # the last day of the previous one.
        month_ops = await get_usd_holding(db, tid, as_of=end - timedelta(days=1))
        prev_ops = await get_usd_holding(db, tid, as_of=start - timedelta(days=1))

    return guard({
        "holding_usd": f0(holding.holding),
        "valuation": {
            "rate_type": rate_type,
            "rate": f(rate, 4),
            "holding_ars": f(holding.holding * rate) if rate is not None else None,
        },
        "breakdown": {
            "initial": f0(holding.initial),
            "bought": f0(holding.bought),
            "sold": f0(holding.sold),
            "adjustments": f0(holding.adjustments),
            "spent": f0(holding.spent),
            "pending": f0(holding.pending),
            "next_due_date": holding.next_due_date.isoformat() if holding.next_due_date else None,
            "start_date": holding.start_date.isoformat() if holding.start_date else None,
        },
        "month_flow": {
            "period": f"{year}-{month:02d}",
            "bought_usd": f0(month_ops.bought - prev_ops.bought),
            "sold_usd": f0(month_ops.sold - prev_ops.sold),
            "spent_usd": f0(month_ops.spent - prev_ops.spent),
            "bought_ars": f0(bought_ars),
            "sold_ars": f0(sold_ars),
        },
        "notes": [
            "Comprar dólares no es un gasto: no entra en total_expenses ni en el "
            "balance, aunque sí mueve pesos (ver ars_available).",
            "holding es un stock: se arrastra de un mes al siguiente.",
            "Los consumos en USD con tarjeta se descuentan cuando vence el resumen, "
            "no el día de la compra: las tarjetas se pagan a mes vencido. 'pending' "
            "es lo ya consumido que todavía no salió, y next_due_date es cuándo sale.",
            "La valuación usa la última cotización disponible, no la del día de "
            "cada operación.",
        ],
    })


@mcp.tool()
async def get_macro(months: int = 12, variables: list[str] | None = None) -> dict[str, Any]:
    """Variables macroeconómicas argentinas, mes a mes.

    Datos públicos (no del hogar): inflación mensual e interanual, UVA, dólares
    (oficial, blue, mayorista, MEP, CCL), UVI, ICL, RIPTE, salario mínimo y
    canasta básica total.

    Args:
        months: Cuántos meses hacia atrás (máximo 60).
        variables: Qué columnas traer (máximo 6). Por defecto inflación mensual,
            UVA y dólar blue.
    """
    months = clamp(months, 1, MAX_SERIES_MONTHS)
    columns = (variables or DEFAULT_MACRO_COLUMNS)[:MAX_MACRO_COLUMNS]
    unknown = [c for c in columns if c not in analytics.MACRO_COLUMNS]
    if unknown:
        return {
            "error": f"Variables desconocidas: {', '.join(unknown)}",
            "available": list(analytics.MACRO_COLUMNS),
        }

    today = date.today()
    sy, sm = analytics.add_months(today.year, today.month, -(months - 1))
    ey, em = analytics.add_months(today.year, today.month, 1)

    async with tool_session() as db:
        await current_caller(db)  # macro is public data, but the caller must still be valid
        data = await analytics.macro_monthly(db, date(sy, sm, 1), date(ey, em, 1), columns)

    return guard({
        "variables": columns,
        "points": [
            {"period": p, **{c: f(v.get(c), 4) for c in columns}}
            for p, v in sorted(data.items())
        ],
        "notes": [
            "Son datos públicos (INDEC/BCRA), iguales para todos los hogares.",
            "La inflación del mes en curso suele faltar: el INDEC publica con "
            "unas dos semanas de retraso.",
        ],
    })
