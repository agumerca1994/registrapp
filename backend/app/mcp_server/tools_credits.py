"""Créditos y objetivos de ahorro, de lectura. Los cálculos son los de la
pantalla (`services/credits.py`, `services/savings.py`)."""
from typing import Any

from sqlalchemy import select

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import READ_ONLY, mcp
from app.mcp_server.serialize import f, guard
from app.models.mortgage import MortgageLoan
from app.models.savings import SavingsGoal
from app.services import credits, savings


@mcp.tool(annotations=READ_ONLY)
async def get_credits() -> dict[str, Any]:
    """Los créditos del hogar (hipotecario, personal, prendario, plan de ahorro,
    de un particular u otro): cuánto es la próxima cuota, cuántas faltan y
    cuánto se debe.

    Las cuotas de cada crédito ya están como egresos en la categoría de su tipo
    (las registra la app); no las sumes otra vez a los gastos. `balance` sale
    del cálculo del sistema de amortización y es null cuando no se conoce el
    capital. En un crédito UVA, los montos en pesos usan la última UVA conocida.
    Un crédito `manual` (plan de ahorro, tasa variable) no tiene cuota prevista.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        loans = (await db.scalars(
            select(MortgageLoan).where(MortgageLoan.tenant_id == caller.tenant_id).order_by(MortgageLoan.id)
        )).all()
        out = []
        for loan in loans:
            s = await credits.summarize(db, loan)
            out.append({
                "id": loan.id,
                "name": s.title,
                "kind": loan.kind,
                "currency": loan.currency,
                "adjustment": loan.adjustment,
                "amortization": loan.amortization,
                "method": loan.method,
                "tna_pct": f(loan.tna),
                "active": loan.is_active,
                "finished": s.finished,
                "cuotas": {"total": loan.total_cuotas, "paid": s.cuotas_pagadas, "left": s.cuotas_restantes},
                "next": {
                    "number": s.cuota_numero,
                    "date": s.next_payment_date.isoformat() if s.next_payment_date else None,
                    "amount": f(s.next_amount),
                    "uva": f(s.next_units, 4),
                    "estimated": s.next_is_estimated,
                } if not s.finished else None,
                "balance": f(s.balance),
                "balance_uva": f(s.balance_units, 4),
                "total_paid": f(s.total_paid),
            })
    return guard({"credits": out})


@mcp.tool(annotations=READ_ONLY)
async def get_savings_goals() -> dict[str, Any]:
    """Los objetivos de ahorro del hogar: meta, lo juntado, lo que falta y cuánto
    habría que apartar por mes para llegar a la fecha.

    Apartar plata para un objetivo no es un gasto: los aportes no aparecen en
    egresos ni cambian el resultado del mes. Pesos y dólares van por separado.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        goals = (await db.scalars(
            select(SavingsGoal).where(SavingsGoal.tenant_id == caller.tenant_id).order_by(SavingsGoal.id)
        )).all()
        out = []
        for goal in goals:
            s = await savings.summarize(db, goal)
            out.append({
                "id": goal.id,
                "name": goal.name,
                "currency": goal.currency,
                "target": f(goal.target_amount),
                "target_date": goal.target_date.isoformat() if goal.target_date else None,
                "archived": goal.archived_at is not None,
                "saved": f(s.saved),
                "remaining": f(s.remaining),
                "pct": s.pct,
                "achieved": s.achieved,
                "overdue": s.overdue,
                "per_month_needed": f(s.per_month_needed),
                "pace_per_month": f(s.pace_per_month),
                "eta": s.eta.isoformat() if s.eta else None,
            })
    return guard({"goals": out})
