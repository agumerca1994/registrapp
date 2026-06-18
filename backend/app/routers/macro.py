import asyncio
import logging
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert
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
    """Pick best value for target date: exact → same month (on or before) → last before."""
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


def _pick_indec(rows: list, target: str) -> float | None:
    """Pick the most recent value up to target date from INDEC series [[date, val], ...]."""
    if not rows:
        return None
    candidates = [(r[0], r[1]) for r in rows if isinstance(r, list) and len(r) == 2 and r[0] <= target]
    return candidates[-1][1] if candidates else None


async def _fetch_all_apis(timeout: int = 60):
    async with httpx.AsyncClient(timeout=timeout) as client:
        return await asyncio.gather(
            client.get(f"{ARGENTINADATOS}/finanzas/indices/uva"),
            client.get(f"{ARGENTINADATOS}/finanzas/indices/inflacion"),
            client.get(f"{ARGENTINADATOS}/finanzas/indices/inflacionInteranual"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/oficial"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/blue"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/mayorista"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/bolsa"),
            client.get(f"{ARGENTINADATOS}/cotizaciones/dolares/contadoconliqui"),
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


def _dec(v) -> Decimal | None:
    return Decimal(str(v)) if v is not None else None


async def sync_macro_for_date(target: str) -> MacroVariable | None:
    """Fetch all macro variables for `target` (YYYY-MM-DD) and upsert into DB."""
    results = await _fetch_all_apis(timeout=20)
    uva_r, inf_m_r, inf_ia_r, usd_off_r, usd_blue_r, usd_may_r, usd_mep_r, usd_ccl_r, ripte_r, smvm_r, canasta_r = results

    def ad(resp, key): return _pick_ad(_safe_list(resp), "fecha", key, target)

    row = dict(
        period_date=date.fromisoformat(target),
        source="auto",
        uva_value=_dec(ad(uva_r, "valor")),
        inflation_monthly_pct=_dec(ad(inf_m_r, "valor")),
        inflation_interanual_pct=_dec(ad(inf_ia_r, "valor")),
        usd_official=_dec(ad(usd_off_r, "venta")),
        usd_blue=_dec(ad(usd_blue_r, "venta")),
        usd_mayorista=_dec(ad(usd_may_r, "venta")),
        usd_mep=_dec(ad(usd_mep_r, "venta")),
        usd_ccl=_dec(ad(usd_ccl_r, "venta")),
        ripte=_dec(_pick_indec(_safe_indec(ripte_r), target)),
        smvm=_dec(_pick_indec(_safe_indec(smvm_r), target)),
        canasta_basica_total=_dec(_pick_indec(_safe_indec(canasta_r), target)),
    )

    async with AsyncSessionLocal() as db:
        stmt = pg_insert(MacroVariable).values([row])
        stmt = stmt.on_conflict_do_update(
            constraint="uq_macro_period_date",
            set_={k: stmt.excluded[k] for k in row if k != "period_date"},
        )
        await db.execute(stmt)
        await db.commit()


async def backfill_macro_history(from_year: int = 2020, from_month: int = 1) -> int:
    """Lazy backfill: only fetch APIs and insert dates that are missing from the DB."""
    start = date(from_year, from_month, 1)
    today = date.today()

    # Build the full set of calendar days requested
    all_days: list[date] = []
    current = start
    while current <= today:
        all_days.append(current)
        current += timedelta(days=1)

    # Find which days we already have — no API calls if nothing is missing
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(MacroVariable.period_date).where(
                MacroVariable.period_date >= start,
                MacroVariable.period_date <= today,
            )
        )
        existing = {row[0] for row in result.all()}

    missing = [d for d in all_days if d not in existing]

    if not missing:
        logger.info(f"Backfill: all {len(all_days)} days already present, nothing to do")
        return 0

    logger.info(f"Backfill: fetching APIs for {len(missing)} missing days (have {len(existing)}/{len(all_days)})")
    results = await _fetch_all_apis(timeout=60)
    uva_r, inf_m_r, inf_ia_r, usd_off_r, usd_blue_r, usd_may_r, usd_mep_r, usd_ccl_r, ripte_r, smvm_r, canasta_r = results

    uva_data = _safe_list(uva_r)
    inf_m_data = _safe_list(inf_m_r)
    inf_ia_data = _safe_list(inf_ia_r)
    usd_off_data = _safe_list(usd_off_r)
    usd_blue_data = _safe_list(usd_blue_r)
    usd_may_data = _safe_list(usd_may_r)
    usd_mep_data = _safe_list(usd_mep_r)
    usd_ccl_data = _safe_list(usd_ccl_r)
    ripte_data = _safe_indec(ripte_r)
    smvm_data = _safe_indec(smvm_r)
    canasta_data = _safe_indec(canasta_r)

    rows = []
    for d in missing:
        t = d.isoformat()
        rows.append(dict(
            period_date=d,
            source="auto",
            uva_value=_dec(_pick_ad(uva_data, "fecha", "valor", t)),
            inflation_monthly_pct=_dec(_pick_ad(inf_m_data, "fecha", "valor", t)),
            inflation_interanual_pct=_dec(_pick_ad(inf_ia_data, "fecha", "valor", t)),
            usd_official=_dec(_pick_ad(usd_off_data, "fecha", "venta", t)),
            usd_blue=_dec(_pick_ad(usd_blue_data, "fecha", "venta", t)),
            usd_mayorista=_dec(_pick_ad(usd_may_data, "fecha", "venta", t)),
            usd_mep=_dec(_pick_ad(usd_mep_data, "fecha", "venta", t)),
            usd_ccl=_dec(_pick_ad(usd_ccl_data, "fecha", "venta", t)),
            ripte=_dec(_pick_indec(ripte_data, t)),
            smvm=_dec(_pick_indec(smvm_data, t)),
            canasta_basica_total=_dec(_pick_indec(canasta_data, t)),
        ))

    async with AsyncSessionLocal() as db:
        stmt = pg_insert(MacroVariable).values(rows)
        stmt = stmt.on_conflict_do_update(
            constraint="uq_macro_period_date",
            set_={k: stmt.excluded[k] for k in rows[0] if k != "period_date"},
        )
        await db.execute(stmt)
        await db.commit()

    logger.info(f"Backfill complete: inserted {len(rows)} new days")
    return len(rows)


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[MacroVariableOut])
async def list_macro(
    from_date: str | None = Query(default=None, description="YYYY-MM-DD"),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    q = select(MacroVariable).order_by(MacroVariable.period_date.desc())
    if from_date:
        q = q.where(MacroVariable.period_date >= date.fromisoformat(from_date))
    result = await db.scalars(q)
    return result.all()


@router.post("/backfill")
async def trigger_backfill(
    from_year: int = Query(default=2020, ge=2010, le=2030),
    from_month: int = Query(default=1, ge=1, le=12),
    firebase_user: dict = Depends(get_current_user),
):
    """Bulk-upsert daily records from from_year/from_month to today."""
    count = await backfill_macro_history(from_year, from_month)
    return {"status": "ok", "records": count}


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
