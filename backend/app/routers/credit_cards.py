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
from app.models.expense import ExpenseEntry, ExpenseCategory
from app.models.credit_card import CreditCard, CreditCardStatement, CreditCardItem
from app.schemas.credit_card import (
    CreditCardCreate, CreditCardUpdate, CreditCardOut,
    StatementCreate, StatementOut,
    CreditCardItemCreate, CreditCardItemUpdate, CreditCardItemOut,
    ForExpenseOut,
)
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.schemas.shared_expense import SharedExpenseOut, ShareCreditCardItemBody

router = APIRouter(prefix="/credit-cards", tags=["credit-cards"])


async def _get_db_user(firebase_user: dict, db: AsyncSession) -> User:
    user = await db.scalar(select(User).where(User.firebase_uid == firebase_user["uid"]))
    if not user:
        raise HTTPException(status_code=401, detail="Usuario no registrado")
    return user


async def _get_or_create_usd_category(tenant_id: int, db: AsyncSession) -> int:
    cat = await db.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            ExpenseCategory.name == "Consumo en dólares",
        )
    )
    if not cat:
        cat = ExpenseCategory(
            tenant_id=tenant_id,
            name="Consumo en dólares",
            color="#22c55e",
            is_fixed=False,
        )
        db.add(cat)
        await db.flush()
    return cat.id


def _items_query(stmt_id: int):
    return (
        select(CreditCardItem)
        .where(CreditCardItem.statement_id == stmt_id)
        .options(
            selectinload(CreditCardItem.category),
            selectinload(CreditCardItem.installment_group),
        )
        .order_by(CreditCardItem.item_date, CreditCardItem.id)
    )


def _statement_query(stmt_id: int):
    return (
        select(CreditCardStatement)
        .where(CreditCardStatement.id == stmt_id)
        .options(
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.category),
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.installment_group),
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.shared_expense),
        )
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
    currency: str = "ARS",
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
        currency=currency,
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
        .options(
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.category),
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.installment_group),
            selectinload(CreditCardStatement.items).selectinload(CreditCardItem.shared_expense),
        )
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
        closing_date=body.closing_date,
        due_date=body.due_date,
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
        # Skip non-root installments (already propagated from create_item)
        if item.installment_group_id is not None:
            continue

        months_done = item.installment_number or 0
        total_months = item.installment_count or 0

        if item.item_type == "installment" and months_done < total_months:
            # Skip if future cuotas already exist (created at item creation time)
            existing_child = await db.scalar(
                select(CreditCardItem).where(CreditCardItem.installment_group_id == item.id).limit(1)
            )
            if existing_child is not None:
                continue

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



# -- For-expense lookup -------------------------------------------------------

@router.get("/for-expense/{expense_entry_id}", response_model=ForExpenseOut)
async def find_statement_for_expense(
    expense_entry_id: int,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    user = await _get_db_user(firebase_user, db)
    item = await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.expense_entry_id == expense_entry_id)
        .options(
            selectinload(CreditCardItem.statement).selectinload(CreditCardStatement.card)
        )
    )
    if not item or item.statement.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="No se encontro el resumen para este gasto")

    # If this is a non-root installment, navigate to root's statement
    if item.installment_group_id:
        root_item = await db.scalar(
            select(CreditCardItem)
            .where(CreditCardItem.id == item.installment_group_id)
            .options(selectinload(CreditCardItem.statement).selectinload(CreditCardStatement.card))
        )
        if root_item and root_item.statement:
            stmt = root_item.statement
            card = stmt.card
            return ForExpenseOut(
                card_id=card.id,
                statement_id=stmt.id,
                card_alias=card.alias,
                card_bank=card.bank,
                year=stmt.year,
                month=stmt.month,
            )

    stmt = item.statement
    card = stmt.card
    return ForExpenseOut(
        card_id=card.id,
        statement_id=stmt.id,
        card_alias=card.alias,
        card_bank=card.bank,
        year=stmt.year,
        month=stmt.month,
    )


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

    category_id = body.category_id
    if body.currency == "USD":
        category_id = await _get_or_create_usd_category(user.tenant_id, db)
    elif category_id is None:
        from fastapi import HTTPException as _HTTPException
        raise _HTTPException(status_code=422, detail="category_id es requerido para gastos en ARS")

    entry = await _create_expense_entry(
        card, body.item_date, body.amount,
        f"{body.description}{cuota_label}",
        category_id, user.tenant_id, user.id, db,
        currency=body.currency,
    )

    item = CreditCardItem(
        statement_id=stmt_id,
        description=body.description,
        category_id=category_id,
        item_date=body.item_date,
        item_type=body.item_type,
        amount=body.amount,
        currency=body.currency,
        installment_count=body.installment_count,
        installment_number=body.installment_number if body.item_type == "installment" else None,
        purchase_total=body.purchase_total,
        expense_entry_id=entry.id,
    )
    db.add(item)
    await db.flush()  # need item.id for installment_group_id

    if body.item_type == "installment" and body.installment_count and body.installment_count > 1:
        for offset in range(1, body.installment_count):
            cuota_n = offset + 1
            future_date = _next_month_date(date(stmt.year, stmt.month, 1), offset)
            future_stmt = await _find_or_create_statement(
                card, future_date.year, future_date.month, user.tenant_id, db
            )
            future_item_date = _next_month_date(body.item_date, offset)
            future_entry = await _create_expense_entry(
                card, future_item_date, body.amount,
                f"{body.description} ({cuota_n}/{body.installment_count})",
                body.category_id, user.tenant_id, user.id, db,
            )
            future_item = CreditCardItem(
                statement_id=future_stmt.id,
                description=body.description,
                category_id=body.category_id,
                item_date=future_item_date,
                item_type="installment",
                amount=body.amount,
                installment_count=body.installment_count,
                installment_number=cuota_n,
                purchase_total=body.purchase_total,
                installment_group_id=item.id,
                expense_entry_id=future_entry.id,
            )
            db.add(future_item)

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
    if item.installment_group_id is not None:
        raise HTTPException(status_code=400, detail="Para editar una cuota, ve al resumen de la cuota 1")

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

    if item.installment_group_id is not None:
        raise HTTPException(status_code=400, detail="Para eliminar, ve al resumen de la cuota 1")

    if item.item_type == "installment" and item.installment_group_id is None:
        # Root installment: always cascade delete all future cuotas
        group_items = await db.scalars(
            select(CreditCardItem).where(CreditCardItem.installment_group_id == item.id)
        )
        for gi in group_items.all():
            if gi.expense_entry_id:
                entry = await db.get(ExpenseEntry, gi.expense_entry_id)
                if entry:
                    await db.delete(entry)
            await db.delete(gi)
        await db.flush()

    if item.expense_entry_id:
        entry = await db.get(ExpenseEntry, item.expense_entry_id)
        if entry:
            await db.delete(entry)
    await db.delete(item)
    await db.commit()


@router.post("/items/{item_id}/share", response_model=list[SharedExpenseOut])
async def share_item(
    item_id: int,
    body: ShareCreditCardItemBody,
    firebase_user: dict = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from app.routers.shared_expenses import (
        _is_email, _is_phone, _normalize_phone, _send_whatsapp_invite, _send_whatsapp_member_notify,
    )
    import secrets
    from datetime import datetime, timedelta

    user = await _get_db_user(firebase_user, db)

    item = await db.scalar(
        select(CreditCardItem)
        .where(CreditCardItem.id == item_id)
        .options(
            selectinload(CreditCardItem.statement).selectinload(CreditCardStatement.card),
            selectinload(CreditCardItem.shared_expense),
        )
    )
    if not item or item.statement.tenant_id != user.tenant_id:
        raise HTTPException(status_code=404, detail="Ítem no encontrado")

    if item.shared_expense:
        raise HTTPException(status_code=400, detail="Este ítem ya fue compartido")

    if item.item_type == "installment" and item.installment_group_id is not None:
        raise HTTPException(status_code=400, detail="Para compartir cuotas, hacelo desde la cuota 1")

    total_splits = sum(s.amount for s in body.splits)
    if abs(total_splits - item.amount) > Decimal("0.01"):
        raise HTTPException(
            status_code=400,
            detail=f"La suma de los montos ({total_splits}) no coincide con el monto del ítem ({item.amount})",
        )

    # Collect all items to share (root + all child cuotas for installments)
    items_to_share = [item]
    if item.item_type == "installment":
        children = await db.scalars(
            select(CreditCardItem)
            .where(CreditCardItem.installment_group_id == item.id)
            .order_by(CreditCardItem.installment_number)
        )
        items_to_share.extend(children.all())

    created_shared_ids = []
    creator_name = user.display_name or user.email

    for target_item in items_to_share:
        shared = SharedExpense(
            tenant_id=user.tenant_id,
            created_by_user_id=user.id,
            title=item.description,
            total_amount=target_item.amount,
            category_id=target_item.category_id,
            split_type=body.split_type,
            expense_date=target_item.item_date,
            credit_card_item_id=target_item.id,
        )
        db.add(shared)
        await db.flush()

        pending_wa_invites = []
        pending_wa_notify = []
        creator_split_amount = None

        for split_in in body.splits:
            is_creator = split_in.user_id == user.id
            resolved_user_id = split_in.user_id
            resolved_name = split_in.member_name
            invite_token = None
            invite_email = None
            invite_expires_at = None

            if split_in.invite_contact and not split_in.user_id:
                contact = split_in.invite_contact.strip()
                if _is_email(contact):
                    from app.models.user import User as _User
                    found = await db.scalar(select(_User).where(_User.email == contact))
                    if found:
                        resolved_user_id = found.id
                        resolved_name = found.display_name or found.email
                        if found.id != user.id:
                            pending_wa_notify.append((found.id, split_in.amount))
                    else:
                        invite_email = contact
                        invite_token = secrets.token_urlsafe(32)
                        invite_expires_at = datetime.utcnow() + timedelta(days=30)
                elif _is_phone(contact):
                    from app.models.user import User as _User
                    normalized_phone = _normalize_phone(contact)
                    found = await db.scalar(select(_User).where(_User.whatsapp_phone == normalized_phone))
                    if found:
                        resolved_user_id = found.id
                        resolved_name = found.display_name or found.email
                        if found.id != user.id:
                            pending_wa_notify.append((found.id, split_in.amount))
                    else:
                        invite_email = normalized_phone
                        invite_token = secrets.token_urlsafe(32)
                        invite_expires_at = datetime.utcnow() + timedelta(days=30)
                        pending_wa_invites.append((normalized_phone, invite_token))
            elif split_in.user_id and split_in.user_id != user.id:
                pending_wa_notify.append((split_in.user_id, split_in.amount))

            split = SharedExpenseSplit(
                shared_expense_id=shared.id,
                user_id=resolved_user_id,
                member_name=resolved_name,
                amount=split_in.amount,
                status="accepted" if is_creator else "pending",
                invite_email=invite_email,
                invite_token=invite_token,
                invite_expires_at=invite_expires_at,
            )
            db.add(split)
            await db.flush()

            if is_creator:
                creator_split_amount = split_in.amount
                # Reuse existing expense_entry, just update the amount to creator's share
                if target_item.expense_entry_id:
                    existing_entry = await db.get(ExpenseEntry, target_item.expense_entry_id)
                    if existing_entry:
                        existing_entry.amount = split_in.amount
                        split.expense_entry_id = existing_entry.id

        # Send notifications after creating all splits
        await db.flush()
        for phone, token in pending_wa_invites:
            await _send_whatsapp_invite(phone, creator_name, item.description, target_item.amount, token)
        for notify_uid, split_amt in pending_wa_notify:
            from app.models.user import User as _User
            notify_user = await db.get(_User, notify_uid)
            if notify_user and notify_user.whatsapp_phone:
                await _send_whatsapp_member_notify(
                    notify_user.whatsapp_phone, creator_name,
                    item.description, target_item.amount, split_amt,
                )

        created_shared_ids.append(shared.id)

    await db.commit()

    results = await db.scalars(
        select(SharedExpense)
        .where(SharedExpense.id.in_(created_shared_ids))
        .options(selectinload(SharedExpense.splits))
    )
    return results.all()
