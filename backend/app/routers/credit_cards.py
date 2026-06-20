from calendar import monthrange
from datetime import date
from decimal import Decimal

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.firebase import get_current_user
from app.models.user import User
from app.models.expense import ExpenseEntry
from app.models.credit_card import CreditCard, CreditCardStatement, CreditCardItem
from app.schemas.credit_card import (
    CreditCardCreate, CreditCardUpdate, CreditCardOut,
    StatementCreate, StatementOut,
    CreditCardItemCreate, CreditCardItemUpdate, CreditCardItemOut,
)

router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


def _items_query(stmt_id: int):
    return (
        select(CreditCardItem)
        .where(CreditCardItem.statement_id == stmt_id)
        .options(selectinload(CreditCardItem.category))
        .order_by(CreditCardItem.item_date, CreditCardItem.id)
    )


def _statement_query(stmt_id: int):
    return (
        select(CreditCardStatement)
        .where(CreditCardStatement.id == stmt_id)
        .options(selectinload(CreditCardStatement.items).selectinload(CreditCardItem.category))
    )


def _next_month_date(d: date, months_ahead: int) -> date:
    month = d.month + months_ahead
    year = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


async def _find_or_create_statement(
    card: CreditCard, year: int, month: int, tenant_id: int, db: AsyncSession
) -> CreditCardStatement:
    stmt = await db.scalar(
        select(CreditCardStatement).where(
            CreditCardStatement.card_id == card.id,
            CreditCardStatement.year == year,
            CreditCardStatement.month == month,
        )
    )
    if not stmt:
        stmt = CreditCardStatement(
            tenant_id=tenant_id,
            card_id=card.id,
            year=year,
            month=month,
            status="open",
        )
        db.add(stmt)
        await db.flush()
    return stmt


async def _create_expense_entry(
    card: CreditCard,
    item_date: date,
    amount: Decimal,
    description: str,
    category_id: int,
    tenant_id: int,
    user_id: int,
    db: AsyncSession,
) -> ExpenseEntry:
    entry = ExpenseEntry(
        tenant_id=tenant_id,
        user_id=user_id,
        category_id=category_id,
        amount=amount,
        description=description,
        expense_date=item_date,
        payment_method="tarjeta_credito",
        entity=card.bank,
    )
    db.add(entry)
    await db.flush()
    return entry


# -- Cards --------------------------------------------------------------------

@router.get("", response_model=list[CreditCardOut])
async def list_cards(
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    result = await db.scalars(
        select(CreditCard)
        .where(CreditCard.tenant_id == user.tenant_id)
        .order_by(CreditCard.bank, CreditCard.alias)
    )
    return result.all()


@router.post("", response_model=CreditCardOut, status_code=status.HTTP_201_CREATED)
async def create_card(
    body: CreditCardCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    card = CreditCard(**body.model_dump(), tenant_id=user.tenant_id, user_id=user.id)
    db.add(card)
    await db.commit()
    await db.refresh(card)
    return card


@router.patch("/{card_id}", response_model=CreditCardOut)
async def update_card(
    card_id: int,
    body: CreditCardUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    card = await db.get(CreditCard, card_id)
    if not card or card.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")
    for field, value in body.model_dump(exclude_none=True).items():
        setattr(card, field, value)
    await db.commit()
    await db.refresh(card)
    return card


@router.delete("/{card_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_card(
    card_id: int,
    keep_expenses: bool = Query(default=True),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    card = await db.scalar(
        select(CreditCard)
        .where(CreditCard.id == card_id, CreditCard.tenant_id == user.tenant_id)
        .options(
            selectinload(CreditCard.statements).selectinload(CreditCardStatement.items)
        )
    )
    if not card:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    if not keep_expenses:
        for stmt in card.statements:
            for item in stmt.items:
                if item.expense_entry_id:
                    entry = await db.get(ExpenseEntry, item.expense_entry_id)
                    if entry:
                        await db.delete(entry)
        await db.flush()

    await db.delete(card)
    await db.commit()


# -- Statements ---------------------------------------------------------------

@router.get("/{card_id}/statements", response_model=list[StatementOut])
async def list_statements(
    card_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    card = await db.get(CreditCard, card_id)
    if not card or card.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    stmts = await db.scalars(
        select(CreditCardStatement)
        .where(CreditCardStatement.card_id == card_id)
        .options(selectinload(CreditCardStatement.items).selectinload(CreditCardItem.category))
        .order_by(CreditCardStatement.year.desc(), CreditCardStatement.month.desc())
    )
    return [StatementOut.from_orm_with_total(s) for s in stmts.all()]


@router.post("/{card_id}/statements", response_model=StatementOut, status_code=status.HTTP_201_CREATED)
async def create_statement(
    card_id: int,
    body: StatementCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    card = await db.get(CreditCard, card_id)
    if not card or card.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Tarjeta no encontrada")

    existing = await db.scalar(
        select(CreditCardStatement).where(
            CreditCardStatement.card_id == card_id,
            CreditCardStatement.year == body.year,
            CreditCardStatement.month == body.month,
        )
    )
    if existing:
        raise HTTPException(status_code=409, detail="Ya existe un resumen para ese mes")

    stmt = CreditCardStatement(
        tenant_id=user.tenant_id,
        card_id=card_id,
        year=body.year,
        month=body.month,
        status="open",
    )
    db.add(stmt)
    await db.commit()
    result = await db.scalar(_statement_query(stmt.id))
    return StatementOut.from_orm_with_total(result)


@router.delete("/statements/{stmt_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_statement(
    stmt_id: int,
    keep_expenses: bool = Query(default=True),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    stmt = await db.scalar(
        select(CreditCardStatement)
        .where(CreditCardStatement.id == stmt_id)
        .options(
            selectinload(CreditCardStatement.card),
            selectinload(CreditCardStatement.items),
        )
    )
    if not stmt or stmt.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Resumen no encontrado")

    if not keep_expenses:
        for item in stmt.items:
            if item.expense_entry_id:
                entry = await db.get(ExpenseEntry, item.expense_entry_id)
                if entry:
                    await db.delete(entry)
        await db.flush()

    await db.delete(stmt)
    await db.commit()


@router.post("/statements/{stmt_id}/finalize", response_model=StatementOut)
async def finalize_statement(
    stmt_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    stmt = await db.scalar(
        select(CreditCardStatement)
        .where(CreditCardStatement.id == stmt_id)
        .options(
            selectinload(CreditCardStatement.card),
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.category),
        )
    )
    if not stmt or stmt.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Resumen no encontrado")
    if stmt.status == "closed":
        raise HTTPException(status_code=400, detail="El resumen ya esta cerrado")

    card = stmt.card

    for item in list(stmt.items):
        months_done = item.installment_number or 0
        total_months = item.installment_count or 0

        if item.item_type == "installment" and months_done < total_months:
            group_id = item.installment_group_id or item.id
            remaining = total_months - months_done
            for offset in range(1, remaining + 1):
                future_date = _next_month_date(date(stmt.year, stmt.month, 1), offset)
                future_stmt = await _find_or_create_statement(
                    card, future_date.year, future_date.month, user.tenant_id, db
                )
                future_item_date = _next_month_date(item.item_date, offset)
                future_entry = await _create_expense_entry(
                    card, future_item_date, item.amount,
                    f"{item.description} ({months_done + offset}/{total_months})",
                    item.category_id, user.tenant_id, user.id, db,
                )
                future_item = CreditCardItem(
                    statement_id=future_stmt.id,
                    description=item.description,
                    category_id=item.category_id,
                    item_date=future_item_date,
                    item_type="installment",
                    amount=item.amount,
                    installment_count=total_months,
                    installment_number=months_done + offset,
                    purchase_total=item.purchase_total,
                    installment_group_id=group_id,
                    expense_entry_id=future_entry.id,
                )
                db.add(future_item)

        elif item.item_type == "recurring":
            future_date = _next_month_date(date(stmt.year, stmt.month, 1), 1)
            future_stmt = await _find_or_create_statement(
                card, future_date.year, future_date.month, user.tenant_id, db
            )
            future_item_date = _next_month_date(item.item_date, 1)
            future_entry = await _create_expense_entry(
                card, future_item_date, item.amount,
                item.description, item.category_id, user.tenant_id, user.id, db,
            )
            future_item = CreditCardItem(
                statement_id=future_stmt.id,
                description=item.description,
                category_id=item.category_id,
                item_date=future_item_date,
                item_type="recurring",
                amount=item.amount,
                expense_entry_id=future_entry.id,
            )
            db.add(future_item)

    stmt.status = "closed"
    await db.commit()
    result = await db.scalar(_statement_query(stmt_id))
    return StatementOut.from_orm_with_total(result)


# -- Items --------------------------------------------------------------------

@router.get("/statements/{stmt_id}/items", response_model=list[CreditCardItemOut])
async def list_items(
    stmt_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    stmt = await db.get(CreditCardStatement, stmt_id)
    if not stmt or stmt.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Resumen no encontrado")
    result = await db.scalars(_items_query(stmt_id))
    return result.all()


@router.post("/statements/{stmt_id}/items", response_model=CreditCardItemOut, status_code=status.HTTP_201_CREATED)
async def create_item(
    stmt_id: int,
    body: CreditCardItemCreate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    stmt = await db.scalar(
        select(CreditCardStatement)
        .where(CreditCardStatement.id == stmt_id)
        .options(selectinload(CreditCardStatement.card))
    )
    if not stmt or stmt.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Resumen no encontrado")

    card = stmt.card
    cuota_label = ""
    if body.item_type == "installment":
        cuota_label = f" ({body.installment_number}/{body.installment_count})"

    entry = await _create_expense_entry(
        card, body.item_date, body.amount,
        f"{body.description}{cuota_label}",
        body.category_id, user.tenant_id, user.id, db,
    )

    item = CreditCardItem(
        statement_id=stmt_id,
        description=body.description,
        category_id=body.category_id,
        item_date=body.item_date,
        item_type=body.item_type,
        amount=body.amount,
        installment_count=body.installment_count,
        installment_number=body.installment_number if body.item_type == "installment" else None,
        purchase_total=body.purchase_total,
        expense_entry_id=entry.id,
    )
    db.add(item)
    await db.commit()

    result = await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.id == item.id)
        .options(selectinload(CreditCardItem.category))
    )
    return result


@router.patch("/items/{item_id}", response_model=CreditCardItemOut)
async def update_item(
    item_id: int,
    body: CreditCardItemUpdate,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    item = await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.id == item_id)
        .options(
            selectinload(CreditCardItem.statement).selectinload(CreditCardStatement.card),
            selectinload(CreditCardItem.category),
        )
    )
    if not item or item.statement.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Item no encontrado")

    updates = body.model_dump(exclude_none=True)
    for field, value in updates.items():
        setattr(item, field, value)

    if item.expense_entry_id:
        entry = await db.get(ExpenseEntry, item.expense_entry_id)
        if entry:
            if "description" in updates:
                entry.description = updates["description"]
            if "category_id" in updates:
                entry.category_id = updates["category_id"]
            if "item_date" in updates:
                entry.expense_date = updates["item_date"]
            if "amount" in updates:
                entry.amount = updates["amount"]

    await db.commit()
    result = await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.id == item_id)
        .options(selectinload(CreditCardItem.category))
    )
    return result


@router.delete("/items/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(
    item_id: int,
    delete_group: bool = Query(default=False),
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    item = await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.id == item_id)
        .options(selectinload(CreditCardItem.statement))
    )
    if not item or item.statement.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Item no encontrado")

    if delete_group and (item.installment_group_id or item.item_type == "installment"):
        group_root_id = item.installment_group_id or item.id
        group_items = await db.scalars(
            select(CreditCardItem).where(
                (CreditCardItem.id == group_root_id)
                | (CreditCardItem.installment_group_id == group_root_id)
            )
        )
        for gi in group_items.all():
            if gi.expense_entry_id:
                entry = await db.get(ExpenseEntry, gi.expense_entry_id)
                if entry:
                    await db.delete(entry)
            await db.delete(gi)
    else:
        if item.expense_entry_id:
            entry = await db.get(ExpenseEntry, item.expense_entry_id)
            if entry:
                await db.delete(entry)
        await db.delete(item)

    await db.commit()
