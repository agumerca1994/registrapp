from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
import httpx

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.core.config import settings
from app.models.user import User
from app.models.macro_variable import MacroVariable
from app.schemas.macro_variable import MacroVariableUpsert, MacroVariableOut

router = APIRouter(prefix="/macro", tags=["macro"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


@router.get("", response_model=list[MacroVariableOut])
async def list_macro(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(MacroVariable)
        .where(MacroVariable.tenant_id == user.tenant_id)
        .order_by(MacroVariable.period_date.desc())
    )
    return result.all()


@router.delete("/{record_id}", status_code=204)
async def delete_macro(
    record_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    record = await db.get(MacroVariable, record_id)
    if not record or record.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    await db.delete(record)
    await db.commit()


@router.put("", response_model=MacroVariableOut)
async def upsert_macro(
    body: MacroVariableUpsert,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    existing = await db.scalar(
        select(MacroVariable).where(
            MacroVariable.tenant_id == user.tenant_id,
            MacroVariable.period_date == body.period_date,
        )
    )
    if existing:
        for field, value in body.model_dump(exclude={"period_date"}).items():
            if value is not None:
                setattr(existing, field, value)
        await db.commit()
        await db.refresh(existing)
        return existing

    macro = MacroVariable(**body.model_dump(), tenant_id=user.tenant_id)
    db.add(macro)
    await db.commit()
    await db.refresh(macro)
    return macro


@router.post("/sync-bcra", response_model=MacroVariableOut)
async def sync_from_bcra(
    period_date: str,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Llama a estadisticasbcra.com y actualiza las variables del mes indicado."""
    user = await _get_db_user(firebase_user, db)

    month_prefix = period_date[:7]  # "YYYY-MM"

    def pick(data: list, date_key: str, val_key: str) -> float | None:
        if not data:
            return None
        # Exact date match
        exact = [e for e in data if e[date_key] == period_date]
        if exact:
            return exact[-1][val_key]
        # Last entry in the same month that doesn't exceed the requested date
        up_to_date = [e for e in data if e[date_key].startswith(month_prefix) and e[date_key] <= period_date]
        if up_to_date:
            return up_to_date[-1][val_key]
        # Fallback: last entry before the requested date
        before = [e for e in data if e[date_key] < period_date]
        return before[-1][val_key] if before else None

    async with httpx.AsyncClient() as client:
        uva_resp = await client.get("https://api.argentinadatos.com/v1/finanzas/indices/uva")
        inf_resp = await client.get("https://api.argentinadatos.com/v1/finanzas/indices/inflacion")
        usd_resp = await client.get("https://api.argentinadatos.com/v1/cotizaciones/dolares/oficial")

    uva_val = pick(uva_resp.json(), "fecha", "valor") if uva_resp.status_code == 200 else None
    inf_val = pick(inf_resp.json(), "fecha", "valor") if inf_resp.status_code == 200 else None
    usd_val = pick(usd_resp.json(), "fecha", "venta") if usd_resp.status_code == 200 else None

    body = MacroVariableUpsert(
        period_date=period_date,
        uva_value=uva_val,
        inflation_monthly_pct=inf_val,
        usd_official=usd_val,
        source="bcra_api",
    )
    return await upsert_macro(body, firebase_user, db)
