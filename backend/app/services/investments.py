"""Inversiones: cuánto pusiste y cuánto vale hoy.

Tres maneras de saber lo que vale, según el tipo:
- **Con la tasa** (`plazo_fijo`, `cuenta`): se calcula sola. El plazo fijo con
  interés simple hasta el vencimiento; la cuenta remunerada capitaliza todos los
  días, como las billeteras.
- **Con el último valor cargado** (`fci`, `acciones`, `cripto`): cotiza todos
  los días y la app no lo sabe. Vale lo último que se cargó, más lo que se puso
  o sacó después. Sin ningún valor cargado, vale lo que se puso.
- **Lo que se puso** (`efectivo`).

Un valor cargado (`valuation`) también corrige lo calculado: si el banco dice
otra cosa, manda el banco. Lo que rinde no es un ingreso del mes hasta que se
rescata, y poner plata no es un gasto: nada de esto toca ingresos ni egresos.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.investment import Investment, InvestmentMovement
from app.services.clock import ar_today

# kind → (cómo se llama, cómo se valúa)
KINDS: dict[str, tuple[str, str]] = {
    "plazo_fijo": ("Plazo fijo", "simple"),
    "cuenta": ("Cuenta remunerada", "daily"),
    "fci": ("Fondo común de inversión", "market"),
    "acciones": ("Acciones y CEDEARs", "market"),
    "cripto": ("Cripto", "market"),
    "efectivo": ("Efectivo", "cash"),
}
CURRENCIES = {"ARS", "USD"}
MOVEMENT_KINDS = {"deposit", "withdrawal", "valuation"}
CENTS = Decimal("0.01")


def mode(inv: Investment) -> str:
    return KINDS.get(inv.kind, KINDS["efectivo"])[1]


@dataclass
class Valuation:
    invested: Decimal          # lo que pusiste menos lo que sacaste
    value: Decimal             # lo que vale hoy (0 si se rescató)
    gain: Decimal              # value − invested, o lo realizado si se rescató
    gain_pct: float | None
    value_date: date | None    # de qué día es el valor, en lo que se carga a mano
    calculated: bool           # sale de la tasa, no de un valor cargado
    stale_days: int | None     # días desde el último valor, en lo que cotiza
    matured: bool              # plazo fijo vencido y sin renovar ni rescatar
    value_at_maturity: Decimal | None


def _key(m: InvestmentMovement) -> tuple[date, int]:
    return (m.movement_date, m.id or 0)


def _net(movements: list[InvestmentMovement]) -> Decimal:
    total = Decimal(0)
    for m in movements:
        if m.kind == "deposit":
            total += m.amount
        elif m.kind == "withdrawal":
            total -= m.amount
    return total


def _simple(base: Decimal, tna: Decimal, start: date, end: date) -> Decimal:
    days = max((end - start).days, 0)
    return base * (1 + Decimal(tna) / 100 * days / 365)


def valuate(inv: Investment, movements: list[InvestmentMovement], today: date | None = None) -> Valuation:
    today = today or ar_today()
    ms = sorted((m for m in movements if m.movement_date <= today), key=_key)
    invested = _net(ms)

    if inv.closed_at is not None:
        # Rescatada: lo que importa es cuánto ganó o perdió de verdad.
        gain = -invested
        put = sum((m.amount for m in ms if m.kind == "deposit"), Decimal(0))
        return Valuation(invested=Decimal(0), value=Decimal(0), gain=gain.quantize(CENTS),
                         gain_pct=round(float(gain / put * 100), 2) if put else None,
                         value_date=inv.closed_at, calculated=False, stale_days=None,
                         matured=False, value_at_maturity=None)

    last_val = next((m for m in reversed(ms) if m.kind == "valuation"), None)
    after = [m for m in ms if last_val is None or _key(m) > _key(last_val)]
    how = mode(inv)
    tna = Decimal(inv.tna or 0)
    value_date = last_val.movement_date if last_val else None
    calculated = False
    stale = None
    matured = False
    at_maturity = None

    if how == "cash":
        value = invested if last_val is None else last_val.amount + _net(after)
    elif how == "market":
        value = invested if last_val is None else last_val.amount + _net(after)
        stale = (today - (value_date or inv.start_date)).days
    elif how == "simple":
        base = (last_val.amount if last_val else Decimal(0)) + _net(after)
        since = max(value_date or inv.start_date, inv.start_date)
        until = min(today, inv.maturity_date) if inv.maturity_date else today
        value = _simple(base, tna, since, until)
        if inv.maturity_date:
            at_maturity = _simple(base, tna, since, inv.maturity_date).quantize(CENTS)
            matured = inv.maturity_date <= today
        calculated = tna > 0
    else:  # daily: capitaliza todos los días
        rate = tna / 100 / 365
        balance = Decimal(0)
        cur: date | None = None
        for m in ms:
            if cur is not None and balance:
                balance *= (1 + rate) ** (m.movement_date - cur).days
            if m.kind == "valuation":
                balance = m.amount
            elif m.kind == "deposit":
                balance += m.amount
            else:
                balance -= m.amount
            cur = m.movement_date
        if cur is not None and balance:
            balance *= (1 + rate) ** (today - cur).days
        value = balance
        calculated = tna > 0

    value = Decimal(value).quantize(CENTS)
    gain = (value - invested).quantize(CENTS)
    return Valuation(
        invested=invested.quantize(CENTS), value=value, gain=gain,
        gain_pct=round(float(gain / invested * 100), 2) if invested > 0 else None,
        value_date=value_date, calculated=calculated, stale_days=stale,
        matured=matured, value_at_maturity=at_maturity,
    )


async def movements_of(db: AsyncSession, investment_id: int) -> list[InvestmentMovement]:
    return list((await db.scalars(
        select(InvestmentMovement)
        .where(InvestmentMovement.investment_id == investment_id)
        .order_by(InvestmentMovement.movement_date.desc(), InvestmentMovement.id.desc())
    )).all())


async def own(db: AsyncSession, investment_id: int, tenant_id: int) -> Investment:
    inv = await db.get(Investment, investment_id)
    if not inv or inv.tenant_id != tenant_id:
        raise HTTPException(status_code=404, detail="Inversión no encontrada")
    return inv


async def add_movement(
    db: AsyncSession, inv: Investment, user_id: int | None,
    kind: str, amount: Decimal, day: date, note: str | None = None,
) -> InvestmentMovement:
    """Sólo flush. Sacar no puede dejar la inversión en negativo."""
    if kind not in MOVEMENT_KINDS:
        raise HTTPException(status_code=400, detail="Ese movimiento no existe.")
    if amount <= 0:
        raise HTTPException(status_code=400, detail="El monto tiene que ser mayor que cero.")
    if inv.closed_at is not None:
        raise HTTPException(status_code=400, detail="Esta inversión ya se rescató.")
    if day < inv.start_date:
        raise HTTPException(status_code=400, detail="La fecha es anterior al comienzo de la inversión.")
    if kind == "withdrawal":
        current = valuate(inv, await movements_of(db, inv.id), max(day, ar_today()))
        if amount > current.value:
            raise HTTPException(status_code=400, detail="No podés sacar más de lo que vale.")
    row = InvestmentMovement(
        tenant_id=inv.tenant_id, investment_id=inv.id, user_id=user_id, kind=kind,
        amount=amount, movement_date=day, note=(note or "").strip() or None,
    )
    db.add(row)
    await db.flush()
    return row


async def renew(
    db: AsyncSession, inv: Investment, user_id: int | None,
    maturity_date: date, tna: Decimal | None, add: Decimal | None, take: Decimal | None,
) -> None:
    """Renueva un plazo fijo vencido: lo que valía al vencer queda como valor de
    ese día, y desde ahí corre el plazo nuevo. Se puede sumar o sacar plata."""
    if inv.kind != "plazo_fijo" or not inv.maturity_date:
        raise HTTPException(status_code=400, detail="Sólo un plazo fijo se renueva.")
    if inv.closed_at is not None:
        raise HTTPException(status_code=400, detail="Este plazo fijo ya se rescató.")
    old = inv.maturity_date
    if maturity_date <= old:
        raise HTTPException(status_code=400, detail="El vencimiento nuevo tiene que ser después del anterior.")
    v = valuate(inv, await movements_of(db, inv.id), old)
    db.add(InvestmentMovement(
        tenant_id=inv.tenant_id, investment_id=inv.id, user_id=user_id, kind="valuation",
        amount=v.value_at_maturity or v.value, movement_date=old, note="Al vencer",
    ))
    await db.flush()
    if add:
        await add_movement(db, inv, user_id, "deposit", add, old, "Al renovar")
    if take:
        await add_movement(db, inv, user_id, "withdrawal", take, old, "Al renovar")
    inv.start_date = old
    inv.maturity_date = maturity_date
    if tna is not None:
        inv.tna = tna
    await db.flush()


async def close(db: AsyncSession, inv: Investment, user_id: int | None, amount: Decimal, day: date) -> None:
    """Rescate: lo que entró de verdad. La diferencia con lo puesto es la ganancia real."""
    if inv.closed_at is not None:
        raise HTTPException(status_code=400, detail="Esta inversión ya se rescató.")
    if amount < 0:
        raise HTTPException(status_code=400, detail="El monto no puede ser negativo.")
    if day < inv.start_date:
        raise HTTPException(status_code=400, detail="La fecha es anterior al comienzo de la inversión.")
    if amount > 0:
        db.add(InvestmentMovement(
            tenant_id=inv.tenant_id, investment_id=inv.id, user_id=user_id, kind="withdrawal",
            amount=amount, movement_date=day, note="Rescate",
        ))
    inv.closed_at = day
    await db.flush()
