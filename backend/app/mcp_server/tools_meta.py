"""Orientation tools: what the household calls things, and how a month went."""
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import READ_ONLY, mcp
from app.mcp_server.serialize import f, f0, guard
from app.models.business import Payee, Product
from app.models.credit_card import CreditCard
from app.models.expense import ExpenseCategory
from app.models.income import IncomeSource
from app.models.tenant import TENANT_KIND_BUSINESS, Tenant
from app.services import analytics
from app.services.currency import get_tenant_rate_type


# Las reglas de un negocio. Viajan en la respuesta y no en INSTRUCTIONS porque
# el servidor es uno solo para todos (mcp 1.29 no deja variar las instrucciones
# por request) y un hogar no tiene por qué leerlas.
BUSINESS_RULES = [
    "Es la cuenta de un NEGOCIO, no de un hogar: no apliques las reglas de "
    "divisas, hipoteca, gastos compartidos ni recibos de sueldo.",
    "El resultado del mes es ventas − egresos. Los gastos cuentan el mes en que "
    "sale la plata: una compra con tarjeta, cuando vence el resumen. Los montos "
    "nunca se mezclan entre ARS y USD.",
    "Las ventas entran como UN ingreso por día en la fuente «Ventas»: lo CONTADO "
    "si ese día se cerró la caja (record_daily_close) y, si no, la suma de las "
    "ventas (record_sale). Ese ingreso lo arma la app: no lo crees ni lo edites "
    "con save_income_entry (lo rechaza). Para leer ventas usá get_sales.",
    "Una venta cargada en un día que ya tiene cierre no cambia el total del día: "
    "si esa plata no estaba en la caja al cerrar, hay que volver a cerrar. Si lo "
    "contado supera lo vendido es venta sin ticket; si no llega, diferencia de caja.",
    "Stock: lo que hay es la suma de los movimientos (get_stock). Una compra para "
    "revender va con save_expense + stock_lines (gasto y stock juntos); "
    "producción, merma, un conteo o un ingreso sin gasto, con "
    "record_stock_movement. La materia prima (verdura, carne, harina) es un "
    "gasto, no stock: va sin stock_lines.",
    "Una venta nunca se frena por falta de stock: un stock negativo quiere decir "
    "que falta cargar producción o un ingreso, no que la venta esté mal.",
    "`payees` son los proveedores y empleados: save_expense acepta `payee` y, si "
    "no le pasás categoría, usa la suya. Se crean desde la app.",
    "Los productos no se borran: se archivan (save_product con is_active=false), "
    "porque las ventas viejas los nombran.",
]


@mcp.tool(annotations=READ_ONLY)
async def get_taxonomy() -> dict[str, Any]:
    """Catálogo de la cuenta: tipo (hogar o negocio), categorías de gasto,
    fuentes de ingreso, tarjetas y, en un negocio, proveedores, empleados y
    productos.

    Llamala primero: `account_kind` dice si es un hogar o un negocio, y en un
    negocio `rules` reemplaza a las reglas de hogar. También da los nombres
    exactos que cargó el usuario, para filtrar en otras herramientas.
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
            .options(selectinload(IncomeSource.fields))
            .order_by(IncomeSource.name)
        )).scalars().all()

        cards = (await db.execute(
            select(CreditCard)
            .where(CreditCard.tenant_id == tid)
            .order_by(CreditCard.alias)
        )).scalars().all()

        rate_type = await get_tenant_rate_type(db, tid)
        kind = await db.scalar(select(Tenant.kind).where(Tenant.id == tid))
        payees = (await db.execute(
            select(Payee)
            .where(Payee.tenant_id == tid, Payee.is_active.is_(True))
            .order_by(Payee.name_key)
        )).scalars().all() if kind == TENANT_KIND_BUSINESS else []
        products = (await db.execute(
            select(Product)
            .where(Product.tenant_id == tid, Product.is_active.is_(True))
            .order_by(Product.name_key)
        )).scalars().all() if kind == TENANT_KIND_BUSINESS else []

    business = kind == TENANT_KIND_BUSINESS
    extra = {
        "payees": [
            {"id": p.id, "name": p.name, "kind": p.kind,
             "default_category_id": p.default_category_id}
            for p in payees
        ],
        "products": [
            {"id": p.id, "name": p.name, "kind": p.kind, "unit": p.unit,
             "sale_price": f(p.sale_price), "track_stock": p.track_stock}
            for p in products
        ],
        "rules": BUSINESS_RULES,
    } if business else {}

    return guard({
        "account_kind": kind or "household",
        **extra,
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
                # Los campos de detalle activos: con estos nombres se cargan
                # los ítems de un recibo en `save_income_entry`.
                "fields": [
                    {"id": fl.id, "name": fl.name, "kind": fl.kind}
                    for fl in s.fields if fl.is_active
                ],
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
            "fields.kind: add suma al neto, subtract resta, info no entra en la cuenta.",
        ],
    })


@mcp.tool(annotations=READ_ONLY)
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
