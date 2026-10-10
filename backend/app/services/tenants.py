"""El tenant como cuenta: hogar o negocio, y qué hace falta para ser cada uno.

Vive acá y no en `routers/auth.py` porque lo usan el alta, la conversión del
piloto por `/internal` y los módulos del negocio. `routers/auth.py` re-exporta
`_tenant_has_data` / `_TENANT_DATA_MODELS` con sus nombres viejos.

Nada de esto hace commit: decide el que llama.
"""
from __future__ import annotations

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.business import Payee, Product, Sale, StockMovement
from app.models.credit_card import CreditCard
from app.models.currency_operation import CurrencyOperation
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.models.payment_reminder import PaymentReminder
from app.models.shared_expense import SharedExpense
from app.models.tenant import TENANT_KIND_BUSINESS, TENANT_KINDS, Tenant
from app.services.search import fold_text

# Lo que se perdería abandonando un tenant. No es exhaustivo a propósito: las
# categorías y las fuentes se crean solas, y harían parecer ocupado a un hogar
# que nadie tocó.
TENANT_DATA_MODELS = (
    IncomeEntry, ExpenseEntry, CurrencyOperation, CreditCard, MortgageRecord,
    SharedExpense, PaymentReminder,
)

# Lo que sólo existe en un hogar. Un negocio no tiene esas pantallas, así que
# convertir un tenant que lo tiene lo escondería sin borrarlo. Gastos, tarjetas
# y recordatorios no están: un negocio los usa igual.
HOUSEHOLD_ONLY_DATA = (
    ("ingresos", IncomeEntry),
    ("divisas", CurrencyOperation),
    ("hipoteca", MortgageLoan),
    ("hipoteca", MortgageRecord),
    ("gastos compartidos", SharedExpense),
)

# Lo mismo al revés. Cada módulo del negocio suma acá sus tablas.
BUSINESS_ONLY_DATA = (
    ("proveedores y empleados", Payee),
    ("productos", Product),
    ("ventas", Sale),
    ("stock", StockMovement),
)

# (nombre, color, fijo). Sustantivos cortos, como el resto de las etiquetas:
# la pantalla ya dice que son gastos del negocio.
BUSINESS_CATEGORIES = (
    ("Mercadería", "#3b82f6", False),
    ("Materia prima", "#f97316", False),
    ("Descartables", "#14b8a6", False),
    ("Sueldos", "#8b5cf6", True),
    ("Alquiler", "#ef4444", True),
    ("Servicios", "#eab308", True),
    ("Impuestos", "#64748b", True),
    ("Mantenimiento", "#06b6d4", False),
    ("Comisiones", "#ec4899", False),
    ("Otros", "#94a3b8", False),
)


async def tenant_has_data(db: AsyncSession, tenant_id: int) -> bool:
    """Si abandonar este tenant dejaría tirado algo que el usuario cargó."""
    for model in TENANT_DATA_MODELS:
        found = await db.scalar(
            select(model.id).where(model.tenant_id == tenant_id).limit(1)
        )
        if found is not None:
            return True
    return False


async def _present(db: AsyncSession, tenant_id: int, labelled_models) -> list[str]:
    found: list[str] = []
    for label, model in labelled_models:
        if label in found:
            continue
        hit = await db.scalar(select(model.id).where(model.tenant_id == tenant_id).limit(1))
        if hit is not None:
            found.append(label)
    return found


async def household_only_data(db: AsyncSession, tenant_id: int) -> list[str]:
    """Qué datos de hogar tiene este tenant, con nombres para un mensaje."""
    return await _present(db, tenant_id, HOUSEHOLD_ONLY_DATA)


async def business_only_data(db: AsyncSession, tenant_id: int) -> list[str]:
    return await _present(db, tenant_id, BUSINESS_ONLY_DATA)


async def seed_business_categories(db: AsyncSession, tenant_id: int) -> int:
    """Las categorías de gasto de un negocio. Idempotente por nombre plegado:
    no duplica una que el usuario ya creó escrita distinto ("mercaderia")."""
    existing = {
        fold_text(name)
        for name in (await db.scalars(
            select(ExpenseCategory.name).where(ExpenseCategory.tenant_id == tenant_id)
        )).all()
    }
    added = 0
    for name, color, fixed in BUSINESS_CATEGORIES:
        if fold_text(name) in existing:
            continue
        db.add(ExpenseCategory(tenant_id=tenant_id, name=name, color=color, is_fixed=fixed))
        added += 1
    await db.flush()
    return added


async def set_kind(db: AsyncSession, tenant: Tenant, kind: str) -> int:
    """Convierte un tenant de hogar a negocio o al revés. **Sólo flush.**

    Rechaza la conversión si el tenant tiene datos que el otro tipo no muestra:
    convertirlo los escondería sin borrarlos, y nada en pantalla diría que
    siguen ahí. Devuelve cuántas categorías de negocio sembró.
    """
    if kind not in TENANT_KINDS:
        raise HTTPException(status_code=422, detail=f"kind debe ser uno de {TENANT_KINDS}")
    blocking = (
        await household_only_data(db, tenant.id)
        if kind == TENANT_KIND_BUSINESS
        else await business_only_data(db, tenant.id)
    )
    if blocking and kind != tenant.kind:
        raise HTTPException(
            status_code=409,
            detail=f"El tenant tiene datos que dejarían de verse ({', '.join(blocking)}).",
        )
    tenant.kind = kind
    seeded = await seed_business_categories(db, tenant.id) if kind == TENANT_KIND_BUSINESS else 0
    await db.flush()
    return seeded
