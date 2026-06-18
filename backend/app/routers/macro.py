import asyncio
import logging
from datetime import date

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
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


def _pick_indec(rows: list, target: str) -> float | None:
    """Pick the most recent value up to target date from INDEC series [[date, val], ...]."""
    if not rows:
        return None
    candidates = [(r[0], r[1]) for r in rows if isinstance(r, list) and len(r) == 2 and r[0] <= target]
    return candidates[-1][1] if candidates else None


async def sync_macro_for_date(target: str) -> MacroVariable | None:
    """Fetch all macro variables for `target` (YYYY-MM-DD) and upsert into DB."""
    async with httpx.AsyncClient(timeout=20) as client:
        results = await asyncio.gather(
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

    def ad_val(resp, val_key: str) -> float | None:
        if isinstance(resp, Exception) or resp.status_code != 200:
            return None
        return _pick_ad(resp.json(), "fecha", val_key, target)

    def indec_val(resp) -> float | None:
        if isinstance(resp, Exception) or resp.status_code != 200:
            return None
        return _pick_indec(resp.json().get("data", []), target)

    uva_r, inf_m_r, inf_ia_r, usd_off_r, usd_blue_r, usd_may_r, ripte_r, smvm_r, canasta_r = results

    values = dict(
        uva_value=ad_val(uva_r, "valor"),
        inflation_monthly_pct=ad_val(inf_m_r, "valor"),
        inflation_interanual_pct=ad_val(inf_ia_r, "valor"),
        usd_official=ad_val(usd_off_r, "venta"),
        usd_blue=ad_val(usd_blue_r, "venta"),
        usd_mayorista=ad_val(usd_may_r, "venta"),
        ripte=indec_val(ripte_r),
        smvm=indec_val(smvm_r),
        canasta_basica_total=indec_val(canasta_r),
    )

    async with AsyncSessionLocal() as db:
        existing = await db.scalar(
            select(MacroVariable).where(MacroVariable.period_date == target)
        )
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


# ── Endpoints ──────────────────────────────────────────────────────────────────

@router.get("", response_model=list[MacroVariableOut])
async def list_macro(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.scalars(
        select(MacroVariable).order_by(MacroVariable.period_date.desc())
    )
    return result.all()


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
