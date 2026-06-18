import asyncio
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
import httpx

from app.core.database import get_db, AsyncSessionLocal
from app.core.firebase import get_current_user
from app.models.macro_variable import MacroVariable
from app.schemas.macro_variable import MacroVariableOut

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/macro", tags=["macro"])

ARGENTINADATOS = "https://api.argentinadatos.com/v1"
INDEC_SERIES = "https://apis.datos.gob.ar/series/api/series"


def _pick_ad(data: list, date_key: str, val_key: str, target: str) -> float | None:
    """Pick the best value from argentinadatos.com list for a target date."""
    if not data:
        return None
    month = target[:7]
    exact = [e[val_key] for e in data if e[date_key] == target]
    if exact:
        return exact[-1]
    same_month = [e[val_key] for e in data if e[date_key].startswith(month) and e[date_key] <= target]
    if same_month:
        return same_month[-1]
    before = [e[val_key] for e in data if e[date_key] < target]
    return before[-1] if before else None


def _pick_ad_month(data: list, date_key: str, val_key: str, year: int, month: int) -> float | None:
    """Pick the last available value for a given year-month (any day in the month)."""
    prefix = f"{year}-{month:02d}"
    in_month = [e[val_key] for e in data if e[date_key].startswith(prefix)]
    if in_month:
        return in_month[-1]
    # Fallback: last value before this month
    before = [e[val_key] for e in data if e[date_key] < prefix]
    return before[-1] if before else None


def _pick_indec(rows: list, target: str) -> float | None:
    """Pick the most recent value up to target date from INDEC series [[date, val], ...]."""
    if not rows:
        return None
    candidates = [(r[0], r[1]) for r in rows if isinstance(r, list) and len(r) == 2 and r[0] <= target]
    return candidates[-1][1] if candidates else None


def _pick_indec_month(rows: list, year: int, month: int) -> float | None:
    """Pick any value in the given year-month, with fallback to last available before it."""
    prefix = f"{year}-{month:02d}"
    in_month = [r[1] for r in rows if isinstance(r, list) and r[0].startswith(prefix)]
    if in_month:
        return in_month[-1]
    before = [r[1] for r in rows if isinstance(r, list) and r[0] < prefix]
    return before[-1] if before else None


async def _fetch_all_apis(timeout: int = 60):
    """Fetch all 9 APIs in parallel and return raw responses."""
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await asyncio.gather(
            client.get(f"{ARGENTINADATOS}/finanzas/indices/uva"),
            client.get(f"{ARGENTINADATOS}/finanzas/indices/inflacion"),
            client.get(f"{ARGENTINADATOS}/finanzas/indices/inflacionInteranual"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/oficial"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/blue"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/mayorista"),
            client.get(f"{INDEC_SERIES}/?ids=158.1_REPTE_0_0_5&format=json&sort=asc"),
            client.get(f"{INDEC_SERIES}/?ids=57.1_SMVMM_0_M_34&format=json&sort=asc"),
            client.get(f"{INDEC_SERIES}/?ids=444.1_CANASTA_BATAL_0_0_20_94&format=json&sort=asc"),
            return_exceptions=True,
        )


def _safe_list(resp) -> list:
    if isinstance(resp, Exception) or resp.status_code != 200:
        return []
    return resp.json() or []


def _safe_indec(resp) -> list:
    if isinstance(resp, Exception) or resp.status_code != 200:
        return []
    return resp.json().get("data", []) or []


async def sync_macro_for_date(target: str) -> MacroVariable | None:
    """Fetch all macro variables for `target` (YYYY-MM-DD) and upsert into DB."""
    results = await _fetch_all_apis(timeout=20)
    uva_r, inf_m_r, inf_ia_r, usd_off_r, usd_blue_r, usd_may_r, ripte_r, smvm_r, canasta_r = results

    def ad(resp, key): return _pick_ad(_safe_list(resp), "fecha", key, target)

    values = dict(
        uva_value=ad(uva_r, "valor"),
        inflation_monthly_pct=ad(inf_m_r, "valor"),
        inflation_interanual_pct=ad(inf_ia_r, "valor"),
        usd_official=ad(usd_off_r, "venta"),
        usd_blue=ad(usd_blue_r, "venta"),
        usd_mayorista=ad(usd_may_r, "venta"),
        ripte=_pick_indec(_safe_indec(ripte_r), target),
        smvm=_pick_indec(_safe_indec(smvm_r), target),
        canasta_basica_total=_pick_indec(_safe_indec(canasta_r), target),
    )

    async with AsyncSessionLocal() as db:
        existing = await db.scalar(select(MacroVariable).where(MacroVariable.period_date == target))
        if existing:
            for field, value in values.items():
                if value is not None:
                    setattr(existing, field, value)
            existing.source = "auto"
        else:
            existing = MacroVariable(period_date=target, source="auto", **values)
            db.add(existing)
        await db.commit()
        await db.refresh(existing)
        return existing


async def backfill_macro_history(from_year: int = 2020) -> int:
    """Fetch all historical data in 9 API calls and upsert monthly records."""
    logger.info(f"Starting macro backfill from {from_year}")
    results = await _fetch_all_apis(timeout=60)
    uva_r, inf_m_r, inf_ia_r, usd_off_r, usd_blue_r, usd_may_r, ripte_r, smvm_r, canasta_r = results

    uva_data = _safe_list(uva_r)
    inf_m_data = _safe_list(inf_m_r)
    inf_ia_data = _safe_list(inf_ia_r)
    usd_off_data = _safe_list(usd_off_r)
    usd_blue_data = _safe_list(usd_blue_r)
    usd_may_data = _safe_list(usd_may_r)
    ripte_data = _safe_indec(ripte_r)
    smvm_data = _safe_indec(smvm_r)
    canasta_data = _safe_indec(canasta_r)

    today = date.today()
    months = []
    y, m = from_year, 1
    while (y, m) <= (today.year, today.month):
        months.append((y, m))
        m += 1
        if m > 12:
            m, y = 1, y + 1

    count = 0
    async with AsyncSessionLocal() as db:
        for y, m in months:
            target = f"{y}-{m:02d}-01"

            def adm(data, key): return _pick_ad_month(data, "fecha", key, y, m)

            values = dict(
                uva_value=adm(uva_data, "valor"),
                inflation_monthly_pct=adm(inf_m_data, "valor"),
                inflation_interanual_pct=adm(inf_ia_data, "valor"),
                usd_official=adm(usd_off_data, "venta"),
                usd_blue=adm(usd_blue_data, "venta"),
                usd_mayorista=adm(usd_may_data, "venta"),
                ripte=_pick_indec_month(ripte_data, y, m),
                smvm=_pick_indec_month(smvm_data, y, m),
                canasta_basica_total=_pick_indec_month(canasta_data, y, m),
            )

            existing = await db.scalar(select(MacroVariable).where(MacroVariable.period_date == target))
            if existing:
                for field, value in values.items():
                    if value is not None:
                        setattr(existing, field, value)
                existing.source = "auto"
            else:
                existing = MacroVariable(period_date=target, source="auto", **values)
                db.add(existing)
            count += 1

        await db.commit()

    logger.info(f"Backfill complete: {count} months processed")
    return count


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[MacroVariableOut])
async def list_macro(
    from_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(MacroVariable).order_by(MacroVariable.period_date.desc())
    if from_date:
        q = q.where(MacroVariable.period_date >= from_date)
    result = await db.scalars(q)
    return result.all()


@router.post("/backfill", status_code=202)
async def trigger_backfill(
    from_year: int = Query(default=2020, ge=2010, le=2030),
    firebase_user: dict = Depends(get_current_user),
):
    """Trigger historical backfill (runs in background)."""
    asyncio.create_task(backfill_macro_history(from_year))
    return {"status": "backfill iniciado", "from_year": from_year}


@router.delete("/{record_id}", status_code=204)
async def delete_macro(
    record_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    record = await db.get(MacroVariable, record_id)
    if not record:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    await db.delete(record)
    await db.commit()
