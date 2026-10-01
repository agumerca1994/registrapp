import io
import re
import csv as _csv
from datetime import date as _date
from decimal import Decimal

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, extract, func, or_
from sqlalchemy.orm import selectinload
from sqlalchemy.orm.attributes import set_committed_value

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.income import (
    IncomeSource, IncomeEntry, IncomeType, IncomeSourceField, IncomeEntryItem,
)
from app.services.search import fold, fold_term
from app.schemas.income import (
    IncomeSourceCreate, IncomeSourceUpdate, IncomeSourceOut, IncomeSourceFieldIn,
    IncomeEntryCreate, IncomeEntryUpdate, IncomeEntryOut, IncomeEntryItemIn,
)

router = APIRouter(prefix="/income", tags=["income"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


async def _assert_owns_source(source_id: int, tenant_id: int, db: AsyncSession) -> None:
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


# ── Campos de detalle ──────────────────────────────────────────────────────────

async def _load_source(source_id: int, tenant_id: int, db: AsyncSession) -> IncomeSource:
    source = await db.scalar(
        select(IncomeSource)
        .where(IncomeSource.id == source_id, IncomeSource.tenant_id == tenant_id)
        .options(selectinload(IncomeSource.fields))
        .execution_options(populate_existing=True)
    )
    if source is None:
        raise HTTPException(status_code=404, detail="Fuente no encontrada")
    return source


async def _fields_with_items(field_ids: list[int], db: AsyncSession) -> set[int]:
    if not field_ids:
        return set()
    rows = await db.scalars(
        select(IncomeEntryItem.field_id)
        .where(IncomeEntryItem.field_id.in_(field_ids))
        .distinct()
    )
    return set(rows.all())


async def _source_out(sources: list[IncomeSource], db: AsyncSession) -> list[IncomeSource]:
    """Prepara las fuentes para `IncomeSourceOut`.

    Deja los campos activos más los archivados que todavía tienen ítems (hacen
    falta para mostrar y editar ingresos viejos; el formulario los ofrece sólo
    a esos ingresos), y marca `has_items` en cada uno.
    """
    used = await _fields_with_items([f.id for s in sources for f in s.fields], db)
    for s in sources:
        for f in s.fields:
            f.has_items = f.id in used
        # set_committed_value: filtrar la colección para la respuesta sin que
        # SQLAlchemy lo tome como "sacar estos campos de la fuente".
        set_committed_value(s, "fields", [f for f in s.fields if f.is_active or f.has_items])
    return sources


async def _sync_fields(
    source: IncomeSource, incoming: list[IncomeSourceFieldIn], db: AsyncSession,
) -> None:
    """Reconcilia la lista completa de campos que manda el formulario.

    Con `id` → renombrar/reordenar (y reactivar si estaba archivado); sin `id` →
    crear; existente que no viene → archivar. **Nunca se borra**: los ingresos
    ya cargados conservan sus montos. El tipo de un campo con ítems no cambia,
    porque reinterpretaría en silencio la cuenta de meses ya cerrados.
    """
    by_id = {f.id: f for f in source.fields}
    used = await _fields_with_items(list(by_id), db)
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


async def _apply_items(
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


async def _ensure_field(source_id: int, name: str, kind: str, db: AsyncSession) -> int:
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


async def _entry_out(entry_id: int, db: AsyncSession) -> IncomeEntry:
    return await db.scalar(
        select(IncomeEntry)
        .where(IncomeEntry.id == entry_id)
        .options(selectinload(IncomeEntry.source), selectinload(IncomeEntry.items))
        .execution_options(populate_existing=True)
    )


# ── Import helpers ─────────────────────────────────────────────────────────────

def _parse_number(val) -> float | None:
    if val is None:
        return None
    s = str(val).strip()
    if not s or s.lower() in ("none", "null", ""):
        return None
    last_dot = s.rfind(".")
    last_comma = s.rfind(",")
    if last_dot > last_comma:
        cleaned = s.replace(",", "")
    elif last_comma > last_dot:
        cleaned = s.replace(".", "").replace(",", ".")
    else:
        cleaned = s
    try:
        return float(cleaned)
    except ValueError:
        return None


def _parse_date(val) -> _date | None:
    if val is None:
        return None
    s = str(val).strip()
    if re.match(r"^\d{2}-\d{4}$", s):
        mm, yyyy = s.split("-")
        return _date(int(yyyy), int(mm), 1)
    if re.match(r"^\d{4}-\d{2}-\d{2}$", s):
        return _date.fromisoformat(s)
    if re.match(r"^\d{2}/\d{2}/\d{4}$", s):
        d, m, y = s.split("/")
        return _date(int(y), int(m), int(d))
    if re.match(r"^\d{4}-\d{2}$", s):
        yyyy, mm = s.split("-")
        return _date(int(yyyy), int(mm), 1)
    if re.match(r"^\d{2}/\d{4}$", s):
        mm, yyyy = s.split("/")
        return _date(int(yyyy), int(mm), 1)
    return None


def _parse_file(content: bytes, filename: str) -> tuple[list[list], list[str]]:
    fname = (filename or "").lower()
    if fname.endswith(".csv"):
        text = content.decode("utf-8", errors="replace")
        reader = _csv.reader(io.StringIO(text))
        all_rows = list(reader)
        if not all_rows:
            return [], []
        columns = [str(c).strip() for c in all_rows[0]]
        data = [list(r) for r in all_rows[1:] if any(c.strip() for c in r)]
        return data, columns
    else:
        import openpyxl
        wb = openpyxl.load_workbook(io.BytesIO(content), read_only=True, data_only=True)
        ws = wb.active
        all_rows = list(ws.iter_rows(values_only=True))
        wb.close()
        if not all_rows:
            return [], []
        columns = [str(c).strip() if c is not None else f"Col{i}" for i, c in enumerate(all_rows[0])]
        data = [list(r) for r in all_rows[1:] if any(v is not None for v in r)]
        return data, columns


# ── Sources ────────────────────────────────────────────────────────────────────

@router.get("/sources", response_model=list[IncomeSourceOut])
async def list_sources(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(IncomeSource)
        .where(
            IncomeSource.tenant_id == user.tenant_id,
            IncomeSource.is_active == True,
        )
        .options(selectinload(IncomeSource.fields))
    )
    return await _source_out(list(result.all()), db)


@router.post("/sources", response_model=IncomeSourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    body: IncomeSourceCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    source = IncomeSource(**body.model_dump(exclude={"fields"}), tenant_id=user.tenant_id)
    db.add(source)
    await db.flush()
    for pos, f in enumerate(body.fields):
        db.add(IncomeSourceField(source_id=source.id, name=f.name, kind=f.kind, position=pos))
    await db.commit()
    source = await _load_source(source.id, user.tenant_id, db)
    return (await _source_out([source], db))[0]


@router.patch("/sources/{source_id}", response_model=IncomeSourceOut)
async def update_source(
    source_id: int,
    body: IncomeSourceUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    source = await _load_source(source_id, user.tenant_id, db)
    if body.name is not None:
        name = body.name.strip()
        if not name:
            raise HTTPException(status_code=422, detail="La fuente necesita un nombre")
        source.name = name
    if body.income_type is not None:
        source.income_type = body.income_type
    if body.fields is not None:
        await _sync_fields(source, body.fields, db)
    await db.commit()
    source = await _load_source(source_id, user.tenant_id, db)
    return (await _source_out([source], db))[0]


# ── Entries ────────────────────────────────────────────────────────────────────

# Amount sorting lists each currency in its own block instead of interleaving
# them: "500" in dollars and "500" in pesos are not neighbours, and the app's
# rule is that amounts in different currencies never get compared.
SORT_COLUMNS = {
    "date": [IncomeEntry.period_date],
    "source": [IncomeSource.name],
    "amount": [IncomeEntry.currency, IncomeEntry.amount],
}


@router.get("/entries", response_model=list[IncomeEntryOut])
async def list_entries(
    year: int | None = None,
    month: int | None = None,
    q: str | None = Query(None, description="Coincidencia parcial en fuente o notas"),
    source_id: int | None = None,
    date_from: _date | None = None,
    date_to: _date | None = None,
    sort: Literal["date", "source", "amount"] = "date",
    order: Literal["asc", "desc"] = "desc",
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """Income entries for a month, or across all of them when searching.

    `year`/`month` and the search filters are meant to be alternatives, not
    combined: the frontend drops the month as soon as any filter is set, since
    a search that only looks inside the month currently on screen isn't a
    search. Nothing here enforces that — passing both just intersects.
    """
    user = await _get_db_user(firebase_user, db)
    stmt = (
        select(IncomeEntry)
        .join(IncomeEntry.source)
        .where(IncomeEntry.tenant_id == user.tenant_id)
        .options(selectinload(IncomeEntry.source), selectinload(IncomeEntry.items))
    )
    if year:
        stmt = stmt.where(extract("year", IncomeEntry.period_date) == year)
    if month:
        stmt = stmt.where(extract("month", IncomeEntry.period_date) == month)
    if source_id:
        stmt = stmt.where(IncomeEntry.source_id == source_id)
    if date_from:
        stmt = stmt.where(IncomeEntry.period_date >= date_from)
    if date_to:
        stmt = stmt.where(IncomeEntry.period_date <= date_to)
    if q and q.strip():
        # One term, matched against both the source name and the free-text
        # notes: "categoría" and "descripción" aren't columns here, and the
        # user means either depending on how they filled the entry in.
        term = fold_term(q)
        stmt = stmt.where(or_(
            fold(IncomeSource.name).like(term),
            fold(func.coalesce(IncomeEntry.notes, "")).like(term),
        ))

    cols = SORT_COLUMNS[sort]
    # `id` breaks ties so paging through equal dates/amounts is stable.
    stmt = stmt.order_by(
        *[c.asc() if order == "asc" else c.desc() for c in cols],
        IncomeEntry.id.desc(),
    )
    result = await db.scalars(stmt)
    return result.all()


@router.post("/entries", response_model=IncomeEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: IncomeEntryCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    await _assert_owns_source(body.source_id, user.tenant_id, db)
    entry = IncomeEntry(
        **body.model_dump(exclude={"items"}), tenant_id=user.tenant_id, user_id=user.id,
    )
    db.add(entry)
    await db.flush()
    await _apply_items(entry, body.items, db)
    await db.commit()
    return await _entry_out(entry.id, db)


@router.patch("/entries/{entry_id}", response_model=IncomeEntryOut)
async def update_entry(
    entry_id: int,
    body: IncomeEntryUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = await db.get(IncomeEntry, entry_id)
    if not entry or entry.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    updates = body.model_dump(exclude_none=True, exclude={"items"})
    source_changed = "source_id" in updates and updates["source_id"] != entry.source_id
    if "source_id" in updates:
        await _assert_owns_source(updates["source_id"], user.tenant_id, db)
    for field, value in updates.items():
        setattr(entry, field, value)
    if body.items is not None:
        await _apply_items(entry, body.items, db)
    elif source_changed:
        # Sin detalle nuevo, el viejo pertenece a la otra fuente: no puede quedar.
        await _apply_items(entry, [], db)
    await db.commit()
    return await _entry_out(entry_id, db)


@router.delete("/entries/{entry_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_entry(
    entry_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = await db.get(IncomeEntry, entry_id)
    if not entry or entry.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Registro no encontrado")
    await db.delete(entry)
    await db.commit()


# ── Bulk import ────────────────────────────────────────────────────────────────

MAX_IMPORT_BYTES = 5 * 1024 * 1024


async def _read_capped(file: UploadFile) -> bytes:
    """Lee el upload con techo, en chunks.

    `await file.read()` a secas se traía el archivo entero a memoria sin límite y
    se lo pasaba a `openpyxl`. No hay tope en ningún lado — uvicorn no impone uno
    y no hay middleware que lo haga — así que un upload grande alcanzaba para
    voltear el contenedor, y un xlsx es un zip: una bomba de descompresión llega
    al mismo resultado desde unos cientos de KB. El backend corre con un solo
    worker, así que se lleva puesta la API de todos los hogares.
    """
    buf = bytearray()
    while chunk := await file.read(64 * 1024):
        buf.extend(chunk)
        if len(buf) > MAX_IMPORT_BYTES:
            raise HTTPException(
                status_code=413,
                detail=f"El archivo supera los {MAX_IMPORT_BYTES // (1024 * 1024)} MB",
            )
    return bytes(buf)


@router.post("/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_db_user(firebase_user, db)
    content = await _read_capped(file)
    data, columns = _parse_file(content, file.filename or "")
    sample = [[str(v) if v is not None else "" for v in row] for row in data[:5]]
    return {"columns": columns, "sample": sample, "row_count": len(data)}


@router.post("/import/run")
async def import_run(
    file: UploadFile = File(...),
    date_col: str = Form(...),
    amount_col: str = Form(...),
    bruto_col: str = Form(None),
    deducciones_col: str = Form(None),
    notes_col: str = Form(None),
    source_id: int = Form(None),
    new_source_name: str = Form(None),
    new_source_type: str = Form("salary"),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)

    # Resolve or create income source
    if source_id:
        source = await db.get(IncomeSource, source_id)
        if not source or source.tenant_id != user.tenant_id:
            raise HTTPException(status_code=404, detail="Fuente no encontrada")
    elif new_source_name:
        source = IncomeSource(
            tenant_id=user.tenant_id,
            name=new_source_name.strip(),
            income_type=IncomeType(new_source_type),
        )
        db.add(source)
        await db.flush()
    else:
        raise HTTPException(status_code=422, detail="Debés elegir o crear una fuente de ingreso")

    content = await _read_capped(file)
    data, columns = _parse_file(content, file.filename or "")

    bruto_field = await _ensure_field(source.id, "Bruto", "add", db) if bruto_col else None
    deducc_field = (
        await _ensure_field(source.id, "Deducciones", "subtract", db) if deducciones_col else None
    )

    imported = 0
    skipped = 0
    errors: list[str] = []

    for i, row in enumerate(data, start=2):
        try:
            row_dict = dict(zip(columns, row))
            period = _parse_date(row_dict.get(date_col))
            amount = _parse_number(row_dict.get(amount_col))
            bruto_v = _parse_number(row_dict.get(bruto_col)) if bruto_col else None
            deducc_v = _parse_number(row_dict.get(deducciones_col)) if deducciones_col else None

            if period is None:
                errors.append(f"Fila {i}: fecha inválida ({row_dict.get(date_col)!r})")
                continue
            if amount is None:
                errors.append(f"Fila {i}: monto inválido ({row_dict.get(amount_col)!r})")
                continue

            amount_dec = Decimal(str(round(amount, 2)))

            # Skip exact duplicates
            existing = await db.scalar(
                select(IncomeEntry).where(
                    IncomeEntry.tenant_id == user.tenant_id,
                    IncomeEntry.source_id == source.id,
                    IncomeEntry.period_date == period,
                    IncomeEntry.amount == amount_dec,
                )
            )
            if existing:
                skipped += 1
                continue

            notes = None
            if notes_col and notes_col in row_dict and row_dict[notes_col] is not None:
                raw = str(row_dict[notes_col]).strip()
                if raw:
                    notes = raw

            entry = IncomeEntry(
                tenant_id=user.tenant_id,
                user_id=user.id,
                source_id=source.id,
                amount=amount_dec,
                period_date=period,
                notes=notes,
            )
            db.add(entry)
            await db.flush()
            items = []
            if bruto_field and bruto_v is not None:
                items.append(IncomeEntryItemIn(field_id=bruto_field, amount=Decimal(str(round(bruto_v, 2)))))
            if deducc_field and deducc_v is not None:
                items.append(IncomeEntryItemIn(field_id=deducc_field, amount=Decimal(str(round(deducc_v, 2)))))
            await _apply_items(entry, items, db)
            imported += 1
        except Exception as exc:
            errors.append(f"Fila {i}: {exc}")

    await db.commit()
    return {"imported": imported, "skipped": skipped, "errors": errors}
