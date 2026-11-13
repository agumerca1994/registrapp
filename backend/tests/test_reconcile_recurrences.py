"""Conciliación con gastos recurrentes (services/recurrences.py).

- Un mes "a confirmar" que el banco trajo se **confirma** con el monto del
  banco, aunque haya cambiado (se encuentra por el comercio, no por el monto),
  y eso genera el mes siguiente.
- Uno que el banco no trajo no es "sobra": es "no vino este mes", y se decide
  si la serie sigue.
- Un cargo de una serie cuya cadena se cortó se carga enganchado a la serie,
  no como gasto suelto.
- Todo se deshace.
"""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import select

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.reconciliation import ReconciliationAction, ReconciliationSession
from app.models.recurrence import Recurrence
from app.schemas.credit_card import CreditCardItemCreate
from app.services import category_suggest, recurrences
from app.services.credit_cards import create_item_in_statement, find_or_create_statement
from app.services.reconcile import apply_group, resolve_session, undo_last_group
from app.services.reconcile.matching import AppItem, BankItem, match_statement, AMOUNT_DIFF

USER = SimpleNamespace(id=1, tenant_id=1)


def _bank(desc: str, amount: str, day: int) -> dict:
    return {
        "date": f"2026-10-{day:02d}", "description": desc, "cupon": None,
        "amount": amount, "currency": "ARS", "item_type": "single",
        "installment_number": None, "installment_count": None,
    }


async def _setup(db, bank_items: list[dict]):
    category_suggest.invalidate(1)
    cat = ExpenseCategory(tenant_id=1, name="Suscripciones", color="#8b5cf6", is_fixed=True)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa", last_4_digits="4919")
    db.add_all([cat, card])
    await db.flush()
    oct_stmt = await find_or_create_statement(card, 2026, 10, 1, db)
    for desc, amount in (("Netflix", "9500"), ("Spotify", "4500"), ("Disney", "8000")):
        await create_item_in_statement(oct_stmt, card, CreditCardItemCreate(
            description=desc, category_id=cat.id, item_date=date(2026, 9, 20),
            item_type="recurring", amount=Decimal(amount),
        ), USER, db)
    # La cadena de Disney se cortó: alguien borró su mes a confirmar.
    disney = await db.scalar(select(Recurrence).where(Recurrence.description == "Disney"))
    await recurrences.drop_pending(db, (await recurrences.pending_of(db, disney.id)).id)

    nov = await db.scalar(select(CreditCardStatement).where(
        CreditCardStatement.card_id == card.id, CreditCardStatement.month == 11))
    total = sum(Decimal(b["amount"]) for b in bank_items)
    session = ReconciliationSession(
        tenant_id=1, user_id=1, channel="app", status="needs_choice",
        bank_id="bbva", period_year=2026, period_month=11,
        closing_date=date(2026, 11, 28), due_date=date(2026, 12, 9),
        parsed={"bank": "BBVA", "card_label": "VISA", "items": bank_items,
                "block_totals": {"ARS": str(total)}},
    )
    db.add(session)
    await db.flush()
    return cat, card, nov, session


BANK = [_bank("NETFLIX.COM", "10500.00", 20), _bank("DISNEY PLUS", "8000.00", 21)]


async def _actions(db, klass):
    return (await db.scalars(
        select(ReconciliationAction).where(ReconciliationAction.klass == klass)
    )).all()


async def _entry_of(db, description: str, month: int) -> ExpenseEntry | None:
    return await db.scalar(
        select(ExpenseEntry)
        .join(CreditCardItem, CreditCardItem.expense_entry_id == ExpenseEntry.id)
        .join(CreditCardStatement, CreditCardStatement.id == CreditCardItem.statement_id)
        .where(CreditCardItem.description == description, CreditCardStatement.month == month)
    )


def test_matching_finds_a_recurring_by_merchant_with_another_amount():
    bank = [BankItem(0, date(2026, 10, 20), "NETFLIX.COM", Decimal("10500"), "ARS")]
    app = [AppItem(1, date(2026, 10, 20), "Netflix", Decimal("9500"), "ARS", recurrence_id=7,
                   recurrence_status="pending")]
    report = match_statement(bank, app)
    assert [(p.app.id, p.klass) for p in report.pairs] == [(1, AMOUNT_DIFF)]
    assert report.closes


def test_matching_does_not_tie_recurrings_by_an_intermediary_alone():
    """"GOOGLE *YouTube" no es "GOOGLE *Drive": el intermediario no alcanza."""
    bank = [BankItem(0, date(2026, 10, 20), "GOOGLE *YouTube", Decimal("3000"), "ARS")]
    app = [AppItem(1, date(2026, 10, 20), "GOOGLE *Drive", Decimal("2500"), "ARS", recurrence_id=7,
                   recurrence_status="pending")]
    report = match_statement(bank, app)
    assert report.pairs == []


async def test_resolve_proposes_confirm_absent_and_attach(db):
    cat, card, nov, session = await _setup(db, BANK)
    await resolve_session(db, session, USER)

    assert session.statement_id == nov.id
    assert session.status == "ready"
    [confirm] = await _actions(db, "recurring")
    assert confirm.op == "confirm_recurrence"
    assert confirm.payload["amount"] == "10500.00"
    [absent] = await _actions(db, "recurring_absent")
    assert absent.payload["description"] == "Spotify"
    assert absent.payload["keep_going"] is True
    [missing] = await _actions(db, "missing")
    assert missing.payload["recurrence_id"] is not None
    assert missing.payload["description"] == "Disney"
    assert missing.payload["category_id"] == cat.id
    # Nada de "sobra" ni "monto distinto": eso rompería la cadena.
    assert await _actions(db, "surplus") == []
    assert await _actions(db, "amount_diff") == []


async def test_confirm_from_statement_chains_and_undoes(db):
    _, _, _, session = await _setup(db, BANK)
    await resolve_session(db, session, USER)

    await apply_group(db, session, USER, "recurring")
    nov = await _entry_of(db, "Netflix", 11)
    assert nov.recurrence_status == "confirmed"
    assert nov.amount == Decimal("10500.00")
    dec = await _entry_of(db, "Netflix", 12)
    assert dec.recurrence_status == "pending"
    assert dec.amount == Decimal("10500.00")
    series = await db.get(Recurrence, nov.recurrence_id)
    assert series.amount == Decimal("10500.00")
    assert series.bank_description == "NETFLIX.COM"

    await undo_last_group(db, session, USER)
    assert nov.recurrence_status == "pending"
    assert nov.amount == Decimal("9500")
    assert await _entry_of(db, "Netflix", 12) is None
    assert series.amount == Decimal("9500")


async def test_absent_can_end_the_series_and_undo_restores_it(db):
    _, _, _, session = await _setup(db, BANK)
    await resolve_session(db, session, USER)
    [absent] = await _actions(db, "recurring_absent")
    absent.payload = {**absent.payload, "keep_going": False}
    await db.flush()

    await apply_group(db, session, USER, "recurring_absent")
    series = await db.scalar(select(Recurrence).where(Recurrence.description == "Spotify"))
    assert series.status == "ended"
    assert await _entry_of(db, "Spotify", 11) is None
    assert await recurrences.pending_of(db, series.id) is None

    await undo_last_group(db, session, USER)
    assert series.status == "active"
    back = await _entry_of(db, "Spotify", 11)
    assert back.recurrence_status == "pending"
    assert back.recurrence_id == series.id


async def test_absent_keep_going_moves_to_next_month(db):
    _, _, _, session = await _setup(db, BANK)
    await resolve_session(db, session, USER)
    await apply_group(db, session, USER, "recurring_absent")
    assert await _entry_of(db, "Spotify", 11) is None
    assert (await _entry_of(db, "Spotify", 12)).recurrence_status == "pending"


async def test_missing_of_a_broken_chain_attaches_and_undoes(db):
    _, _, _, session = await _setup(db, BANK)
    await resolve_session(db, session, USER)
    await apply_group(db, session, USER, "missing")

    nov = await _entry_of(db, "Disney", 11)
    assert nov.recurrence_status == "confirmed"
    dec = await _entry_of(db, "Disney", 12)
    assert dec is not None and dec.recurrence_status == "pending"

    await undo_last_group(db, session, USER)
    assert await _entry_of(db, "Disney", 11) is None
    assert await _entry_of(db, "Disney", 12) is None


async def test_amount_diff_on_a_confirmed_recurring_moves_series_and_undoes(db):
    """Un recurrente ya confirmado que el banco cobró distinto: es la corrección
    de monto de siempre, y además arrastra a la serie y al mes a confirmar."""
    category_suggest.invalidate(1)
    cat = ExpenseCategory(tenant_id=1, name="Suscripciones", color="#8b5cf6", is_fixed=True)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa", last_4_digits="4919")
    db.add_all([cat, card])
    await db.flush()
    oct_stmt = await find_or_create_statement(card, 2026, 10, 1, db)
    await create_item_in_statement(oct_stmt, card, CreditCardItemCreate(
        description="Netflix", category_id=cat.id, item_date=date(2026, 9, 20),
        item_type="recurring", amount=Decimal("9500"),
    ), USER, db)
    session = ReconciliationSession(
        tenant_id=1, user_id=1, channel="app", status="needs_choice",
        bank_id="bbva", period_year=2026, period_month=10,
        closing_date=date(2026, 10, 28), due_date=date(2026, 11, 9),
        parsed={"bank": "BBVA", "card_label": "VISA", "items": [_bank("NETFLIX.COM", "9900.00", 20)],
                "block_totals": {"ARS": "9900.00"}},
    )
    db.add(session)
    await db.flush()
    await resolve_session(db, session, USER)
    [diff] = await _actions(db, "amount_diff")

    await apply_group(db, session, USER, "amount_diff")
    oct_entry = await _entry_of(db, "Netflix", 10)
    series = await db.get(Recurrence, oct_entry.recurrence_id)
    assert series.amount == Decimal("9900.00")
    assert (await _entry_of(db, "Netflix", 11)).amount == Decimal("9900.00")

    await undo_last_group(db, session, USER)
    assert series.amount == Decimal("9500")
    assert (await _entry_of(db, "Netflix", 11)).amount == Decimal("9500")
