"""Credit cards from the assistant: compare a statement, fix it, add what's missing.

`get_card_statement` is the read half — the items of one statement with their
ids, so a bank PDF can be checked line by line. The rest write, through the
same `services/credit_cards.py` the app uses (mirror expense entries, instalment
propagation and cascades), and follow `write_common`: preview by default,
audit when applied.

Two refusals are deliberate:
- **Shared items** can't be deleted (or have their amount changed) from here.
  Deleting leaves the `SharedExpense` behind with every participant's split,
  and a new amount breaks the split's sum. Both need the app's sharing flow.
- **Non-root instalments** can't be edited or deleted on their own: the root
  generated them, and the app has the same rule.
"""
from decimal import Decimal
from types import SimpleNamespace
from typing import Any

from fastapi import HTTPException
from mcp.server.fastmcp.exceptions import ToolError
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.mcp_server.context import McpCaller, current_caller, tool_session
from app.mcp_server.instance import READ_ONLY, mcp
from app.mcp_server.params import parse_date
from app.mcp_server.serialize import f0, guard
from app.mcp_server.write_common import (
    DESTRUCTIVE, WRITE, audit, finish, fold, http_to_tool, limit_writes,
)
from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import ExpenseCategory
from app.schemas.credit_card import CreditCardItemCreate
from app.services.credit_cards import (
    apply_item_update, create_item_in_statement, delete_card_tree, delete_item_tree,
    delete_statement_tree, find_or_create_statement,
)
from app.services.currency import estimate_due_date_py


# ── helpers ────────────────────────────────────────────────────────────────────

def _dec(v: float) -> Decimal:
    return Decimal(str(round(v, 2)))


def _check_month(year: int, month: int) -> None:
    if not 1 <= month <= 12 or not 2000 <= year <= 2100:
        raise ToolError("year/month inválidos (month 1-12)")


async def _load_card(db: AsyncSession, caller: McpCaller, card_id: int) -> CreditCard:
    card = await db.get(CreditCard, card_id)
    if card is None or card.tenant_id != caller.tenant_id:
        raise ToolError(f"No existe la tarjeta {card_id} en este hogar")
    return card


async def _load_item(db: AsyncSession, caller: McpCaller, item_id: int) -> CreditCardItem:
    item = await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.id == item_id)
        .options(
            selectinload(CreditCardItem.statement).selectinload(CreditCardStatement.card),
            selectinload(CreditCardItem.category),
            selectinload(CreditCardItem.shared_expense),
        )
    )
    if item is None or item.statement.tenant_id != caller.tenant_id:
        raise ToolError(f"No existe el ítem {item_id} en este hogar")
    return item


async def _load_statement(db: AsyncSession, caller: McpCaller, stmt_id: int) -> CreditCardStatement:
    stmt = await db.scalar(
        select(CreditCardStatement)
        .where(CreditCardStatement.id == stmt_id)
        .options(
            selectinload(CreditCardStatement.card),
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.category),
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.shared_expense),
        )
        .execution_options(populate_existing=True)
    )
    if stmt is None or stmt.tenant_id != caller.tenant_id:
        raise ToolError(f"No existe el resumen {stmt_id} en este hogar")
    return stmt


async def _resolve_category(
    db: AsyncSession, caller: McpCaller, category: str | None, category_id: int | None,
) -> int | None:
    """Category by id or by exact name (case/accent-insensitive)."""
    if category_id is not None:
        return category_id  # ownership is checked by the service
    if category is None:
        return None
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == caller.tenant_id)
    )).all()
    match = [c for c in cats if fold(c.name) == fold(category)]
    if not match:
        names = ", ".join(sorted(c.name for c in cats)) or "(ninguna)"
        raise ToolError(f"No hay una categoría «{category}». Categorías: {names}")
    return match[0].id


def _item_dict(i: CreditCardItem) -> dict[str, Any]:
    return {
        "id": i.id,
        "statement_id": i.statement_id,
        "description": i.description,
        "date": i.item_date.isoformat(),
        "amount": f0(i.amount),
        "currency": i.currency,
        "type": i.item_type,
        "cuota": (f"{i.installment_number}/{i.installment_count}"
                  if i.item_type == "installment" and i.installment_count else None),
        "purchase_total": f0(i.purchase_total) if i.purchase_total is not None else None,
        "category": i.category.name if i.category else None,
        "shared": i.shared_expense is not None,
        # Cuotas 2..N: para editar o borrar hay que ir a la raíz.
        "root_item_id": i.installment_group_id,
    }


def _statement_dict(s: CreditCardStatement) -> dict[str, Any]:
    due_day = s.card.due_day if s.card else None
    effective = s.due_date or estimate_due_date_py(s.year, s.month, due_day)
    totals: dict[str, float] = {}
    for i in s.items:
        totals[i.currency] = round(totals.get(i.currency, 0.0) + float(i.amount), 2)
    return {
        "id": s.id,
        "card_id": s.card_id,
        "card": s.card.alias if s.card else None,
        "period": f"{s.year}-{s.month:02d}",
        "closing_date": s.closing_date.isoformat() if s.closing_date else None,
        "due_date": s.due_date.isoformat() if s.due_date else None,
        "due_date_effective": effective.isoformat(),
        "due_date_is_estimated": s.due_date is None,
        "totals": totals,
        "item_count": len(s.items),
    }


def _card_dict(c: CreditCard) -> dict[str, Any]:
    return {
        "id": c.id, "bank": c.bank, "alias": c.alias, "titular": c.titular,
        "last_4_digits": c.last_4_digits, "due_day": c.due_day,
    }


def _refuse_shared(items: list[CreditCardItem], what: str) -> None:
    shared = [i for i in items if i.shared_expense is not None]
    if shared:
        listed = ", ".join(f"«{i.description}» (id {i.id})" for i in shared[:5])
        raise ToolError(
            f"No se puede {what}: tiene ítems compartidos ({listed}). Borrarlos desde acá "
            "dejaría el gasto compartido colgado para los demás participantes; "
            "hacelo desde la app (Gastos compartidos)."
        )


# ── read ───────────────────────────────────────────────────────────────────────

@mcp.tool(annotations=READ_ONLY)
async def get_card_statement(card_id: int, year: int, month: int) -> dict[str, Any]:
    """Un resumen de tarjeta con todos sus ítems e ids, para compararlo con el del banco.

    Cada ítem trae id, fecha, descripción, monto, moneda, cuota (n/N), categoría
    y si está compartido. Las cuotas 2..N traen `root_item_id`: se editan o
    borran desde la cuota 1. Si el resumen no existe, devuelve los períodos
    que sí hay para esa tarjeta.

    Args:
        card_id: Tarjeta (ids en get_taxonomy → cards).
        year: Año del período del resumen.
        month: Mes del período, 1-12.
    """
    _check_month(year, month)
    async with tool_session() as db:
        caller = await current_caller(db)
        card = await _load_card(db, caller, card_id)
        stmt_id = await db.scalar(
            select(CreditCardStatement.id).where(
                CreditCardStatement.card_id == card.id,
                CreditCardStatement.year == year,
                CreditCardStatement.month == month,
            )
        )
        if stmt_id is None:
            periods = (await db.execute(
                select(CreditCardStatement.year, CreditCardStatement.month)
                .where(CreditCardStatement.card_id == card.id)
                .order_by(CreditCardStatement.year.desc(), CreditCardStatement.month.desc())
                .limit(36)
            )).all()
            return {
                "found": False,
                "card": _card_dict(card),
                "available_periods": [f"{y}-{m:02d}" for y, m in periods],
                "notes": ["Para cargar ítems en un período nuevo, save_card_item crea el resumen."],
            }
        stmt = await _load_statement(db, caller, stmt_id)
        items = sorted(stmt.items, key=lambda i: (i.item_date, i.id))
        return guard({
            "found": True,
            "statement": _statement_dict(stmt),
            "items": [_item_dict(i) for i in items],
            "notes": [
                "Los totales son por moneda; pesos y dólares no se suman.",
                "amount de una cuota es el monto de esa cuota, no el total de la compra.",
            ],
        })


# ── items ──────────────────────────────────────────────────────────────────────

@mcp.tool(annotations=WRITE)
async def save_card_item(
    item_id: int | None = None,
    card_id: int | None = None,
    year: int | None = None,
    month: int | None = None,
    description: str | None = None,
    amount: float | None = None,
    item_date: str | None = None,
    category: str | None = None,
    category_id: int | None = None,
    currency: str = "ARS",
    installments: int = 1,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Agrega un ítem a un resumen de tarjeta, o corrige uno existente.

    - Sin `item_id` CREA: hacen falta card_id, year, month (período del resumen;
      si no existe se crea), description, amount, item_date y la categoría
      (no hace falta en USD, que va a "Consumo en dólares").
      Con `installments` > 1 es una compra en cuotas: `amount` es el monto de
      CADA cuota, y las cuotas siguientes se crean solas en los próximos resúmenes.
      Las compras en USD son siempre en un pago.
    - Con `item_id` EDITA: sólo description, amount, item_date y categoría. Una
      cuota 2..N no se edita (editá la raíz, `root_item_id`). Un ítem compartido
      no puede cambiar de monto desde acá.

    Antes de crear, revisá el resumen con get_card_statement para no duplicar.
    Arranca en dry_run=true: mostrá la vista previa y aplicá sólo si el usuario confirma.

    Args:
        item_id: Ítem a editar.
        card_id: Tarjeta (al crear).
        year: Año del período del resumen (al crear).
        month: Mes del período del resumen (al crear).
        description: Descripción, ej. "MERCADOLIBRE".
        amount: Monto (por cuota si es en cuotas), positivo.
        item_date: Fecha de la compra, YYYY-MM-DD.
        category: Nombre de la categoría (ver get_taxonomy).
        category_id: Alternativa a category, por id.
        currency: "ARS" (default) o "USD". Sólo al crear.
        installments: Cantidad de cuotas (1 = un pago). Sólo al crear.
        dry_run: true = vista previa (default). false = guardar.
    """
    if amount is not None and amount <= 0:
        raise ToolError("amount tiene que ser positivo")
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        try:
            warnings: list[str] = []
            cat_id = await _resolve_category(db, caller, category, category_id)

            if item_id is not None:
                item = await _load_item(db, caller, item_id)
                if item.installment_group_id is not None:
                    raise ToolError(
                        f"Es la cuota {item.installment_number}/{item.installment_count} de un plan: "
                        f"editá la cuota 1 (item_id {item.installment_group_id})."
                    )
                if item.shared_expense is not None and amount is not None and _dec(amount) != item.amount:
                    raise ToolError(
                        "Es un ítem compartido: cambiarle el monto desde acá rompería la división. "
                        "Corregilo desde la app."
                    )
                before = _item_dict(item)
                updates: dict[str, Any] = {}
                if description is not None:
                    updates["description"] = description.strip()
                if amount is not None:
                    updates["amount"] = _dec(amount)
                if item_date is not None:
                    updates["item_date"] = parse_date(item_date, "item_date")
                if cat_id is not None:
                    if item.currency == "USD":
                        raise ToolError("Los ítems en USD van siempre a 'Consumo en dólares'")
                    updates["category_id"] = cat_id
                if not updates:
                    raise ToolError("No hay nada para cambiar")
                if item.item_type == "installment" and "amount" in updates:
                    warnings.append(
                        "Cambiar el monto de la cuota 1 no cambia las cuotas siguientes, que ya "
                        "están creadas: revisalas en los próximos resúmenes."
                    )
                await apply_item_update(item, updates, caller.tenant_id, db)
                await db.flush()
                item = await _load_item(db, caller, item_id)
                await db.refresh(item, ["category"])
                after = _item_dict(item)
                result = {"action": "update", "item": after, "before": before, "warnings": warnings}
                return await finish(db, dry_run, result, lambda: audit(
                    db, caller, "save_card_item", f"editado ítem {item_id} ({after['description']})",
                    {"item_id": item_id, "before": before, "after": after},
                ))

            # ── create
            missing = [n for n, v in (("card_id", card_id), ("year", year), ("month", month),
                                      ("description", description), ("amount", amount),
                                      ("item_date", item_date)) if v is None]
            if missing:
                raise ToolError(f"Para crear un ítem faltan: {', '.join(missing)}")
            if currency not in ("ARS", "USD"):
                raise ToolError('currency debe ser "ARS" o "USD"')
            if installments < 1:
                raise ToolError("installments tiene que ser 1 o más")
            _check_month(year, month)
            card = await _load_card(db, caller, card_id)
            try:
                body = CreditCardItemCreate(
                    description=description.strip(),
                    category_id=cat_id,
                    item_date=parse_date(item_date, "item_date"),
                    item_type="installment" if installments > 1 else "single",
                    amount=_dec(amount),
                    currency=currency,
                    installment_count=installments if installments > 1 else None,
                )
            except ValidationError as exc:
                raise ToolError("; ".join(e["msg"] for e in exc.errors()))

            stmt = await find_or_create_statement(card, year, month, caller.tenant_id, db)
            dupes = (await db.scalars(
                select(CreditCardItem).where(
                    CreditCardItem.statement_id == stmt.id,
                    CreditCardItem.amount == body.amount,
                    CreditCardItem.currency == body.currency,
                )
            )).all()
            for d in dupes:
                warnings.append(
                    f"Ya hay un ítem del mismo monto en este resumen: «{d.description}» "
                    f"(id {d.id}, {d.item_date.isoformat()}). Si es el mismo, no lo cargues de nuevo."
                )
            actor = SimpleNamespace(tenant_id=caller.tenant_id, id=caller.user_id)
            item = await create_item_in_statement(stmt, card, body, actor, db)
            await db.flush()
            item = await _load_item(db, caller, item.id)
            after = _item_dict(item)
            if dry_run:
                after["id"] = None
            result = {
                "action": "create",
                "item": after,
                "statement_period": f"{year}-{month:02d}",
                "future_installments_created": installments - 1,
                "warnings": warnings,
            }
            new_id = item.id
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "save_card_item",
                f"creado ítem {new_id} ({after['description']}, {after['amount']} {after['currency']}) en {card.alias} {year}-{month:02d}",
                {"item_id": new_id, "after": after},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_card_item(item_id: int, dry_run: bool = True) -> dict[str, Any]:
    """Elimina un ítem de un resumen de tarjeta y su egreso.

    Si es la cuota 1 de un plan, borra TODAS las cuotas (también las de resúmenes
    futuros); la vista previa dice cuántas. Una cuota 2..N no se borra sola. Un
    ítem compartido no se borra desde acá.

    Args:
        item_id: Ítem a eliminar (ids en get_card_statement).
        dry_run: true = vista previa (default). false = borrar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        try:
            item = await _load_item(db, caller, item_id)
            if item.installment_group_id is not None:
                raise ToolError(
                    f"Es la cuota {item.installment_number}/{item.installment_count}: "
                    f"para borrar el plan, borrá la cuota 1 (item_id {item.installment_group_id})."
                )
            children = (await db.scalars(
                select(CreditCardItem)
                .where(CreditCardItem.installment_group_id == item.id)
                .options(selectinload(CreditCardItem.shared_expense), selectinload(CreditCardItem.statement))
            )).all()
            _refuse_shared([item, *children], "borrar este ítem")
            snapshot = _item_dict(item)
            cascaded = [
                {"id": c.id, "cuota": f"{c.installment_number}/{c.installment_count}",
                 "period": f"{c.statement.year}-{c.statement.month:02d}"}
                for c in children
            ]
            await delete_item_tree(item, db)
            await db.flush()
            result = {"action": "delete", "item": snapshot, "also_deleted_installments": cascaded}
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "delete_card_item",
                f"borrado ítem {item_id} ({snapshot['description']}) + {len(cascaded)} cuotas",
                {"item_id": item_id, "before": snapshot, "cascaded": cascaded},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


# ── statements ─────────────────────────────────────────────────────────────────

@mcp.tool(annotations=WRITE)
async def update_card_statement(
    statement_id: int,
    closing_date: str | None = None,
    due_date: str | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Carga o corrige las fechas de cierre y de vencimiento de un resumen.

    El vencimiento real reemplaza al estimado en todos lados (es el que decide en
    qué mes sale la plata en el dashboard).

    Args:
        statement_id: Resumen (id en get_card_statement).
        closing_date: Fecha de cierre, YYYY-MM-DD.
        due_date: Fecha de vencimiento, YYYY-MM-DD.
        dry_run: true = vista previa (default). false = guardar.
    """
    if closing_date is None and due_date is None:
        raise ToolError("Pasá closing_date y/o due_date")
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        stmt = await _load_statement(db, caller, statement_id)
        before = _statement_dict(stmt)
        if closing_date is not None:
            stmt.closing_date = parse_date(closing_date, "closing_date")
        if due_date is not None:
            stmt.due_date = parse_date(due_date, "due_date")
        warnings = []
        if stmt.closing_date and stmt.due_date and stmt.due_date < stmt.closing_date:
            warnings.append("El vencimiento queda antes del cierre: revisá las fechas.")
        await db.flush()
        after = _statement_dict(stmt)
        result = {"action": "update_statement", "statement": after, "before": before, "warnings": warnings}
        return await finish(db, dry_run, result, lambda: audit(
            db, caller, "update_card_statement", f"fechas del resumen {statement_id}",
            {"statement_id": statement_id, "before": before, "after": after},
        ))


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_card_statement(statement_id: int, keep_expenses: bool, dry_run: bool = True) -> dict[str, Any]:
    """Elimina un resumen de tarjeta con todos sus ítems.

    `keep_expenses` es obligatorio porque no hay una respuesta obvia: true deja
    los gastos en Egresos (siguen contando), false los borra también. Preguntale
    al usuario. Si el resumen tiene ítems compartidos no se puede borrar desde acá.

    Args:
        statement_id: Resumen a eliminar.
        keep_expenses: true = conservar los gastos en Egresos; false = borrarlos.
        dry_run: true = vista previa (default). false = borrar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        try:
            stmt = await _load_statement(db, caller, statement_id)
            _refuse_shared(stmt.items, "borrar este resumen")
            snapshot = _statement_dict(stmt)
            warnings = []
            roots = [i for i in stmt.items if i.item_type == "installment" and i.installment_group_id is None]
            kids = [i for i in stmt.items if i.installment_group_id is not None]
            if roots:
                warnings.append(
                    f"Tiene {len(roots)} compra(s) en cuotas que empiezan acá: sus cuotas siguientes "
                    "quedan en los otros resúmenes como ítems sueltos."
                )
            if kids:
                warnings.append(f"Tiene {len(kids)} cuota(s) de planes que empezaron antes: esos planes quedan con una cuota menos.")
            await delete_statement_tree(stmt, keep_expenses, db)
            await db.flush()
            result = {
                "action": "delete_statement", "statement": snapshot,
                "keep_expenses": keep_expenses, "warnings": warnings,
            }
            return await finish(db, dry_run, result, lambda: audit(
                db, caller, "delete_card_statement",
                f"borrado resumen {statement_id} ({snapshot['card']} {snapshot['period']}, keep_expenses={keep_expenses})",
                {"statement_id": statement_id, "before": snapshot, "keep_expenses": keep_expenses},
            ))
        except HTTPException as exc:
            await db.rollback()
            raise http_to_tool(exc)


# ── cards ──────────────────────────────────────────────────────────────────────

@mcp.tool(annotations=WRITE)
async def save_credit_card(
    card_id: int | None = None,
    bank: str | None = None,
    alias: str | None = None,
    titular: str | None = None,
    last_4_digits: str | None = None,
    due_day: int | None = None,
    dry_run: bool = True,
) -> dict[str, Any]:
    """Crea una tarjeta o edita sus datos.

    Sin `card_id` crea (bank y alias obligatorios); con `card_id` edita sólo lo
    que pases. `due_day` es el día del mes en que suele vencer: se usa para
    estimar el vencimiento mientras no se carga el real.

    Args:
        card_id: Tarjeta a editar.
        bank: Banco, ej. "BBVA".
        alias: Nombre corto, ej. "Visa Ana".
        titular: Titular.
        last_4_digits: Últimos 4 dígitos.
        due_day: Día habitual de vencimiento, 1-31.
        dry_run: true = vista previa (default). false = guardar.
    """
    if last_4_digits is not None and not (len(last_4_digits) == 4 and last_4_digits.isdigit()):
        raise ToolError("last_4_digits tiene que ser 4 dígitos")
    if due_day is not None and not 1 <= due_day <= 31:
        raise ToolError("due_day va de 1 a 31")
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        values = {k: v for k, v in {
            "bank": bank.strip() if bank else None, "alias": alias.strip() if alias else None,
            "titular": titular, "last_4_digits": last_4_digits, "due_day": due_day,
        }.items() if v is not None}
        if card_id is None:
            if not values.get("bank") or not values.get("alias"):
                raise ToolError("Para crear una tarjeta hacen falta bank y alias")
            card = CreditCard(tenant_id=caller.tenant_id, user_id=caller.user_id, **values)
            db.add(card)
            await db.flush()
            before, action = None, "create"
        else:
            card = await _load_card(db, caller, card_id)
            before, action = _card_dict(card), "update"
            if not values:
                raise ToolError("No hay nada para cambiar")
            for k, v in values.items():
                setattr(card, k, v)
            await db.flush()
        after = _card_dict(card)
        if action == "create" and dry_run:
            after["id"] = None
        result = {"action": action, "card": after, "before": before}
        cid = card.id
        return await finish(db, dry_run, result, lambda: audit(
            db, caller, "save_credit_card", f"{action} tarjeta {cid} ({after['alias']})",
            {"card_id": cid, "before": before, "after": after},
        ))


@mcp.tool(annotations=DESTRUCTIVE)
async def delete_credit_card(card_id: int, keep_expenses: bool, dry_run: bool = True) -> dict[str, Any]:
    """Elimina una tarjeta con TODOS sus resúmenes e ítems.

    `keep_expenses` es obligatorio: true deja los gastos en Egresos, false los
    borra también. Preguntale al usuario. Con ítems compartidos no se puede.

    Args:
        card_id: Tarjeta a eliminar.
        keep_expenses: true = conservar los gastos en Egresos; false = borrarlos.
        dry_run: true = vista previa (default). false = borrar.
    """
    async with tool_session() as db:
        caller = await current_caller(db)
        limit_writes(caller)
        card = await db.scalar(
            select(CreditCard)
            .where(CreditCard.id == card_id, CreditCard.tenant_id == caller.tenant_id)
            .options(
                selectinload(CreditCard.statements)
                .selectinload(CreditCardStatement.items)
                .selectinload(CreditCardItem.shared_expense)
            )
        )
        if card is None:
            raise ToolError(f"No existe la tarjeta {card_id} en este hogar")
        items = [i for s in card.statements for i in s.items]
        _refuse_shared(items, "borrar esta tarjeta")
        snapshot = {
            **_card_dict(card),
            "statements": len(card.statements),
            "items": len(items),
        }
        await delete_card_tree(card, keep_expenses, db)
        await db.flush()
        result = {"action": "delete_card", "card": snapshot, "keep_expenses": keep_expenses}
        return await finish(db, dry_run, result, lambda: audit(
            db, caller, "delete_credit_card",
            f"borrada tarjeta {card_id} ({snapshot['alias']}, {snapshot['statements']} resúmenes, keep_expenses={keep_expenses})",
            {"card_id": card_id, "before": snapshot, "keep_expenses": keep_expenses},
        ))
