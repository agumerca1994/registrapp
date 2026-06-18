import io
import re
import csv as _csv
from datetime import date as _date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, status, File, UploadFile, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.income import IncomeSource, IncomeEntry, IncomeType
from app.schemas.income import (
    IncomeSourceCreate, IncomeSourceOut,
    IncomeEntryCreate, IncomeEntryUpdate, IncomeEntryOut,
)

router = APIRouter(prefix="/income", tags=["income"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


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
        select(IncomeSource).where(
            IncomeSource.tenant_id == user.tenant_id,
            IncomeSource.is_active == True,
        )
    )
    return result.all()


@router.post("/sources", response_model=IncomeSourceOut, status_code=status.HTTP_201_CREATED)
async def create_source(
    body: IncomeSourceCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    source = IncomeSource(**body.model_dump(), tenant_id=user.tenant_id)
    db.add(source)
    await db.commit()
    await db.refresh(source)
    return source


# ── Entries ────────────────────────────────────────────────────────────────────

@router.get("/entries", response_model=list[IncomeEntryOut])
async def list_entries(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(IncomeEntry)
        .where(IncomeEntry.tenant_id == user.tenant_id)
        .options(selectinload(IncomeEntry.source))
        .order_by(IncomeEntry.period_date.desc())
    )
    return result.all()


@router.post("/entries", response_model=IncomeEntryOut, status_code=status.HTTP_201_CREATED)
async def create_entry(
    body: IncomeEntryCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    entry = IncomeEntry(**body.model_dump(), tenant_id=user.tenant_id, user_id=user.id)
    db.add(entry)
    await db.commit()
    result = await db.scalar(
        select(IncomeEntry)
        .where(IncomeEntry.id == entry.id)
        .options(selectinload(IncomeEntry.source))
    )
    return result


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
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(entry, field, value)
    await db.commit()
    result = await db.scalar(
        select(IncomeEntry).where(IncomeEntry.id == entry_id).options(selectinload(IncomeEntry.source))
    )
    return result


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

@router.post("/import/preview")
async def import_preview(
    file: UploadFile = File(...),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    await _get_db_user(firebase_user, db)
    content = await file.read()
    data, columns = _parse_file(content, file.filename or "")
    sample = [[str(v) if v is not None else "" for v in row] for row in data[:5]]
    return {"columns": columns, "sample": sample, "row_count": len(data)}


@router.post("/import/run")
async def import_run(
    file: UploadFile = File(...),
    date_col: str = Form(...),
    amount_col: str = Form(...),
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

    content = await file.read()
    data, columns = _parse_file(content, file.filename or "")

    imported = 0
    skipped = 0
    errors: list[str] = []

    for i, row in enumerate(data, start=2):
        try:
            row_dict = dict(zip(columns, row))
            period = _parse_date(row_dict.get(date_col))
            amount = _parse_number(row_dict.get(amount_col))

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

            db.add(IncomeEntry(
                tenant_id=user.tenant_id,
                user_id=user.id,
                source_id=source.id,
                amount=amount_dec,
                period_date=period,
                notes=notes,
            ))
            imported += 1
        except Exception as exc:
            errors.append(f"Fila {i}: {exc}")

    await db.commit()
    return {"imported": imported, "skipped": skipped, "errors": errors}
