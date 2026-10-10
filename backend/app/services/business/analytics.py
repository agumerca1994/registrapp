"""Los números del negocio, con las mismas reglas que el dashboard del hogar.

Se arma sobre `services/analytics.py` y no al lado: los gastos cuentan el día
en que sale la plata (`cash_out_date()`: una compra con tarjeta, cuando vence
el resumen) y las monedas no se mezclan nunca. Un agregado propio del negocio
que contara distinto haría que el conector MCP y la pantalla se contradigan.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import date
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import SALE_KIND_CLOSE, SALE_KIND_TICKET, Payee, Product, Sale, SaleLine, SalePayment
from app.models.expense import ExpenseEntry
from app.services import analytics
from app.services.analytics import CategorySummary
from app.services.currency import cash_out_date, with_statement


class PayeeSpend(BaseModel):
    payee_id: int
    name: str
    kind: str
    total: Decimal                    # ARS
    total_usd: Decimal = Decimal(0)   # USD, aparte: nunca se suman
    count: int


class MethodTotal(BaseModel):
    method: str
    total: Decimal


class DayTotal(BaseModel):
    day: date
    total: Decimal


class ProductSold(BaseModel):
    product_id: int | None
    name: str
    qty: Decimal
    # Sólo lo que tiene precio en la línea: una venta rápida no se reparte.
    revenue: Decimal


class BusinessSummary(BaseModel):
    period: str
    total_income: Decimal
    total_expenses: Decimal
    total_expenses_usd: Decimal
    # Ingresos − egresos en pesos, por fecha de pago (ver el docstring del módulo).
    balance: Decimal
    expenses_by_category: list[CategorySummary]
    spend_by_payee: list[PayeeSpend]
    sales_total: Decimal = Decimal(0)
    sales_by_method: list[MethodTotal] = []
    sales_by_day: list[DayTotal] = []
    top_products: list[ProductSold] = []


async def spend_by_payee(
    db: AsyncSession, tenant_id: int, start: date, end: date
) -> list[PayeeSpend]:
    """Lo pagado a cada proveedor o empleado en `[start, end)`, por fecha de pago."""
    cash_out = cash_out_date()
    rows = await db.execute(
        with_statement(select(
            Payee.id, Payee.name, Payee.kind,
            func.coalesce(func.sum(
                case((ExpenseEntry.currency == "ARS", ExpenseEntry.amount), else_=0)
            ), 0).label("total"),
            func.coalesce(func.sum(
                case((ExpenseEntry.currency == "USD", ExpenseEntry.amount), else_=0)
            ), 0).label("total_usd"),
            func.count(ExpenseEntry.id).label("count"),
        ))
        .join(Payee, Payee.id == ExpenseEntry.payee_id)
        .where(
            ExpenseEntry.tenant_id == tenant_id,
            cash_out >= start,
            cash_out < end,
        )
        .group_by(Payee.id, Payee.name, Payee.kind)
    )
    out = [
        PayeeSpend(
            payee_id=r.id, name=r.name, kind=r.kind,
            total=Decimal(r.total), total_usd=Decimal(r.total_usd), count=r.count,
        )
        for r in rows
    ]
    return sorted(out, key=lambda p: (p.total, p.total_usd), reverse=True)


async def _effective_payments(
    db: AsyncSession, tenant_id: int, start: date, end: date
) -> dict[date, dict[str, Decimal]]:
    """Por día y medio de pago, lo que el día lleva al libro: lo contado si
    cerró, lo vendido si no — la misma regla que `sales.rebuild_day`."""
    rows = (await db.execute(
        select(Sale.sale_date, Sale.kind, SalePayment.method, func.sum(SalePayment.amount))
        .join(SalePayment, SalePayment.sale_id == Sale.id)
        .where(Sale.tenant_id == tenant_id, Sale.sale_date >= start, Sale.sale_date < end)
        .group_by(Sale.sale_date, Sale.kind, SalePayment.method)
    )).all()
    by_day: dict[date, dict[str, dict[str, Decimal]]] = defaultdict(lambda: {SALE_KIND_TICKET: {}, SALE_KIND_CLOSE: {}})
    for day, kind, method, amount in rows:
        by_day[day][kind][method] = Decimal(amount)
    return {
        day: (kinds[SALE_KIND_CLOSE] if kinds[SALE_KIND_CLOSE] else kinds[SALE_KIND_TICKET])
        for day, kinds in by_day.items()
    }


async def sales_by_method(db: AsyncSession, tenant_id: int, start: date, end: date) -> list[MethodTotal]:
    totals: dict[str, Decimal] = defaultdict(Decimal)
    for methods in (await _effective_payments(db, tenant_id, start, end)).values():
        for method, amount in methods.items():
            totals[method] += amount
    return sorted((MethodTotal(method=m, total=t) for m, t in totals.items()), key=lambda r: r.total, reverse=True)


async def sales_by_day(db: AsyncSession, tenant_id: int, start: date, end: date) -> list[DayTotal]:
    days = await _effective_payments(db, tenant_id, start, end)
    return [DayTotal(day=d, total=sum(m.values(), Decimal(0))) for d, m in sorted(days.items())]


async def top_products(
    db: AsyncSession, tenant_id: int, start: date, end: date, limit: int = 8
) -> list[ProductSold]:
    """Lo más vendido según los tickets (el cierre del día no detalla
    productos), ordenado por lo que facturó cada uno: con las barras en pesos,
    ordenar por cantidad ponía 6 empanadas de $9.000 arriba de un pollo de
    $18.000. La cantidad va en el rótulo."""
    name = func.coalesce(Product.name, SaleLine.description)
    rows = (await db.execute(
        select(
            SaleLine.product_id, name.label("name"),
            func.sum(SaleLine.qty).label("qty"),
            func.coalesce(func.sum(SaleLine.qty * SaleLine.unit_price), 0).label("revenue"),
        )
        .join(Sale, Sale.id == SaleLine.sale_id)
        .outerjoin(Product, Product.id == SaleLine.product_id)
        .where(
            Sale.tenant_id == tenant_id, Sale.kind == SALE_KIND_TICKET,
            Sale.sale_date >= start, Sale.sale_date < end,
        )
        .group_by(SaleLine.product_id, name)
        .order_by(func.coalesce(func.sum(SaleLine.qty * SaleLine.unit_price), 0).desc(), func.sum(SaleLine.qty).desc())
        .limit(limit)
    )).all()
    return [
        ProductSold(product_id=r.product_id, name=r.name, qty=Decimal(r.qty), revenue=Decimal(r.revenue))
        for r in rows
    ]


async def business_summary(
    db: AsyncSession, tenant_id: int, year: int, month: int
) -> BusinessSummary:
    base = await analytics.month_summary(db, tenant_id, year, month)
    start, end = analytics.month_bounds(year, month)
    by_day = await sales_by_day(db, tenant_id, start, end)
    return BusinessSummary(
        period=base.period,
        total_income=base.total_income,
        total_expenses=base.total_expenses,
        total_expenses_usd=base.total_expenses_usd,
        balance=base.balance,
        expenses_by_category=base.expenses_by_category,
        spend_by_payee=await spend_by_payee(db, tenant_id, start, end),
        sales_total=sum((d.total for d in by_day), Decimal(0)),
        sales_by_method=await sales_by_method(db, tenant_id, start, end),
        sales_by_day=by_day,
        top_products=await top_products(db, tenant_id, start, end),
    )
