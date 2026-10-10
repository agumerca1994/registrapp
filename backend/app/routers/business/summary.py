from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.access import Actor, get_owner_user
from app.core.database import get_db
from app.services.business import analytics as business_analytics
from app.services.business.analytics import BusinessSummary

router = APIRouter(prefix="/business", tags=["negocio"])


@router.get("/summary/{year}/{month}", response_model=BusinessSummary)
async def business_summary(
    year: int,
    month: int,
    actor: Actor = Depends(get_owner_user),
    db: AsyncSession = Depends(get_db),
):
    """El mes del negocio para Inicio: lo del dashboard que tiene sentido en un
    comercio (ingresos, egresos, resultado, por categoría) más a quién se le
    pagó. Sólo dueño y socios: es exactamente lo que un empleado no ve."""
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="Mes inválido")
    return await business_analytics.business_summary(db, actor.user.tenant_id, year, month)
