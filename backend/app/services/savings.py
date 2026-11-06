"""Objetivos de ahorro: cuánto, en qué moneda y para cuándo, y lo que se va juntando.

Un aporte aparta plata para un objetivo; no es un gasto ni un ingreso (como
comprar dólares, la plata cambia de bolsillo), así que no toca el resultado
del mes. Lo juntado de un objetivo es la suma de sus aportes menos los retiros.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.savings import SavingsContribution, SavingsGoal
from app.services.clock import ar_today

CURRENCIES = {"ARS", "USD"}
# La nota del aporte que crea "ya tengo juntado" al dar de alta el objetivo.
INITIAL_NOTE = "Lo que ya tenía"


@dataclass
class GoalSummary:
    goal: SavingsGoal
    saved: Decimal
    remaining: Decimal
    pct: float
    achieved: bool
    months_left: int | None       # hasta la fecha objetivo, contando el mes actual
    per_month_needed: Decimal | None
    pace_per_month: Decimal | None  # lo que se viene aportando por mes
    eta: date | None              # a ese ritmo, cuándo se llega
    overdue: bool                 # pasó la fecha y no se llegó
    last_contribution: date | None
    # La cuota fija: si toca cumplirla este mes, cuánto, y a ese ritmo cuándo se llega.
    plan_paid_this_month: bool
    plan_due: bool
    plan_due_amount: Decimal | None
    plan_eta: date | None


PLAN_NOTE = "Cuota del mes"


def add_months_first(day: date, months: int) -> date:
    idx = day.year * 12 + day.month - 1 + months
    return date(idx // 12, idx % 12 + 1, 1)


def months_between(start: date, end: date) -> int:
    """Meses de calendario de `start` a `end`, contando los dos."""
    return (end.year - start.year) * 12 + (end.month - start.month) + 1


async def saved_by_goal(db: AsyncSession, goal_ids: list[int]) -> dict[int, Decimal]:
    if not goal_ids:
        return {}
    rows = (await db.execute(
        select(SavingsContribution.goal_id, func.sum(SavingsContribution.amount))
        .where(SavingsContribution.goal_id.in_(goal_ids))
        .group_by(SavingsContribution.goal_id)
    )).all()
    return {gid: Decimal(total or 0) for gid, total in rows}


async def summarize(db: AsyncSession, goal: SavingsGoal, today: date | None = None) -> GoalSummary:
    today = today or ar_today()
    rows = (await db.execute(
        select(SavingsContribution.amount, SavingsContribution.contribution_date, SavingsContribution.note)
        .where(SavingsContribution.goal_id == goal.id)
    )).all()
    saved = sum((Decimal(a) for a, _, _ in rows), Decimal(0))
    target = Decimal(goal.target_amount)
    remaining = max(target - saved, Decimal(0))
    achieved = saved >= target

    months_left = per_month = None
    overdue = False
    if goal.target_date and not achieved:
        if goal.target_date < today:
            overdue = True
        else:
            months_left = months_between(today, goal.target_date)
            per_month = (remaining / months_left).quantize(Decimal("0.01"))

    # El ritmo: lo aportado desde el primer aporte, repartido en los meses que
    # pasaron. Sin lo que ya estaba juntado al crearlo: eso no es ritmo, y un
    # objetivo nuevo con U$D 800 "venía aportando U$D 800 por mes".
    pace = eta = None
    paced = [(Decimal(a), d) for a, d, note in rows if note != INITIAL_NOTE]
    first = min((d for _, d in paced), default=None)
    paced_total = sum((a for a, _ in paced), Decimal(0))
    if first and paced_total > 0:
        pace = (paced_total / months_between(first, today)).quantize(Decimal("0.01"))
        if not achieved and pace > 0:
            ahead = math.ceil(remaining / pace)
            idx = today.year * 12 + today.month - 1 + ahead
            eta = date(idx // 12, idx % 12 + 1, 1)

    # La cuota del mes: vence el `plan_day` y se da por cumplida con cualquier aporte del mes.
    month_start = date(today.year, today.month, 1)
    paid_month = any(Decimal(a) > 0 and d >= month_start for a, d, _ in rows)
    plan = Decimal(goal.plan_amount) if goal.plan_amount else None
    active_plan = plan is not None and not goal.plan_paused and goal.archived_at is None and not achieved
    plan_due = bool(active_plan and not paid_month and today.day >= (goal.plan_day or 1))
    plan_due_amount = min(plan, remaining) if active_plan else None
    plan_eta = None
    if active_plan and remaining > 0:
        # Cuántas cuotas faltan, contando la de este mes si todavía no se pagó.
        plan_eta = add_months_first(today, math.ceil(remaining / plan) - (0 if paid_month else 1))

    return GoalSummary(
        goal=goal,
        saved=saved,
        remaining=remaining,
        pct=round(float(saved / target * 100), 1) if target else 0.0,
        achieved=achieved,
        months_left=months_left,
        per_month_needed=per_month,
        pace_per_month=pace,
        eta=eta,
        overdue=overdue,
        last_contribution=max((d for _, d, _ in rows), default=None),
        plan_paid_this_month=paid_month,
        plan_due=plan_due,
        plan_due_amount=plan_due_amount,
        plan_eta=plan_eta,
    )


async def own_goal(db: AsyncSession, goal_id: int, tenant_id: int) -> SavingsGoal:
    goal = await db.get(SavingsGoal, goal_id)
    if not goal or goal.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Objetivo no encontrado")
    return goal


async def add_contribution(
    db: AsyncSession, goal: SavingsGoal, user_id: int | None,
    amount: Decimal, day: date, note: str | None,
) -> SavingsContribution:
    """Un aporte (positivo) o un retiro (negativo). Un retiro no puede dejar el
    objetivo en negativo. Sólo flush."""
    if amount == 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser cero.")
    if amount < 0:
        saved = (await saved_by_goal(db, [goal.id])).get(goal.id, Decimal(0))
        if saved + amount < 0:
            raise HTTPException(status_code=400, detail="No podés sacar más de lo que juntaste.")
    row = SavingsContribution(
        tenant_id=goal.tenant_id, goal_id=goal.id, user_id=user_id,
        amount=amount, contribution_date=day, note=(note or "").strip() or None,
    )
    db.add(row)
    await db.flush()
    return row


async def delete_contribution(db: AsyncSession, row: SavingsContribution) -> None:
    """Borrar un aporte tampoco puede dejar el objetivo en negativo (pasaría al
    borrar un aporte que un retiro posterior ya usó)."""
    if row.amount > 0:
        saved = (await saved_by_goal(db, [row.goal_id])).get(row.goal_id, Decimal(0))
        if saved - row.amount < 0:
            raise HTTPException(
                status_code=400,
                detail="Si borrás este aporte, lo que sacaste queda sin respaldo. Borrá primero el retiro.",
            )
    await db.delete(row)
    await db.flush()
