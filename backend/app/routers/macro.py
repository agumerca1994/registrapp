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

    if not settings.ESTADISTICAS_BCRA_TOKEN:
        raise HTTPException(status_code=503, detail="Token BCRA no configurado")

    headers = {"Authorization": f"BEARER {settings.ESTADISTICAS_BCRA_TOKEN}"}
    async with httpx.AsyncClient() as client:
        uva_resp = await client.get("https://api.estadisticasbcra.com/uva", headers=headers)
        inf_resp = await client.get("https://api.estadisticasbcra.com/inflacion_mensual_oficial", headers=headers)
        usd_resp = await client.get("https://api.estadisticasbcra.com/usd_of_minorista", headers=headers)

    def last_value(data: list) -> float | None:
        return data[-1]["v"] if data else None

    uva_val = last_value(uva_resp.json()) if uva_resp.status_code == 200 else None
    inf_val = last_value(inf_resp.json()) if inf_resp.status_code == 200 else None
    usd_val = last_value(usd_resp.json()) if usd_resp.status_code == 200 else None

    body = MacroVariableUpsert(
        period_date=period_date,
        uva_value=uva_val,
        inflation_monthly_pct=inf_val,
        usd_official=usd_val,
        source="bcra_api",
    )
    return await upsert_macro(body, firebase_user, db)
