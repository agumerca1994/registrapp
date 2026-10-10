"""Escritura de ingresos compartida por el router y el conector MCP.

Vive acá y no en `routers/income.py` para que cargar un ingreso desde la app y
desde una IA pase por exactamente el mismo código: mismas validaciones de
pertenencia, mismo archivado de campos, mismo bruto/deducciones derivado. Una
copia en el conector es cómo empiezan a divergir.

Nada de esto hace commit: el que llama decide (el router confirma, el conector
puede hacer rollback para una vista previa). Los errores son `HTTPException`
porque el router es el llamador principal; el conector los traduce.
"""
from decimal import Decimal

from fastapi import HTTPException
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.models.income import IncomeSource, IncomeEntry, IncomeSourceField, IncomeEntryItem
from app.schemas.income import IncomeSourceFieldIn, IncomeEntryItemIn


async def assert_owns_source(source_id: int, tenant_id: int, db: AsyncSession) -> None:
    """La fuente tiene que ser del hogar que la está usando.

    Mismo agujero que con `category_id` en expenses.py: `income_sources.id` es
    global y `IncomeEntryOut` trae la fuente embebida (nombre, tipo, descripción),
    así que un id ajeno se leía de vuelta en la respuesta.
    """
    owned = await db.scalar(
        select(IncomeSource.id).where(
            IncomeSource.id == source_id,
            IncomeSource.tenant_id == tenant_id,
        )
    )
    if owned is None:
        raise HTTPException(status_code=404, detail="Fuente no encontrada")


SALES_SYSTEM_KEY = "sales"
_SYSTEM_SOURCE_DETAIL = (
    "Los ingresos de «Ventas» se arman solos con las ventas de cada día: "
    "se corrigen desde Ventas, no a mano."
)


async def assert_writable_source(source_id: int, db: AsyncSession) -> None:
    """Una fuente que arma el sistema (`system_key`) no acepta ingresos ni
    cambios a mano. Hoy es la de Ventas de un negocio: su ingreso de cada día
    se recalcula desde las ventas (services/business/sales.py), y uno editado
    a mano se pisaría en la próxima venta o descuadraría contra ellas."""
    key = await db.scalar(select(IncomeSource.system_key).where(IncomeSource.id == source_id))
    if key:
        raise HTTPException(status_code=409, detail=_SYSTEM_SOURCE_DETAIL)


async def assert_entry_writable(entry: IncomeEntry, db: AsyncSession) -> None:
    await assert_writable_source(entry.source_id, db)


# ── Campos de detalle ──────────────────────────────────────────────────────────

async def load_source(source_id: int, tenant_id: int, db: AsyncSession) -> IncomeSource:
    source = await db.scalar(
        select(IncomeSource)
        .where(IncomeSource.id == source_id, IncomeSource.tenant_id == tenant_id)
        .options(selectinload(IncomeSource.fields))
        .execution_options(populate_existing=True)
    )
    if source is None:
        raise HTTPException(status_code=404, detail="Fuente no encontrada")
    return source


async def fields_with_items(field_ids: list[int], db: AsyncSession) -> set[int]:
    if not field_ids:
        return set()
    rows = await db.scalars(
        select(IncomeEntryItem.field_id)
        .where(IncomeEntryItem.field_id.in_(field_ids))
        .distinct()
    )
    return set(rows.all())


async def source_out(sources: list[IncomeSource], db: AsyncSession) -> list[IncomeSource]:
    """Prepara las fuentes para `IncomeSourceOut`.

    Deja los campos activos más los archivados que todavía tienen ítems (hacen
    falta para mostrar y editar ingresos viejos; el formulario los ofrece sólo
    a esos ingresos), y marca `has_items` en cada uno.
    """
    used = await fields_with_items([f.id for s in sources for f in s.fields], db)
    for s in sources:
        for f in s.fields:
            f.has_items = f.id in used
        # set_committed_value: filtrar la colección para la respuesta sin que
        # SQLAlchemy lo tome como "sacar estos campos de la fuente".
        set_committed_value(s, "fields", [f for f in s.fields if f.is_active or f.has_items])
    return sources


async def sync_fields(
    source: IncomeSource, incoming: list[IncomeSourceFieldIn], db: AsyncSession,
) -> None:
    """Reconcilia la lista completa de campos que manda el formulario.

    Con `id` → renombrar/reordenar (y reactivar si estaba archivado); sin `id` →
    crear; existente que no viene → archivar. **Nunca se borra**: los ingresos
    ya cargados conservan sus montos. El tipo de un campo con ítems no cambia,
    porque reinterpretaría en silencio la cuenta de meses ya cerrados.
    """
    by_id = {f.id: f for f in source.fields}
    used = await fields_with_items(list(by_id), db)
    seen: set[int] = set()
    for pos, f_in in enumerate(incoming):
        if f_in.id is not None:
            field = by_id.get(f_in.id)
            if field is None:
                raise HTTPException(status_code=400, detail="Campo inexistente en esta fuente")
            if field.kind != f_in.kind and field.id in used:
                raise HTTPException(
                    status_code=400,
                    detail=f"«{field.name}» ya tiene montos cargados: su tipo no se puede cambiar",
                )
            field.name = f_in.name
            field.kind = f_in.kind
            field.position = pos
            field.is_active = True
            seen.add(field.id)
        else:
            db.add(IncomeSourceField(
                source_id=source.id, name=f_in.name, kind=f_in.kind, position=pos,
            ))
    for fid, field in by_id.items():
        if fid not in seen:
            field.is_active = False


async def apply_items(
    entry: IncomeEntry, items: list[IncomeEntryItemIn], db: AsyncSession,
) -> None:
    """Reemplaza el detalle de un ingreso y deriva `bruto`/`deducciones`.

    Cada campo tiene que ser de la fuente del ingreso — cubre también el caso de
    cambiarle la fuente a un ingreso que ya tenía detalle. Se aceptan campos
    archivados: editar un ingreso viejo no puede obligar a perder sus montos.

    `bruto = Σ add` y `deducciones = Σ subtract` se siguen escribiendo para que
    `analytics.income_aggregate` y el conector MCP no tengan que saber de campos.
    """
    field_ids = [i.field_id for i in items]
    if len(set(field_ids)) != len(field_ids):
        raise HTTPException(status_code=400, detail="Un campo aparece dos veces en el detalle")
    fields: dict[int, IncomeSourceField] = {}
    if field_ids:
        rows = await db.scalars(
            select(IncomeSourceField).where(
                IncomeSourceField.id.in_(field_ids),
                IncomeSourceField.source_id == entry.source_id,
            )
        )
        fields = {f.id: f for f in rows.all()}
        if len(fields) != len(field_ids):
            raise HTTPException(
                status_code=400, detail="El detalle tiene campos que no son de esta fuente",
            )

    await db.execute(
        IncomeEntryItem.__table__.delete().where(IncomeEntryItem.entry_id == entry.id)
    )
    add = sub = Decimal("0")
    has_add = has_sub = False
    for i in items:
        db.add(IncomeEntryItem(entry_id=entry.id, field_id=i.field_id, amount=i.amount))
        kind = fields[i.field_id].kind
        if kind == "add":
            add += i.amount
            has_add = True
        elif kind == "subtract":
            sub += i.amount
            has_sub = True
    entry.bruto = add if has_add else None
    entry.deducciones = sub if has_sub else None


async def ensure_field(source_id: int, name: str, kind: str, db: AsyncSession) -> int:
    """El campo `name` de la fuente, creándolo (o reactivándolo) si hace falta.

    Lo usa el import: sus columnas de bruto y deducciones tienen que caer en el
    mismo modelo de detalle que la carga a mano, no en columnas sueltas.
    """
    field = await db.scalar(
        select(IncomeSourceField).where(
            IncomeSourceField.source_id == source_id,
            IncomeSourceField.name == name,
            IncomeSourceField.kind == kind,
        )
    )
    if field is None:
        last = await db.scalar(
            select(func.max(IncomeSourceField.position))
            .where(IncomeSourceField.source_id == source_id)
        )
        field = IncomeSourceField(
            source_id=source_id, name=name, kind=kind,
            position=(last + 1) if last is not None else 0,
        )
        db.add(field)
        await db.flush()
    else:
        field.is_active = True
    return field.id


async def entry_out(entry_id: int, db: AsyncSession) -> IncomeEntry:
    return await db.scalar(
        select(IncomeEntry)
        .where(IncomeEntry.id == entry_id)
        .options(selectinload(IncomeEntry.source), selectinload(IncomeEntry.items))
        .execution_options(populate_existing=True)
    )
