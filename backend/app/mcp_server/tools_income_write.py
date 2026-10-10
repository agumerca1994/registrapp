"""Write tools for income: load a payslip, fix an entry, shape a source's fields.

Preview-then-apply, audit and the rate limit come from `write_common`. The
logic itself — ownership checks, field archiving, the derived
bruto/deducciones — lives in `services/income.py`; nothing is reimplemented here.
"""
import logging
from decimal import Decimal
from typing import Any, Literal

from fastapi import HTTPException
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import BaseModel, Field
from sqlalchemy import extract, select

from app.mcp_server.context import current_caller, tool_session
from app.mcp_server.instance import mcp
from app.mcp_server.params import parse_date
from app.mcp_server.serialize import f0
from app.mcp_server.write_common import (
    DESTRUCTIVE, WRITE, audit, finish, fold, http_to_tool, limit_writes,
)
from app.models.income import IncomeEntry, IncomeSource, IncomeSourceField, IncomeType
from app.schemas.income import IncomeEntryItemIn, IncomeSourceFieldIn
from app.services.income import (
    apply_items, assert_entry_writable, assert_owns_source, assert_writable_source,
    ensure_field, entry_out, load_source, sync_fields,
)

logger = logging.getLogger(__name__)

FieldKind = Literal["add", "subtract", "info"]


class IncomeItemArg(BaseModel):
    """Un renglón del recibo."""
    name: str = Field(description="Nombre del campo de la fuente (ver get_taxonomy → income_sources[].fields).")
    amount: float = Field(description="Monto positivo. El signo lo pone el tipo del campo (add/subtract).")


class NewFieldArg(BaseModel):
    name: str = Field(description="Nombre del campo, ej. 'Impuesto a las ganancias'.")
    kind: FieldKind = Field(description="add = suma al neto, subtract = resta, info = no entra en la cuenta.")


class RenameFieldArg(BaseModel):
    field_id: int
    name: str


# ── helpers ────────────────────────────────────────────────────────────────────

def _dec(v: float) -> Decimal:
    return Decimal(str(round(v, 2)))


def _detail_net(items) -> Decimal | None:
    """Σ add − Σ subtract, or None when nothing in the detail enters the math."""
    rows = [i for i in items if i.kind in ("add", "subtract")]
    if not rows:
        return None
    return sum((i.amount if i.kind == "add" else -i.amount for i in rows), Decimal("0"))


def _entry_dict(e: IncomeEntry) -> dict[str, Any]:
    items = sorted(e.items, key=lambda i: (i.field.position, i.field_id))
    return {
        "id": e.id,
        "source_id": e.source_id,
        "source": e.source.name,
        "period_date": e.period_date.isoformat(),
        "currency": e.currency,
        "neto": f0(e.amount),
        "bruto": f0(e.bruto) if e.bruto is not None else None,
        "deducciones": f0(e.deducciones) if e.deducciones is not None else None,
        "notes": e.notes,
        "items": [
            {"field_id": i.field_id, "name": i.name, "kind": i.kind, "amount": f0(i.amount)}
            for i in items
        ],
    }


def _fields_dict(source: IncomeSource) -> list[dict[str, Any]]:
    return [
        {"id": fl.id, "name": fl.name, "kind": fl.kind, "active": fl.is_active}
        for fl in sorted(source.fields, key=lambda x: (not x.is_active, x.position))
    ]


def _resolve_field(
    name: str, fields: list[IncomeSourceField], allowed_archived: set[int],
) -> IncomeSourceField:
    key = fold(name)
    active = [fl for fl in fields if fl.is_active and fold(fl.name) == key]
    if active:
        return active[0]
    archived = [fl for fl in fields if not fl.is_active and fold(fl.name) == key and fl.id in allowed_archived]
    if archived:
        return archived[0]
    available = ", ".join(fl.name for fl in fields if fl.is_active) or "(ninguno)"
    raise ToolError(
        f"La fuente no tiene un campo «{name}». Campos disponibles: {available}. "
        "Si hace falta uno nuevo, pasalo en new_fields con su tipo (add/subtract/info)."
    )


# ── tools ──────────────────────────────────────────────────────────────────────

@mcp.tool(annotations=WRITE)
async def save_income_entry(
    source_id: int | None = None,
    period_date: str | None = None,
    items: list[IncomeItemArg] | None = None,
    amount: float | None = None,
    currency: str | None = None,
    notes: str | None = None,
    entry_id: int | None = None,
    new_fields: list[NewFieldArg] | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Crea o edita un ingreso, con su detalle por campo (ej. desde un recibo de sueldo).

    Flujo esperado:
    1. `get_taxonomy` para ver las fuentes y sus campos; `list_income` con
       group_by="none" para ver si ese mes ya está cargado (y su `id`).
    2. Llamar con dry_run=true (el default) y mostrarle al usuario la vista previa,
       incluidas las `warnings`.
    3. Sólo con su confirmación, repetir con dry_run=false.

    - Sin `entry_id` crea; con `entry_id` edita ese ingreso.
    - `items` se matchea por nombre contra los campos de la fuente (sin importar
      mayúsculas ni acentos). Al editar, `items` REEMPLAZA el detalle completo;
      omitilo para no tocarlo.
    - `amount` es el NETO (lo que efectivamente se cobró). Si se omite, se calcula
      del detalle (sumas − restas). Pasalo igual cuando el recibo lo informa: si no
      coincide con el detalle, queda guardado el del recibo y se avisa la diferencia.
    - `new_fields` agrega campos a la fuente antes de cargar (ej. un concepto del
      recibo que la fuente todavía no tiene).

    Args:
        source_id: Fuente del ingreso. Obligatoria al crear; al editar, cambiarla vacía el detalle salvo que pases items.
        period_date: Fecha del ingreso, YYYY-MM-DD (la fecha de pago del recibo). Obligatoria al crear.
        items: Renglones del recibo: [{name, amount}].
        amount: Neto. Opcional si el detalle permite calcularlo.
        currency: "ARS" (default al crear) o "USD".
        notes: Nota libre, ej. "Recibo septiembre 2026".
        entry_id: Ingreso a editar.
        new_fields: Campos a crear en la fuente: [{name, kind}].
        dry_run: true = vista previa sin guardar (default). false = guardar.
    """
    if currency is not None and currency not in ("ARS", "USD"):
        raise ToolError('currency debe ser "ARS" o "USD"')

    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        try:
            before = None
            entry: IncomeEntry | None = None
            if entry_id is not None:
                entry = await db.get(IncomeEntry, entry_id)
                if entry is None or entry.tenant_id != caller.tenant_id:
                    raise ToolError(f"No existe el ingreso {entry_id} en este hogar")
                loaded = await entry_out(entry_id, db)
                before = _entry_dict(loaded)
                entry = loaded
            elif source_id is None or period_date is None:
                raise ToolError("Para crear un ingreso hacen falta source_id y period_date")

            target_source = source_id if source_id is not None else entry.source_id
            await assert_owns_source(target_source, caller.tenant_id, db)
            # La fuente "Ventas" de un negocio la arma el sistema: ni altas ni
            # ediciones a mano, tampoco mover un ingreso adentro o afuera.
            if entry is not None:
                await assert_entry_writable(entry, db)
            await assert_writable_source(target_source, db)
            source = await load_source(target_source, caller.tenant_id, db)

            created_fields: list[str] = []
            for nf in new_fields or []:
                key = fold(nf.name)
                if any(fl.is_active and fold(fl.name) == key for fl in source.fields):
                    continue
                await ensure_field(source.id, nf.name.strip(), nf.kind, db)
                created_fields.append(f"{nf.name.strip()} ({nf.kind})")
            if created_fields:
                source = await load_source(target_source, caller.tenant_id, db)

            # Un campo archivado sólo vale si este mismo ingreso ya lo tenía:
            # editar un ingreso viejo no puede obligar a perder ese monto.
            same_source = entry is not None and target_source == entry.source_id
            allowed_archived = {i["field_id"] for i in before["items"]} if same_source else set()
            resolved: list[IncomeEntryItemIn] | None = None
            resolved_kinds: list[tuple[str, Decimal]] = []
            if items is not None:
                resolved = []
                seen: set[int] = set()
                for it in items:
                    fl = _resolve_field(it.name, source.fields, allowed_archived)
                    if fl.id in seen:
                        raise ToolError(f"El campo «{fl.name}» aparece dos veces en items")
                    if it.amount < 0:
                        raise ToolError(f"«{it.name}»: los montos van en positivo; el tipo del campo decide si suma o resta")
                    seen.add(fl.id)
                    resolved.append(IncomeEntryItemIn(field_id=fl.id, amount=_dec(it.amount)))
                    resolved_kinds.append((fl.kind, _dec(it.amount)))

            if amount is not None:
                net = _dec(amount)
            elif resolved is not None and any(k in ("add", "subtract") for k, _ in resolved_kinds):
                net = sum((a if k == "add" else -a for k, a in resolved_kinds if k != "info"), Decimal("0"))
            elif entry is not None:
                net = entry.amount
            else:
                raise ToolError("Falta el neto: pasá amount o items con campos que sumen/resten")
            if net < 0:
                raise ToolError("El neto no puede ser negativo")

            if entry is None:
                entry = IncomeEntry(
                    tenant_id=caller.tenant_id, user_id=caller.user_id, source_id=source.id,
                    amount=net, currency=currency or "ARS",
                    period_date=parse_date(period_date, "period_date"), notes=notes,
                )
                db.add(entry)
                await db.flush()
                action = "create"
            else:
                source_changed = source.id != entry.source_id
                entry.source_id = source.id
                entry.amount = net
                if currency is not None:
                    entry.currency = currency
                if period_date is not None:
                    entry.period_date = parse_date(period_date, "period_date")
                if notes is not None:
                    entry.notes = notes
                if resolved is None and source_changed:
                    resolved = []
                action = "update"
            if resolved is not None:
                await apply_items(entry, resolved, db)
            await db.flush()

            saved = await entry_out(entry.id, db)
            after = _entry_dict(saved)
            if action == "create" and dry_run:
                after["id"] = None

            warnings: list[str] = []
            detail = _detail_net(saved.items)
            if detail is not None and detail != saved.amount:
                warnings.append(
                    f"El detalle da {f0(detail)} pero el neto es {f0(saved.amount)} "
                    f"(diferencia {f0(saved.amount - detail)}): falta algún concepto o hay un error de tipeo."
                )
            dupes = (await db.scalars(
                select(IncomeEntry).where(
                    IncomeEntry.tenant_id == caller.tenant_id,
                    IncomeEntry.source_id == saved.source_id,
                    IncomeEntry.currency == saved.currency,
                    extract("year", IncomeEntry.period_date) == saved.period_date.year,
                    extract("month", IncomeEntry.period_date) == saved.period_date.month,
                    IncomeEntry.id != saved.id,
                )
            )).all()
            for d in dupes:
                warnings.append(
                    f"Ya hay otro ingreso de «{saved.source.name}» en ese mes "
                    f"(id {d.id}, {d.period_date.isoformat()}, neto {f0(d.amount)}). "
                    "Si es el mismo recibo, editá ese con entry_id en vez de crear otro."
                )

            result = {
                "action": action,
                "entry": after,
                "before": before,
                "created_fields": created_fields,
                "warnings": warnings,
            }
            saved_id = saved.id
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "save_income_entry",
                f"{action} ingreso {saved_id} ({after['source']}, {after['period_date']}, neto {after['neto']})",
                {"entry_id": saved_id, "action": action, "before": before, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_income_entry(entry_id: int, dry_run: bool = True) -> dict[str, Any]:
    """Elimina un ingreso (ej. un duplicado detectado al comparar con un recibo).

    Con dry_run=true (default) muestra qué se borraría sin borrar. Confirmá con el
    usuario antes de repetir con dry_run=false: no se puede deshacer.

    Args:
        entry_id: Ingreso a eliminar (los ids salen de list_income con group_by="none").
        dry_run: true = vista previa (default). false = borrar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        entry = await db.get(IncomeEntry, entry_id)
        if entry is None or entry.tenant_id != caller.tenant_id:
            raise ToolError(f"No existe el ingreso {entry_id} en este hogar")
        try:
            await assert_entry_writable(entry, db)
        except HTTPException as exc:
            raise http_to_tool(exc)
        snapshot = _entry_dict(await entry_out(entry_id, db))
        await db.delete(entry)
        await db.flush()
        return await finish(db, dry_run, {"action": "delete", "entry": snapshot}, lambda: audit(
            db, caller, "delete_income_entry",
            f"borrado ingreso {entry_id} ({snapshot['source']}, {snapshot['period_date']}, neto {snapshot['neto']})",
            {"entry_id": entry_id, "before": snapshot},
        ))


@mcp.tool(annotations=WRITE)
async def create_income_source(
    name: str,
    income_type: str = "salary",
    fields: list[NewFieldArg] | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Crea una fuente de ingreso, opcionalmente con sus campos de detalle.

    Usala cuando un recibo es de un empleador/origen que todavía no existe. Antes
    revisá get_taxonomy: si ya hay una fuente parecida, usá esa.

    Args:
        name: Nombre de la fuente, ej. "Sueldo Acme".
        income_type: "salary", "bonus", "aguinaldo", "investment" u "other".
        fields: Campos de detalle: [{name, kind}] en el orden del recibo.
        dry_run: true = vista previa (default). false = crear.
    """
    try:
        itype = IncomeType(income_type)
    except ValueError:
        raise ToolError('income_type debe ser "salary", "bonus", "aguinaldo", "investment" u "other"')
    if not name.strip():
        raise ToolError("La fuente necesita un nombre")

    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        existing = (await db.scalars(
            select(IncomeSource).where(IncomeSource.tenant_id == caller.tenant_id)
        )).all()
        clash = next((s for s in existing if fold(s.name) == fold(name)), None)
        if clash:
            raise ToolError(f"Ya existe la fuente «{clash.name}» (id {clash.id}); usá esa.")
        names = [fold(fl.name) for fl in fields or []]
        if len(set(names)) != len(names):
            raise ToolError("Hay dos campos con el mismo nombre")

        source = IncomeSource(tenant_id=caller.tenant_id, name=name.strip(), income_type=itype)
        db.add(source)
        await db.flush()
        for pos, fl in enumerate(fields or []):
            db.add(IncomeSourceField(source_id=source.id, name=fl.name.strip(), kind=fl.kind, position=pos))
        await db.flush()
        loaded = await load_source(source.id, caller.tenant_id, db)
        result = {
            "action": "create_source",
            "source": {
                "id": None if dry_run else loaded.id, "name": loaded.name,
                "income_type": loaded.income_type.value, "fields": _fields_dict(loaded),
            },
        }
        sid = loaded.id
        return await finish(db, dry_run, result, lambda: audit(
            db, caller, "create_income_source", f"fuente {sid} «{name.strip()}»",
            {"source_id": sid, "after": result["source"]},
        ))


@mcp.tool(annotations=WRITE)
async def update_income_source_fields(
    source_id: int,
    add: list[NewFieldArg] | None = None,
    rename: list[RenameFieldArg] | None = None,
    remove: list[int] | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Agrega, renombra o quita campos de detalle de una fuente de ingreso.

    Quitar un campo lo ARCHIVA: deja de ofrecerse para ingresos nuevos, pero los
    ingresos ya cargados conservan sus montos. El tipo de un campo no se cambia
    acá (si ya tiene montos no se puede; si hace falta otro tipo, agregá un campo
    nuevo y quitá el viejo).

    Args:
        source_id: Fuente a modificar.
        add: Campos nuevos: [{name, kind}], se agregan al final.
        rename: [{field_id, name}].
        remove: ids de campos a quitar (archivar).
        dry_run: true = vista previa (default). false = guardar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        try:
            source = await load_source(source_id, caller.tenant_id, db)
            await assert_writable_source(source.id, db)
            before = _fields_dict(source)
            renames = {r.field_id: r.name.strip() for r in rename or []}
            removes = set(remove or [])
            known = {fl.id for fl in source.fields}
            unknown = (set(renames) | removes) - known
            if unknown:
                raise ToolError(f"Campos que no son de esta fuente: {sorted(unknown)}")

            incoming: list[IncomeSourceFieldIn] = []
            for fl in sorted(source.fields, key=lambda x: x.position):
                if not fl.is_active or fl.id in removes:
                    continue
                incoming.append(IncomeSourceFieldIn(id=fl.id, name=renames.get(fl.id, fl.name), kind=fl.kind))
            existing_names = {fold(i.name) for i in incoming}
            for nf in add or []:
                if fold(nf.name) in existing_names:
                    raise ToolError(f"La fuente ya tiene un campo «{nf.name}»")
                existing_names.add(fold(nf.name))
                incoming.append(IncomeSourceFieldIn(name=nf.name, kind=nf.kind))

            await sync_fields(source, incoming, db)
            await db.flush()
            after_src = await load_source(source_id, caller.tenant_id, db)
            after = _fields_dict(after_src)
            result = {"action": "update_source_fields", "source": after_src.name, "before": before, "after": after}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "update_income_source_fields", f"campos de fuente {source_id}",
                {"source_id": source_id, "before": before, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)
