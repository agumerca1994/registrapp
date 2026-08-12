"""Orientation tools: what the household calls things, and how a month went."""
from typing import Any

from sqlalchemy import select

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.serialize import f, f0, guard
from app.models.credit_card import CreditCard
from app.models.expense import ExpenseCategory
from app.models.income import IncomeSource
from app.services import analytics
from app.services.currency import get_tenant_rate_type


@mcp.tool()
async def get_taxonomy() -> dict[str, Any]:
    """Catálogo del hogar: categorías de gasto, fuentes de ingreso y tarjetas.

    Llamala primero cuando necesites filtrar por nombre en otras herramientas,
    para usar los nombres exactos que cargó el usuario.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        tid = caller.tenant_id

        categories = (await db.execute(
            select(ExpenseCategory)
            .where(ExpenseCategory.tenant_id == tid)
            .order_by(ExpenseCategory.name)
        )).scalars().all()

        sources = (await db.execute(
            select(IncomeSource)
            .where(IncomeSource.tenant_id == tid)
            .order_by(IncomeSource.name)
        )).scalars().all()

        cards = (await db.execute(
            select(CreditCard)
            .where(CreditCard.tenant_id == tid)
            .order_by(CreditCard.alias)
        )).scalars().all()

        rate_type = await get_tenant_rate_type(db, tid)

    return guard({
        "categories": [
            {"id": c.id, "name": c.name, "is_fixed": c.is_fixed, "color": c.color}
            for c in categories
        ],
        "income_sources": [
            {
                "id": s.id,
                "name": s.name,
                "income_type": s.income_type.value if s.income_type else None,
                "is_active": s.is_active,
            }
            for s in sources
        ],
        "cards": [
            {"id": c.id, "alias": c.alias, "bank": c.bank, "last_4_digits": c.last_4_digits}
            for c in cards
        ],
        "currencies": ["ARS", "USD"],
        "fx_rate_type": rate_type,
        "notes": [
            "is_fixed marca las categorías que el usuario declaró como gasto fijo.",
            "Los gastos en USD siempre caen en la categoría 'Consumo en dólares'.",
        ],
    })


@mcp.tool()
async def get_month_summary(year: int, month: int) -> dict[str, Any]:
    """Resumen de un mes: ingresos, gastos, balance y contexto macro.

    Devuelve ingresos totales, gastos en pesos, gastos en dólares (por separado),
    balance, pesos realmente disponibles, tenencia en dólares, cuota de hipoteca,
    UVA e inflación del mes, y el gasto desagregado por categoría.

    Args:
        year: Año (ej. 2026).
        month: Mes 1-12.
    """
    if not 1 <= month <= 12:
        return {"error": "month debe estar entre 1 y 12"}

    async with tool_session() as db:
        caller = await current_caller(db)
        s = await analytics.month_summary(db, caller.tenant_id, year, month)

    return guard({
        "period": s.period,
        "ars": {
            "total_income": f0(s.total_income),
            "total_expenses": f0(s.total_expenses),
            "balance": f0(s.balance),
            "ars_available": f0(s.ars_available),
            "fx_bought_ars": f0(s.fx_bought_ars),
            "fx_sold_ars": f0(s.fx_sold_ars),
        },
        "usd": {
            "total_expenses_usd": f0(s.total_expenses_usd),
            "holding_start": f0(s.usd_holding_start),
            "initial": f0(s.usd_initial),
            "bought": f0(s.usd_bought),
            "sold": f0(s.usd_sold),
            "earned": f0(s.usd_earned),
            "paid": f0(s.usd_paid),
            "adjustments": f0(s.usd_adjustments),
            "holding": f0(s.usd_holding),
            "holding_ars": f(s.usd_holding_ars),
            "rate": f(s.usd_rate, 4),
            "rate_type": s.usd_rate_type,
        },
        "mortgage": {
            "payment": f(s.mortgage_payment),
            "is_projected": s.mortgage_is_projected,
        },
        "macro": {
            "uva_value": f(s.uva_value, 6),
            "inflation_monthly_pct": f(s.inflation_pct, 4),
        },
        "expenses_by_category": [
            {"category": c.category_name, "total": f0(c.total), "color": c.color}
            for c in s.expenses_by_category
        ],
        "notes": [
            "total_expenses y expenses_by_category son sólo ARS; los gastos en USD "
            "van en el bloque 'usd'.",
            "ars_available = balance − fx_bought_ars + fx_sold_ars: comprar dólares "
            "no es gasto, pero mueve pesos.",
            "El mes cierra en dos bolsillos y hay que informar los dos: en pesos "
            "queda ars_available, y en dólares queda holding = holding_start + "
            "initial + bought + earned − sold − paid + adjustments. Un balance "
            "alto con la tenencia cayendo a cero no es un mes con sobrante: se "
            "consumieron ahorros.",
        ],
    })
