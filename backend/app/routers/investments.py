"""Inversiones. La lógica es `services/investments.py`."""
from datetime import date, datetime
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, get_actor
from app.core.database import get_db
from app.models.investment import Investment, InvestmentMovement
from app.services import investments as svc
from app.services.clock import ar_today

router = APIRouter(prefix="/investments", tags=["investments"])


async def _actor(actor: Actor | None = Depends(get_actor)) -> Actor:
    if actor is None:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return actor


class InvestmentCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    kind: str
    currency: str = "ARS"
    institution: str | None = Field(default=None, max_length=80)
    tna: Decimal | None = None
    start_date: date | None = None
    maturity_date: date | None = None
    amount: Decimal  # lo que pusiste al empezar
    # En lo que cotiza: lo que vale hoy, si ya no es lo que pusiste.
    current_value: Decimal | None = None

    @model_validator(mode="after")
    def check(self):
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("Ponele un nombre.")
        if self.kind not in svc.KINDS:
            raise ValueError("Elegí un tipo de la lista.")
        if self.currency not in svc.CURRENCIES:
            raise ValueError("La moneda tiene que ser pesos o dólares.")
        if self.amount <= 0:
            raise ValueError("El monto tiene que ser mayor que cero.")
        if self.tna is not None and not 0 <= self.tna <= 1000:
            raise ValueError("La TNA tiene que estar entre 0 y 1000%.")
        if self.kind in ("plazo_fijo", "cuenta") and self.tna is None:
            raise ValueError("Decime la tasa (TNA).")
        start = self.start_date or ar_today()
        if start > ar_today():
            raise ValueError("La fecha de comienzo no puede ser futura.")
        if self.kind == "plazo_fijo":
            if not self.maturity_date:
                raise ValueError("Decime cuándo vence el plazo fijo.")
            if self.maturity_date <= start:
                raise ValueError("El vencimiento tiene que ser después del día en que lo hiciste.")
        if self.current_value is not None and self.current_value < 0:
            raise ValueError("El valor no puede ser negativo.")
        return self


class InvestmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=80)
    institution: str | None = Field(default=None, max_length=80)
    tna: Decimal | None = None
    maturity_date: date | None = None


class MovementCreate(BaseModel):
    kind: str  # deposit | withdrawal | valuation
    amount: Decimal
    movement_date: date | None = None
    note: str | None = Field(default=None, max_length=255)


class RenewBody(BaseModel):
    maturity_date: date
    tna: Decimal | None = None
    add: Decimal | None = None
    take: Decimal | None = None


class CloseBody(BaseModel):
    amount: Decimal  # lo que entró al rescatar
    close_date: date | None = None


class InvestmentOut(BaseModel):
    id: int
    name: str
    kind: str
    kind_label: str
    currency: str
    institution: str | None
    tna: Decimal | None
    start_date: date
    maturity_date: date | None
    closed_at: date | None
    created_at: datetime
    invested: Decimal
    value: Decimal
    gain: Decimal
    gain_pct: float | None
    value_date: date | None
    calculated: bool
    stale_days: int | None
    matured: bool
    value_at_maturity: Decimal | None


class CurrencyTotals(BaseModel):
    value: Decimal
    invested: Decimal
    gain: Decimal


class InvestmentsOut(BaseModel):
    investments: list[InvestmentOut]
    # Sólo las vigentes, y cada moneda por su lado: nunca se suman pesos con dólares.
    totals: dict[str, CurrencyTotals]


class MovementOut(BaseModel):
    model_config = {"from_attributes": True}
    id: int
    kind: str
    amount: Decimal
    movement_date: date
    note: str | None
    user_id: int | None


class InvestmentDetail(BaseModel):
    investment: InvestmentOut
    movements: list[MovementOut]


def _out(inv: Investment, v: svc.Valuation) -> InvestmentOut:
    return InvestmentOut(
        id=inv.id, name=inv.name, kind=inv.kind, kind_label=svc.KINDS[inv.kind][0],
        currency=inv.currency, institution=inv.institution, tna=inv.tna,
        start_date=inv.start_date, maturity_date=inv.maturity_date, closed_at=inv.closed_at,
        created_at=inv.created_at, invested=v.invested, value=v.value, gain=v.gain,
        gain_pct=v.gain_pct, value_date=v.value_date, calculated=v.calculated,
        stale_days=v.stale_days, matured=v.matured, value_at_maturity=v.value_at_maturity,
    )


async def _summary(db: AsyncSession, inv: Investment) -> InvestmentOut:
    return _out(inv, svc.valuate(inv, await svc.movements_of(db, inv.id)))


@router.get("", response_model=InvestmentsOut)
async def list_investments(actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    rows = (await db.scalars(
        select(Investment).where(Investment.tenant_id == actor.user.tenant_id).order_by(Investment.created_at)
    )).all()
    outs = [await _summary(db, inv) for inv in rows]
    totals: dict[str, CurrencyTotals] = {}
    for o in outs:
        if o.closed_at is not None:
            continue
        t = totals.setdefault(o.currency, CurrencyTotals(value=Decimal(0), invested=Decimal(0), gain=Decimal(0)))
        t.value += o.value
        t.invested += o.invested
        t.gain += o.gain
    return InvestmentsOut(investments=outs, totals=totals)


@router.post("", response_model=InvestmentOut, status_code=201)
async def create_investment(body: InvestmentCreate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    start = body.start_date or ar_today()
    inv = Investment(
        tenant_id=actor.user.tenant_id, user_id=actor.user.id, name=body.name, kind=body.kind,
        currency=body.currency, institution=(body.institution or "").strip() or None,
        tna=body.tna, start_date=start, maturity_date=body.maturity_date if body.kind == "plazo_fijo" else None,
    )
    db.add(inv)
    await db.flush()
    await svc.add_movement(db, inv, actor.user.id, "deposit", body.amount, start)
    if body.current_value is not None and body.current_value != body.amount:
        await svc.add_movement(db, inv, actor.user.id, "valuation", body.current_value, ar_today())
    await db.commit()
    await db.refresh(inv)
    return await _summary(db, inv)


@router.get("/{investment_id}", response_model=InvestmentDetail)
async def get_investment(investment_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    inv = await svc.own(db, investment_id, actor.user.tenant_id)
    movements = await svc.movements_of(db, inv.id)
    return InvestmentDetail(
        investment=_out(inv, svc.valuate(inv, movements)),
        movements=[MovementOut.model_validate(m) for m in movements],
    )


@router.patch("/{investment_id}", response_model=InvestmentOut)
async def update_investment(
    investment_id: int, body: InvestmentUpdate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    inv = await svc.own(db, investment_id, actor.user.tenant_id)
    data = body.model_dump(exclude_unset=True)
    if data.get("name"):
        inv.name = data["name"].strip()
    if "institution" in data:
        inv.institution = (data["institution"] or "").strip() or None
    if data.get("tna") is not None:
        if inv.kind not in ("plazo_fijo", "cuenta"):
            raise HTTPException(status_code=400, detail="Sólo un plazo fijo o una cuenta tienen tasa.")
        inv.tna = data["tna"]
    if data.get("maturity_date") is not None:
        if inv.kind != "plazo_fijo" or data["maturity_date"] <= inv.start_date:
            raise HTTPException(status_code=400, detail="El vencimiento tiene que ser después del comienzo del plazo fijo.")
        inv.maturity_date = data["maturity_date"]
    await db.commit()
    await db.refresh(inv)
    return await _summary(db, inv)


@router.delete("/{investment_id}", status_code=204)
async def delete_investment(investment_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    inv = await svc.own(db, investment_id, actor.user.tenant_id)
    # Explícito y no sólo por el CASCADE: SQLite (tests) no hace cumplir la FK.
    for m in await svc.movements_of(db, inv.id):
        await db.delete(m)
    await db.flush()
    await db.delete(inv)
    await db.commit()


@router.post("/{investment_id}/movements", response_model=MovementOut, status_code=201)
async def add_movement(
    investment_id: int, body: MovementCreate, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    inv = await svc.own(db, investment_id, actor.user.tenant_id)
    row = await svc.add_movement(
        db, inv, actor.user.id, body.kind, body.amount, body.movement_date or ar_today(), body.note,
    )
    await db.commit()
    return MovementOut.model_validate(row)


@router.delete("/movements/{movement_id}", status_code=204)
async def delete_movement(movement_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    row = await db.get(InvestmentMovement, movement_id)
    if not row or row.tenant_id != actor.user.tenant_id:
        raise HTTPException(status_code=404, detail="Movimiento no encontrado")
    inv = await db.get(Investment, row.investment_id)
    others = [m for m in await svc.movements_of(db, row.investment_id) if m.id != row.id]
    if not any(m.kind == "deposit" for m in others):
        raise HTTPException(status_code=400, detail="Es lo único que pusiste. Si no va, eliminá la inversión.")
    if inv.closed_at is not None:
        raise HTTPException(status_code=400, detail="Esta inversión ya se rescató. Deshacé el rescate primero.")
    await db.delete(row)
    await db.commit()


@router.post("/{investment_id}/renew", response_model=InvestmentOut)
async def renew_investment(
    investment_id: int, body: RenewBody, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    inv = await svc.own(db, investment_id, actor.user.tenant_id)
    await svc.renew(db, inv, actor.user.id, body.maturity_date, body.tna, body.add, body.take)
    await db.commit()
    await db.refresh(inv)
    return await _summary(db, inv)


@router.post("/{investment_id}/close", response_model=InvestmentOut)
async def close_investment(
    investment_id: int, body: CloseBody, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db),
):
    inv = await svc.own(db, investment_id, actor.user.tenant_id)
    await svc.close(db, inv, actor.user.id, body.amount, body.close_date or ar_today())
    await db.commit()
    await db.refresh(inv)
    return await _summary(db, inv)


@router.delete("/{investment_id}/close", response_model=InvestmentOut)
async def reopen_investment(investment_id: int, actor: Actor = Depends(_actor), db: AsyncSession = Depends(get_db)):
    """Deshacer el rescate: vuelve a estar vigente y se borra la salida del rescate."""
    inv = await svc.own(db, investment_id, actor.user.tenant_id)
    if inv.closed_at is None:
        raise HTTPException(status_code=400, detail="Esta inversión no está rescatada.")
    for m in await svc.movements_of(db, inv.id):
        if m.kind == "withdrawal" and m.note == "Rescate" and m.movement_date == inv.closed_at:
            await db.delete(m)
            break
    inv.closed_at = None
    await db.commit()
    await db.refresh(inv)
    return await _summary(db, inv)
