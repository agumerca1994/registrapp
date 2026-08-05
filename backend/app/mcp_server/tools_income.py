"""Income queries, period comparisons and deflated series.

The comparison tools are where the Argentine context matters most: a nominal
"income went up 75%" means nothing on its own. Everything that compares two
moments in time also reports the real (inflation-adjusted) change.
"""
from datetime import date
from decimal import Decimal
from typing import Any

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.params import (
    MAX_LIMIT, MAX_SERIES_MONTHS, check_month, clamp, parse_range,
)
from app.mcp_server.serialize import f, f0, guard
from app.services import analytics
from app.services.currency import get_tenant_rate_type

# The household picks a quote by name; these are the matching macro columns.
# "personalizado" is deliberately absent — no column backs it.
_USD_COLUMN_BY_RATE = {
    "oficial": "usd_official",
    "blue": "usd_blue",
    "mayorista": "usd_mayorista",
    "mep": "usd_mep",
    "ccl": "usd_ccl",
}


@mcp.tool()
async def list_income(
    date_from: str,
    date_to: str,
    source: str | None = None,
    income_type: str | None = None,
    group_by: str = "month",
    limit: int = 50,
) -> dict[str, Any]:
    """Ingresos del hogar en un rango de fechas.

    Devuelve neto, bruto y deducciones. Los ingresos siempre están en pesos
    (no tienen moneda: la app no registra ingresos en dólares).

    Args:
        date_from: Fecha inicial inclusive, YYYY-MM-DD.
        date_to: Fecha final inclusive, YYYY-MM-DD.
        source: Nombre (o parte) de la fuente de ingreso.
        income_type: "salary", "bonus", "aguinaldo", "investment" u "other".
        group_by: "month", "source" o "none".
        limit: Máximo de filas cuando group_by es "none".
    """
    start, end = parse_range(date_from, date_to)

    async with tool_session() as db:
        caller = await current_caller(db)
        r = await analytics.income_aggregate(
            db, caller.tenant_id, start, end,
            source=source, income_type=income_type,
            group_by=group_by, limit=clamp(limit, 1, MAX_LIMIT),
        )

    return guard({
        "range": {"from": date_from, "to": date_to},
        "currency": "ARS",
        "total_neto": f0(r["total_neto"]),
        "total_bruto": f0(r["total_bruto"]),
        "total_deducciones": f0(r["total_deducciones"]),
        "count": r["count"],
        "group_by": group_by,
        "groups": [
            {"key": g["key"], "neto": f0(g["neto"]), "bruto": f(g["bruto"])}
            for g in r["groups"]
        ],
        "entries": (
            None if r["entries"] is None else
            [
                {
                    **e,
                    "neto": f0(e["neto"]),
                    "bruto": f(e["bruto"]),
                    "deducciones": f(e["deducciones"]),
                }
                for e in r["entries"]
            ]
        ),
        "truncated": r["truncated"],
    })


async def _metric_for_month(db, tenant_id: int, year: int, month: int, metric: str) -> Decimal:
    start, end = analytics.month_bounds(year, month)
    if metric == "income":
        r = await analytics.income_aggregate(db, tenant_id, start, end, group_by="month")
        return Decimal(r["total_neto"])
    if metric == "expenses":
        r = await analytics.expense_aggregate(
            db, tenant_id, start, end, currency="ARS", group_by="month"
        )
        return Decimal(r["total"])
    summary = await analytics.month_summary(db, tenant_id, year, month)
    return summary.balance


@mcp.tool()
async def compare_periods(
    metric: str,
    year: int,
    month: int,
    against: str = "both",
    currency: str = "ARS",
) -> dict[str, Any]:
    """Compara un mes contra el anterior y contra el mismo mes del año pasado.

    Además de la variación nominal devuelve `delta_real_pct`, que descuenta la
    inflación acumulada del período. En Argentina esa es la cifra que importa:
    un ingreso que sube 75% con 62% de inflación mejoró 7,8% real, no 75%.

    Args:
        metric: "income", "expenses" o "balance".
        year: Año del mes a analizar.
        month: Mes 1-12.
        against: "prev_month", "yoy" o "both".
        currency: Sólo "ARS" tiene sentido: el balance y las comparaciones
            contra inflación son en pesos.
    """
    check_month(month)
    if metric not in ("income", "expenses", "balance"):
        return {"error": "metric debe ser 'income', 'expenses' o 'balance'"}

    period = f"{year}-{month:02d}"

    async with tool_session() as db:
        caller = await current_caller(db)
        tid = caller.tenant_id
        value = await _metric_for_month(db, tid, year, month, metric)

        out: dict[str, Any] = {
            "metric": metric,
            "currency": "ARS",
            "period": period,
            "value": f0(value),
        }

        targets = []
        if against in ("prev_month", "both"):
            targets.append(("prev_month", analytics.add_months(year, month, -1)))
        if against in ("yoy", "both"):
            targets.append(("yoy", (year - 1, month)))

        for label, (py, pm) in targets:
            past = await _metric_for_month(db, tid, py, pm, metric)
            past_period = f"{py}-{pm:02d}"

            # Inflation over (past, now]: the index is chained across the months
            # in between, so it works for a one-month gap and a twelve-month one.
            periods = analytics.periods_between(date(py, pm, 1), date(year, month, 1))
            index = await analytics.inflation_index(db, periods)
            first = index.get(past_period, {}).get("index")
            last = index.get(period, {}).get("index")
            inflation_pct = (
                float(last / first - 1) * 100 if first and last and first != 0 else None
            )
            estimated = any(index.get(p, {}).get("estimated") for p in periods)

            delta_abs = value - past
            delta_pct = float(delta_abs / past * 100) if past else None
            delta_real = None
            if delta_pct is not None and inflation_pct is not None:
                delta_real = ((1 + delta_pct / 100) / (1 + inflation_pct / 100) - 1) * 100

            out[label] = {
                "period": past_period,
                "value": f0(past),
                "delta_abs": f0(delta_abs),
                "delta_pct": round(delta_pct, 2) if delta_pct is not None else None,
                "inflation_accum_pct": round(inflation_pct, 2) if inflation_pct is not None else None,
                "delta_real_pct": round(delta_real, 2) if delta_real is not None else None,
                "inflation_estimated": estimated,
            }

    out["notes"] = [
        "delta_real_pct = (1 + delta_pct) / (1 + inflación acumulada) − 1.",
        "inflation_estimated=true significa que algún mes usa la última "
        "inflación conocida porque el INDEC todavía no publicó la del período.",
    ]
    return guard(out)


@mcp.tool()
async def get_series(
    metric: str,
    months: int = 24,
    deflate: str | None = None,
) -> dict[str, Any]:
    """Serie mensual de ingresos, gastos, balance o hipoteca, opcionalmente deflactada.

    Con `deflate` la serie se expresa en términos reales, que es la única forma
    honesta de comparar meses distintos en Argentina.

    Args:
        metric: "income", "expenses", "balance" o "mortgage".
        months: Cuántos meses hacia atrás (máximo 60).
        deflate: None para montos nominales; "inflation" para pesos constantes
            del último mes; "uva" para medir en UVAs (la unidad de la hipoteca);
            "usd" para expresar la serie en dólares al tipo de cambio del hogar.
    """
    if metric not in ("income", "expenses", "balance", "mortgage"):
        return {"error": "metric debe ser 'income', 'expenses', 'balance' o 'mortgage'"}
    months = clamp(months, 1, MAX_SERIES_MONTHS)

    async with tool_session() as db:
        caller = await current_caller(db)
        history = await analytics.history_series(db, caller.tenant_id)
        if not history:
            return {"metric": metric, "points": [], "notes": ["El hogar todavía no tiene datos cargados."]}

        history = history[-months:]
        periods = [p.period for p in history]

        field = {
            "income": "total_income",
            "expenses": "total_expenses",
            "mortgage": "mortgage_payment",
        }.get(metric)
        nominal = {
            p.period: (
                (p.total_income - p.total_expenses) if metric == "balance"
                else (getattr(p, field) or Decimal(0))
            )
            for p in history
        }

        notes: list[str] = []
        points: list[dict] = []
        base_period = periods[-1]

        if deflate == "inflation":
            index = await analytics.inflation_index(db, periods)
            for p in periods:
                level = index[p]["index"]
                real = nominal[p] * Decimal(100) / level if level else None
                points.append({
                    "period": p,
                    "nominal": f0(nominal[p]),
                    "real": f(real),
                    "index": f(level),
                    "estimated": index[p]["estimated"],
                })
            notes.append(f"'real' está expresado en pesos constantes de {base_period}.")
            if any(pt["estimated"] for pt in points):
                notes.append(
                    "Los meses con estimated=true usan la última inflación publicada."
                )

        elif deflate in ("uva", "usd"):
            if deflate == "uva":
                column, label = "uva_value", "UVA"
                rate_type = None
            else:
                rate_type = await get_tenant_rate_type(db, caller.tenant_id)
                column = _USD_COLUMN_BY_RATE.get(rate_type, "usd_blue")
                label = f"USD ({rate_type})"
            start = date(int(periods[0][:4]), int(periods[0][5:7]), 1)
            ny, nm = analytics.add_months(int(base_period[:4]), int(base_period[5:7]), 1)
            macro = await analytics.macro_monthly(db, start, date(ny, nm, 1), [column])
            for p in periods:
                divisor = (macro.get(p) or {}).get(column)
                points.append({
                    "period": p,
                    "nominal": f0(nominal[p]),
                    "real": f(nominal[p] / divisor) if divisor else None,
                    "unit": label,
                })
            notes.append(f"'real' está expresado en {label}.")
            if rate_type is not None and rate_type not in _USD_COLUMN_BY_RATE:
                notes.append(
                    f"El hogar usa tipo de cambio '{rate_type}', que no tiene serie "
                    "histórica; se usó el dólar blue."
                )

        else:
            points = [{"period": p, "nominal": f0(nominal[p])} for p in periods]
            notes.append(
                "Montos nominales: no son comparables entre meses sin ajustar por "
                "inflación. Usá deflate='inflation' para eso."
            )

        summary = {}
        if len(points) >= 2 and points[0]["nominal"]:
            summary["nominal_change_pct"] = round(
                (points[-1]["nominal"] / points[0]["nominal"] - 1) * 100, 2
            )
        if len(points) >= 2 and points[0].get("real") and points[-1].get("real"):
            summary["real_change_pct"] = round(
                (points[-1]["real"] / points[0]["real"] - 1) * 100, 2
            )

    return guard({
        "metric": metric,
        "deflate": deflate,
        "base_period": base_period,
        "points": points,
        "summary": summary,
        "notes": notes,
    })


_USD_COLUMN_BY_RATE = {
    "usd_official": "oficial",
    "usd_blue": "blue",
    "usd_mayorista": "mayorista",
    "usd_mep": "mep",
    "usd_ccl": "ccl",
}
