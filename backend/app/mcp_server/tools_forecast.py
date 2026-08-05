"""Forward-looking tools: what's already owed, what a budget looks like, and
what a big purchase would do to the next months.

The one trap these have to avoid is double counting. Every credit-card item —
including every future cuota — is mirrored into `expense_entries` dated at the
*purchase*. So a naive "average the last 6 months of expenses, then add the
future cuotas" counts the same instalments twice. `baseline_run_rate` strips
instalments and mortgage payments out of the average precisely so they can be
added back per month as explicit commitments.
"""
import statistics
from datetime import date
from decimal import Decimal
from typing import Any

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.params import clamp
from app.mcp_server.serialize import f, f0, guard, pct
from app.services import analytics

MAX_INSTALLMENT_ROWS = 10


@mcp.tool()
async def get_upcoming_commitments(months_ahead: int = 6) -> dict[str, Any]:
    """Todo lo que el hogar ya tiene comprometido en los próximos meses.

    Incluye las cuotas de tarjeta ya cargadas en resúmenes futuros, los totales,
    cierres y vencimientos de cada tarjeta, la cuota de hipoteca proyectada y los
    recordatorios de pago. Las cuotas no son una estimación: ya están registradas.

    Args:
        months_ahead: Cuántos meses hacia adelante mirar (1 a 24).
    """
    months_ahead = clamp(months_ahead, 1, 24)
    today = date.today()
    periods = [
        f"{y}-{m:02d}"
        for y, m in (analytics.add_months(today.year, today.month, i) for i in range(months_ahead))
    ]
    end_y, end_m = analytics.add_months(today.year, today.month, months_ahead)

    async with tool_session() as db:
        caller = await current_caller(db)
        tid = caller.tenant_id

        statements = await analytics.statement_totals_by_period(db, tid, periods)
        installments = await analytics.committed_installments_by_period(db, tid, periods)
        reminders = await analytics.reminders_by_period(
            db, tid, date(today.year, today.month, 1), date(end_y, end_m, 1)
        )

        months = []
        for p in periods:
            year, month = int(p[:4]), int(p[5:7])
            start, end = analytics.month_bounds(year, month)
            mortgage, projected = await analytics.mortgage_payment_for_month(db, tid, start, end)

            cards = statements.get(p, [])
            card_ars = sum((c["total_ars"] for c in cards), Decimal(0))
            card_usd = sum((c["total_usd"] for c in cards), Decimal(0))

            rows = installments.get(p, [])
            shown = rows[:MAX_INSTALLMENT_ROWS]
            rest = sum((r["amount"] for r in rows[MAX_INSTALLMENT_ROWS:]), Decimal(0))

            months.append({
                "period": p,
                "cards": [
                    {
                        "card": c["card"],
                        "closing_date": c["closing_date"],
                        "due_date": c["due_date"],
                        "total_ars": f0(c["total_ars"]),
                        "total_usd": f0(c["total_usd"]),
                        "items": c["items"],
                    }
                    for c in cards
                ],
                "card_total_ars": f0(card_ars),
                "card_total_usd": f0(card_usd),
                "installments": [
                    {
                        "description": r["description"],
                        "cuota": r["cuota"],
                        "amount": f0(r["amount"]),
                        "card": r["card"],
                    }
                    for r in shown
                ],
                "other_installments_total": f0(rest) if rest else None,
                "installments_total": f0(sum((r["amount"] for r in rows), Decimal(0))),
                "mortgage": (
                    {"amount": f0(mortgage), "projected": projected} if mortgage else None
                ),
                "reminders": reminders.get(p, []),
                # Card totals already contain the instalments, so the committed
                # figure is cards + mortgage, never cards + instalments + mortgage.
                "total_committed_ars": f0(card_ars + (mortgage or Decimal(0))),
            })

    return guard({
        "generated_at": today.isoformat(),
        "months": months,
        "notes": [
            "Las cuotas ya están materializadas en los resúmenes futuros: son "
            "compromisos ciertos, no proyecciones.",
            "total_committed_ars = total de resúmenes de tarjeta + hipoteca. Las "
            "cuotas ya están dentro del total de tarjeta.",
            "La cuota de hipoteca con projected=true se calcula con el último "
            "valor de UVA disponible.",
        ],
    })


@mcp.tool()
async def get_budget_baseline(months: int = 6, include_current: bool = False) -> dict[str, Any]:
    """Base para armar un presupuesto mensual.

    Devuelve el promedio de gasto por categoría de los últimos meses cerrados,
    separando las categorías que el usuario marcó como fijas de las variables, y
    el desvío de cada una (un desvío alto en una categoría "fija" suele indicar
    que está mal clasificada).

    Args:
        months: Cuántos meses promediar (2 a 24).
        include_current: Incluir el mes en curso. Por defecto no, porque está
            incompleto y baja artificialmente los promedios.
    """
    months = clamp(months, 2, 24)
    today = date.today()
    until_y, until_m = (
        analytics.add_months(today.year, today.month, 1) if include_current
        else (today.year, today.month)
    )
    until = date(until_y, until_m, 1)
    start_y, start_m = analytics.add_months(until_y, until_m, -months)
    start = date(start_y, start_m, 1)

    async with tool_session() as db:
        caller = await current_caller(db)
        tid = caller.tenant_id

        baseline = await analytics.baseline_run_rate(db, tid, months, until=until)

        # Per category, per month, so a real standard deviation is possible.
        per_month = await analytics.expense_aggregate(
            db, tid, start, until, currency="ARS", group_by="month"
        )
        by_month = {g["key"]: g["total"] for g in per_month["groups"]}

        categories = await analytics.expense_aggregate(
            db, tid, start, until, currency="ARS", group_by="category"
        )

        from sqlalchemy import select
        from app.models.expense import ExpenseCategory

        fixed_names = set((await db.execute(
            select(ExpenseCategory.name).where(
                ExpenseCategory.tenant_id == tid, ExpenseCategory.is_fixed.is_(True)
            )
        )).scalars().all())

        # Monthly detail per category, for the spread.
        monthly_by_cat: dict[str, list[float]] = {}
        for g in categories["groups"]:
            detail = await analytics.expense_aggregate(
                db, tid, start, until, currency="ARS",
                category=g["key"], group_by="month",
            )
            monthly_by_cat[g["key"]] = [float(d["total"]) for d in detail["groups"]]

        usd = await analytics.expense_aggregate(
            db, tid, start, until, currency="USD", group_by="description", limit=8
        )

    def _entry(g: dict) -> dict:
        values = monthly_by_cat.get(g["key"], [])
        avg = float(g["total"]) / months
        spread = (
            round(statistics.pstdev(values) / (sum(values) / len(values)) * 100, 1)
            if len(values) > 1 and sum(values) else None
        )
        return {
            "category": g["key"],
            "avg": round(avg, 2),
            "total": f0(g["total"]),
            "months_present": len(values),
            "stddev_pct": spread,
            "min": round(min(values), 2) if values else None,
            "max": round(max(values), 2) if values else None,
        }

    fixed = [_entry(g) for g in categories["groups"] if g["key"] in fixed_names]
    variable = [_entry(g) for g in categories["groups"] if g["key"] not in fixed_names]

    return guard({
        "window": {"from": baseline["from"], "to": baseline["to"], "months": months},
        "avg_income": f0(baseline["avg_income"]),
        "avg_expenses": f0(baseline["avg_expenses_total"]),
        "avg_expenses_ordinary": f0(baseline["avg_expenses_ordinary"]),
        "avg_balance": f0(baseline["avg_income"] - baseline["avg_expenses_total"]),
        "fixed": fixed,
        "variable": variable,
        "totals": {
            "fixed": round(sum(e["avg"] for e in fixed), 2),
            "variable": round(sum(e["avg"] for e in variable), 2),
        },
        "monthly_expenses": [
            {"period": k, "total": f0(v)} for k, v in sorted(by_month.items())
        ],
        "usd": {
            "avg_monthly_usd": round(float(usd["total"]) / months, 2),
            "top_descriptions": [
                {"description": g["key"], "total": f0(g["total"])} for g in usd["groups"]
            ],
        },
        "notes": [
            "fijo/variable sale de la marca is_fixed que puso el usuario en cada "
            "categoría, no de un cálculo.",
            "avg_expenses_ordinary excluye cuotas de tarjeta e hipoteca: es el "
            "gasto corriente, y es la base que usa simulate_purchase.",
            "stddev_pct alto en una categoría marcada como fija sugiere que la "
            "clasificación está mal.",
        ],
    })


@mcp.tool()
async def simulate_purchase(
    amount: float,
    currency: str = "ARS",
    installments: int = 1,
    start_year: int | None = None,
    start_month: int | None = None,
    lookback_months: int = 6,
    inflation_annual_pct: float | None = None,
    grow_income_with_inflation: bool = True,
    description: str | None = None,
) -> dict[str, Any]:
    """Simula el impacto de una compra grande sobre el balance de los próximos meses.

    Proyecta mes a mes el ingreso esperado, el gasto corriente, lo que ya está
    comprometido (cuotas cargadas + hipoteca) y la cuota nueva, y devuelve el
    balance resultante de cada mes más un veredicto.

    Args:
        amount: Monto total de la compra.
        currency: "ARS" o "USD". En USD se convierte al tipo de cambio del hogar.
        installments: Cantidad de cuotas (1 = contado).
        start_year: Año de la primera cuota. Por defecto, el mes que viene.
        start_month: Mes de la primera cuota, 1-12.
        lookback_months: Meses de historia para calcular ingreso y gasto promedio.
        inflation_annual_pct: Inflación anual supuesta, para licuar las cuotas
            fijas y hacer crecer el ingreso. None = sin licuación (escenario
            conservador).
        grow_income_with_inflation: Si el ingreso acompaña a la inflación supuesta.
        description: Qué se está comprando, sólo para que figure en la respuesta.
    """
    if amount <= 0:
        return {"error": "amount debe ser mayor a cero"}
    installments = clamp(installments, 1, 60)
    lookback_months = clamp(lookback_months, 2, 24)

    today = date.today()
    if start_year is None or start_month is None:
        start_year, start_month = analytics.add_months(today.year, today.month, 1)

    horizon = max(installments, 6)
    periods = [
        f"{y}-{m:02d}"
        for y, m in (analytics.add_months(start_year, start_month, i) for i in range(horizon))
    ]

    monthly_inflation = (
        (1 + inflation_annual_pct / 100) ** (1 / 12) - 1
        if inflation_annual_pct else 0.0
    )

    async with tool_session() as db:
        caller = await current_caller(db)
        tid = caller.tenant_id

        baseline = await analytics.baseline_run_rate(
            db, tid, lookback_months, until=date(today.year, today.month, 1)
        )
        avg_income = float(baseline["avg_income"])
        run_rate = float(baseline["avg_expenses_ordinary"])

        cuota_ars = float(amount) / installments
        rate = None
        if currency.upper() == "USD":
            from app.services.currency import get_latest_rate, get_tenant_rate_type
            rate_type = await get_tenant_rate_type(db, tid)
            rate = await get_latest_rate(db, rate_type)
            if rate is None:
                return {
                    "error": "No hay cotización disponible para convertir la compra a pesos",
                    "rate_type": rate_type,
                }
            cuota_ars = float(amount) * float(rate) / installments

        statements = await analytics.statement_totals_by_period(db, tid, periods)

        months: list[dict] = []
        for i, p in enumerate(periods):
            year, month = int(p[:4]), int(p[5:7])
            mstart, mend = analytics.month_bounds(year, month)
            mortgage, _ = await analytics.mortgage_payment_for_month(db, tid, mstart, mend)

            committed = sum(
                (c["total_ars"] for c in statements.get(p, [])), Decimal(0)
            ) + (mortgage or Decimal(0))

            # Months from today, not from the first instalment: income grows
            # from now, while the instalment only starts being paid later.
            offset = (year * 12 + month) - (today.year * 12 + today.month)
            income = avg_income * ((1 + monthly_inflation) ** offset if grow_income_with_inflation else 1)
            new_cuota = cuota_ars if i < installments else 0.0
            total_expenses = run_rate + float(committed) + new_cuota
            balance = income - total_expenses

            months.append({
                "period": p,
                "income": round(income, 2),
                "baseline_expenses": round(run_rate, 2),
                "committed": f0(committed),
                "new_installment": round(new_cuota, 2),
                "total_expenses": round(total_expenses, 2),
                "balance": round(balance, 2),
                "cuota_pct_of_income": round(new_cuota / income * 100, 2) if income else None,
                # What the instalment is worth in today's pesos: the whole point
                # of paying in cuotas when inflation is high.
                "cuota_real_ars": round(new_cuota / ((1 + monthly_inflation) ** i), 2),
                "is_negative": balance < 0,
            })

    paying = [m for m in months if m["new_installment"]]
    total_nominal = sum(m["new_installment"] for m in paying)
    total_real = sum(m["cuota_real_ars"] for m in paying)
    negatives = [m for m in months if m["is_negative"]]
    worst = min(months, key=lambda m: m["balance"]) if months else None
    max_share = max((m["cuota_pct_of_income"] or 0) for m in paying) if paying else 0
    avg_balance = avg_income - run_rate

    if negatives:
        assessment = "riesgoso"
    elif max_share > 25 or (avg_balance and worst and worst["balance"] < avg_balance * 0.25):
        assessment = "ajustado"
    else:
        assessment = "holgado"

    assumptions = [
        f"Ingreso y gasto corriente = promedio de los últimos {lookback_months} "
        f"meses cerrados ({baseline['from']} a {baseline['to']}).",
        "El gasto base excluye cuotas de tarjeta e hipoteca, que se suman aparte "
        "como compromisos: si no, se contarían dos veces.",
        "'committed' es el total de los resúmenes de tarjeta ya cargados para "
        "cada mes más la cuota de hipoteca.",
        "No incluye compras futuras que todavía no estén cargadas.",
        "La tenencia en dólares no se cuenta como colchón.",
    ]
    if monthly_inflation:
        assumptions.append(
            f"Inflación supuesta: {inflation_annual_pct}% anual "
            f"({monthly_inflation * 100:.2f}% mensual)."
        )
    else:
        assumptions.append(
            "Sin licuación por inflación (escenario conservador). Pasá "
            "inflation_annual_pct para ver cuánto se licúan las cuotas."
        )
    if rate is not None:
        assumptions.append(f"Compra en USD convertida a {float(rate):,.2f} $/USD.")

    return guard({
        "purchase": {
            "description": description,
            "amount": round(float(amount), 2),
            "currency": currency.upper(),
            "installments": installments,
            "cuota_nominal_ars": round(cuota_ars, 2),
            "first_period": periods[0],
            "last_period": periods[installments - 1],
        },
        "baseline": {
            "lookback_months": lookback_months,
            "avg_income_ars": round(avg_income, 2),
            "baseline_expenses_ars": round(run_rate, 2),
            "avg_balance_ars": round(avg_balance, 2),
        },
        "months": months,
        "verdict": {
            "assessment": assessment,
            "months_negative": len(negatives),
            "worst_period": worst["period"] if worst else None,
            "worst_balance": worst["balance"] if worst else None,
            "total_nominal_ars": round(total_nominal, 2),
            "total_real_ars": round(total_real, 2),
            "licuacion_pct": (
                round((1 - total_real / total_nominal) * 100, 2) if total_nominal else 0
            ),
            "max_cuota_pct_of_income": round(max_share, 2),
        },
        "assumptions": assumptions,
    })
