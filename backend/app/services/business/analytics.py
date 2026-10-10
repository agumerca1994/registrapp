"""Los números del negocio, con las mismas reglas que el dashboard del hogar.

Se arma sobre `services/analytics.py` y no al lado: los gastos cuentan el día
en que sale la plata (`cash_out_date()`: una compra con tarjeta, cuando vence
el resumen) y las monedas no se mezclan nunca. Un agregado propio del negocio
que contara distinto haría que el conector MCP y la pantalla se contradigan.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from pydantic import BaseModel
from sqlalchemy import case, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Payee
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


class BusinessSummary(BaseModel):
    period: str
    total_income: Decimal
    total_expenses: Decimal
    total_expenses_usd: Decimal
    # Ingresos − egresos en pesos, por fecha de pago (ver el docstring del módulo).
    balance: Decimal
    expenses_by_category: list[CategorySummary]
    spend_by_payee: list[PayeeSpend]


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


async def business_summary(
    db: AsyncSession, tenant_id: int, year: int, month: int
) -> BusinessSummary:
    base = await analytics.month_summary(db, tenant_id, year, month)
    start, end = analytics.month_bounds(year, month)
    return BusinessSummary(
        period=base.period,
        total_income=base.total_income,
        total_expenses=base.total_expenses,
        total_expenses_usd=base.total_expenses_usd,
        balance=base.balance,
        expenses_by_category=base.expenses_by_category,
        spend_by_payee=await spend_by_payee(db, tenant_id, start, end),
    )
