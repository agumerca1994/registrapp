"""Ahorro: objetivos y sus aportes. La lógica es `services/savings.py`."""
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, get_actor
from app.core.database import get_db
from app.models.savings import SavingsContribution, SavingsGoal
from app.services import savings
from app.services.clock import ar_today
from app.services.currency import get_usd_holding

router = APIRouter(prefix="/savings", tags=["savings"])


async def _actor(actor: Actor | None = Depends(get_actor)) -> Actor:
    if actor is None:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return actor


class GoalCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    currency: str = "USD"
    target_amount: Decimal
    target_date: date | None = None
    # Lo que ya está juntado al crear el objetivo, como primer aporte.
    initial_amount: Decimal | None = None

    @model_validator(mode="after")
    def check(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Ponele un nombre al objetivo.")
        if self.currency not in savings.CURRENCIES:
            raise ValueError("La moneda tiene que ser pesos o dólares.")
        if self.target_amount <= 0:
            raise ValueError("El monto objetivo tiene que ser mayor que cero.")
        if self.initial_amount is not None and self.initial_amount < 0:
            raise ValueError("Lo que ya juntaste no puede ser negativo.")
        return self


class GoalUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    target_amount: Decimal | None = None
    target_date: date | None = None
    archived: bool | None = None

    @model_validator(mode="after")
    def check(self):
        if self.target_amount is not None and self.target_amount <= 0:
            raise ValueError("El monto objetivo tiene que ser mayor que cero.")
        return self


class GoalOut(BaseModel):
    id: int
    name: str
    currency: str
    target_amount: Decimal
    target_date: date | None
    archived: bool
    created_at: datetime
    saved: Decimal
    remaining: Decimal
    pct: float
    achieved: bool
    months_left: int | None
    per_month_needed: Decimal | None
    pace_per_month: Decimal | None
    eta: date | None
    overdue: bool
    last_contribution: date | None


class GoalsOut(BaseModel):
    goals: list[GoalOut]
    saved_ars: Decimal
    saved_usd: Decimal
    # Lo que la app sabe que hay en dólares (Divisas), para comparar con lo apartado.
    usd_holding: Decimal


class ContributionCreate(BaseModel):
    amount: Decimal  # negativo = retiro
    contribution_date: date | None = None
    note: str | None = Field(default=None, max_length=255)


class ContributionOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    amount: Decimal
    contribution_date: date
    note: str | None
    user_id: int | None


class GoalDetail(BaseModel):
    goal: GoalOut
    contributions: list[ContributionOut]


def _out(s: savings.GoalSummary) -> GoalOut:
    g = s.goal
    return GoalOut(
        id=g.id, name=g.name, currency=g.currency, target_amount=g.target_amount,
        target_date=g.target_date, archived=g.archived_at is not None, created_at=g.created_at,
        saved=s.saved, remaining=s.remaining, pct=s.pct, achieved=s.achieved,
        months_left=s.months_left, per_month_needed=s.per_month_needed,
        pace_per_month=s.pace_per_month, eta=s.eta, overdue=s.overdue,
        last_contribution=s.last_contribution,
    )


@router.get("/goals", response_model=GoalsOut)
async def list_goals(actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    tenant_id = actor.user.tenant_id
    goals = (await db.scalars(
        select(SavingsGoal).where(SavingsGoal.tenant_id == tenant_id).order_by(SavingsGoal.created_at)
    )).all()
    outs = [_out(await savings.summarize(db, g)) for g in goals]
    holding = await get_usd_holding(db, tenant_id)
    return GoalsOut(
        goals=outs,
        saved_ars=sum((o.saved for o in outs if o.currency == "ARS" and not o.archived), Decimal(0)),
        saved_usd=sum((o.saved for o in outs if o.currency == "USD" and not o.archived), Decimal(0)),
        usd_holding=holding.holding,
    )


@router.post("/goals", response_model=GoalOut, status_code=201)
async def create_goal(body: GoalCreate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    goal = SavingsGoal(
        tenant_id=actor.user.tenant_id, user_id=actor.user.id, name=body.name,
        currency=body.currency, target_amount=body.target_amount, target_date=body.target_date,
    )
    db.add(goal)
    await db.flush()
    if body.initial_amount:
        await savings.add_contribution(db, goal, actor.user.id, body.initial_amount, ar_today(), savings.INITIAL_NOTE)
    await db.commit()
    await db.refresh(goal)
    return _out(await savings.summarize(db, goal))


@router.get("/goals/{goal_id}", response_model=GoalDetail)
async def get_goal(goal_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    goal = await savings.own_goal(db, goal_id, actor.user.tenant_id)
    rows = (await db.scalars(
        select(SavingsContribution)
        .where(SavingsContribution.goal_id == goal.id)
        .order_by(SavingsContribution.contribution_date.desc(), SavingsContribution.id.desc())
    )).all()
    return GoalDetail(
        goal=_out(await savings.summarize(db, goal)),
        contributions=[ContributionOut.model_validate(r) for r in rows],
    )


@router.patch("/goals/{goal_id}", response_model=GoalOut)
async def update_goal(
    goal_id: int, body: GoalUpdate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    goal = await savings.own_goal(db, goal_id, actor.user.tenant_id)
    data = body.model_dump(exclude_unset=True)
    if "name" in data and data["name"] is not None:
        goal.name = data["name"].strip()
    if data.get("target_amount") is not None:
        goal.target_amount = data["target_amount"]
    if "target_date" in data:  # un null explícito saca la fecha
        goal.target_date = data["target_date"]
    if data.get("archived") is not None:
        goal.archived_at = datetime.utcnow() if data["archived"] else None
    await db.commit()
    await db.refresh(goal)
    return _out(await savings.summarize(db, goal))


@router.delete("/goals/{goal_id}", status_code=204)
async def delete_goal(goal_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    goal = await savings.own_goal(db, goal_id, actor.user.tenant_id)
    # Explícito y no sólo por el CASCADE: SQLite (tests) no hace cumplir la FK.
    for row in (await db.scalars(select(SavingsContribution).where(SavingsContribution.goal_id == goal.id))).all():
        await db.delete(row)
    await db.flush()
    await db.delete(goal)
    await db.commit()


@router.post("/goals/{goal_id}/contributions", response_model=ContributionOut, status_code=201)
async def add_contribution(
    goal_id: int, body: ContributionCreate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    goal = await savings.own_goal(db, goal_id, actor.user.tenant_id)
    row = await savings.add_contribution(
        db, goal, actor.user.id, body.amount, body.contribution_date or ar_today(), body.note,
    )
    await db.commit()
    return ContributionOut.model_validate(row)


@router.delete("/contributions/{contribution_id}", status_code=204)
async def delete_contribution(
    contribution_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    row = await db.get(SavingsContribution, contribution_id)
    if not row or row.tenant_id != actor.user.tenant_id:
        raise HTTPException(status_code=404, detail="Aporte no encontrado")
    await savings.delete_contribution(db, row)
    await db.commit()
