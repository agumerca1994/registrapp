"""Integración del motor de conciliación: sesión → acciones → aplicar → deshacer."""
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.reconciliation import ReconciliationAction, ReconciliationSession
from app.schemas.credit_card import CreditCardItemCreate
from app.services import category_suggest
from app.services.credit_cards import create_item_in_statement, find_or_create_statement
from app.services.reconcile import apply_group, resolve_session, undo_last_group

USER = SimpleNamespace(id=1, tenant_id=1)

BANK_ITEMS = [
    {
        "date": "2026-09-21", "description": "CEBRA ARCOS", "cupon": "123456",
        "amount": "13330.00", "currency": "ARS", "item_type": "single",
        "installment_number": None, "installment_count": None,
    },
    {
        "date": "2026-09-10", "description": "VERDULERIA DON PEPE", "cupon": "654321",
        "amount": "16500.00", "currency": "ARS", "item_type": "single",
        "installment_number": None, "installment_count": None,
    },
]


async def _setup(db):
    category_suggest.invalidate(1)
    cat = ExpenseCategory(tenant_id=1, name="Varios", color="#ef4444", is_fixed=False)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa Black", last_4_digits="4919")
    db.add_all([cat, card])
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 9, 1, db)

    # Lo ya cargado: el ítem que matchea y un sobrante.
    for desc, amount in (("Librería Cebra", "13330.00"), ("Gasto viejo", "9999.00")):
        await create_item_in_statement(
            stmt, card,
            CreditCardItemCreate(
                description=desc, category_id=cat.id, item_date=date(2026, 9, 21),
                item_type="single", amount=Decimal(amount),
            ),
            USER, db,
        )

    session = ReconciliationSession(
        tenant_id=1, user_id=1, channel="app", status="needs_choice",
        bank_id="bbva", period_year=2026, period_month=9,
        closing_date=date(2026, 10, 1), due_date=date(2026, 10, 9),
        parsed={
            "bank": "BBVA", "card_label": "VISA SIGNATURE",
            "items": BANK_ITEMS,
            "block_totals": {"ARS": "29830.00"},
        },
    )
    db.add(session)
    await db.flush()
    return cat, card, stmt, session


async def test_resolve_builds_groups_and_closes(db):
    cat, card, stmt, session = await _setup(db)
    await resolve_session(db, session, USER)

    # Única tarjeta del hogar y resumen del mismo período: sin preguntas.
    assert session.card_id == card.id
    assert session.statement_id == stmt.id
    assert session.status == "ready"

    actions = (await db.scalars(select(ReconciliationAction))).all()
    by_klass = {}
    for a in actions:
        by_klass.setdefault(a.klass, []).append(a)

    # El resumen no tenía fechas: se propone completarlas con las del PDF.
    assert "dates" in by_klass
    # Faltante y sobrante detectados; el cierre explica la diferencia.
    assert by_klass["missing"][0].payload["description"] == "VERDULERIA DON PEPE"
    assert by_klass["missing"][0].payload["bank_coupon"] == "654321"
    assert by_klass["surplus"][0].payload["description"] == "Gasto viejo"
    assert Decimal(session.totals["ARS"]["unexplained"]) == 0


async def test_apply_missing_requires_category_then_creates(db):
    cat, card, stmt, session = await _setup(db)
    await resolve_session(db, session, USER)
    missing = await db.scalar(
        select(ReconciliationAction).where(ReconciliationAction.klass == "missing")
    )

    # Sin categoría (ARS) no se aplica: queda propuesto y el resultado lo dice.
    if missing.payload.get("category_id") is None:
        result = await apply_group(db, session, USER, "missing")
        assert result["applied"] == 0
        assert result["skipped"][0]["reason"] == "sin_categoria"

        missing.payload = {**missing.payload, "category_id": cat.id}
        await db.flush()

    result = await apply_group(db, session, USER, "missing")
    assert result["applied"] == 1
    assert session.status == "applied"

    created = await db.scalar(
        select(CreditCardItem).where(CreditCardItem.description == "VERDULERIA DON PEPE")
    )
    assert created is not None
    assert created.bank_coupon == "654321"
    assert created.capture_source == "reconcile"
    # El match exacto quedó estampado con su cupón para la próxima conciliación.
    cebra = await db.scalar(
        select(CreditCardItem).where(CreditCardItem.description == "Librería Cebra")
    )
    assert cebra.bank_coupon == "123456"


async def test_apply_dates_and_surplus_then_undo(db):
    cat, card, stmt, session = await _setup(db)
    await resolve_session(db, session, USER)

    await apply_group(db, session, USER, "dates")
    assert stmt.closing_date == date(2026, 10, 1)
    assert stmt.due_date == date(2026, 10, 9)

    old_item = await db.scalar(
        select(CreditCardItem).where(CreditCardItem.description == "Gasto viejo")
    )
    entry_id = old_item.expense_entry_id
    await apply_group(db, session, USER, "surplus")
    assert await db.get(CreditCardItem, old_item.id) is None
    assert await db.get(ExpenseEntry, entry_id) is None

    # Deshacer el último grupo (surplus) recrea el ítem y su egreso espejo.
    result = await undo_last_group(db, session, USER)
    assert result["undone"] == 1
    restored = await db.scalar(
        select(CreditCardItem).where(CreditCardItem.description == "Gasto viejo")
    )
    assert restored is not None
    assert restored.amount == Decimal("9999.00")
    entry = await db.get(ExpenseEntry, restored.expense_entry_id)
    assert entry is not None and entry.amount == Decimal("9999.00")

    # Sin más grupos aplicados después del undo de dates, deshacer de nuevo
    # revierte las fechas; una tercera vez es 400.
    await undo_last_group(db, session, USER)
    assert stmt.closing_date is None
    with pytest.raises(HTTPException):
        await undo_last_group(db, session, USER)


async def test_missing_cuota_applies_with_scope_item_semantics(db):
    """Un faltante en cuotas de un resumen que no es el más nuevo se crea sin
    propagar (las cuotas siguientes pueden ya estar cargadas a mano)."""
    cat, card, stmt, session = await _setup(db)
    # Un resumen más nuevo ya existe: 2026-09 deja de ser el último.
    await find_or_create_statement(card, 2026, 10, 1, db)

    session.parsed = {
        **session.parsed,
        "items": session.parsed["items"] + [{
            "date": "2026-07-15", "description": "GAZEBO JARDIN", "cupon": "999111",
            "amount": "3000.00", "currency": "ARS", "item_type": "installment",
            "installment_number": 3, "installment_count": 12,
        }],
        "block_totals": {"ARS": "32830.00"},
    }
    await resolve_session(db, session, USER)

    gazebo = await db.scalar(
        select(ReconciliationAction).where(
            ReconciliationAction.klass == "missing",
        ).where(ReconciliationAction.payload["description"].as_string() == "GAZEBO JARDIN")
    )
    gazebo.payload = {**gazebo.payload, "category_id": cat.id}
    verdu = await db.scalar(
        select(ReconciliationAction).where(
            ReconciliationAction.payload["description"].as_string() == "VERDULERIA DON PEPE"
        )
    )
    verdu.payload = {**verdu.payload, "category_id": cat.id}
    await db.flush()

    result = await apply_group(db, session, USER, "missing")
    assert result["applied"] == 2
    assert result["propagated_future_cuotas"] is False

    cuotas = (
        await db.scalars(
            select(CreditCardItem).where(CreditCardItem.description == "GAZEBO JARDIN")
        )
    ).all()
    # Sólo la cuota 3/12 del resumen conciliado — nada propagado.
    assert len(cuotas) == 1
    assert cuotas[0].installment_number == 3


BBVA_AGO = __import__("pathlib").Path(__file__).parent / "fixtures" / "private" / "bbva_2026-08_lines.txt"


@pytest.mark.skipif(not BBVA_AGO.exists(), reason="fixture privado ausente")
async def test_start_session_from_text_real_statement(db):
    """El resumen real de agosto entra como texto (el camino del conector MCP)
    y el motor lo lleva hasta una sesión que cierra: resumen nuevo creado en
    2026-08 con todos los ítems como faltantes."""
    category_suggest.invalidate(1)
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa Black", last_4_digits="4919")
    db.add(card)
    await db.flush()

    from app.services.reconcile.engine import start_session

    session = await start_session(db, user=USER, text=BBVA_AGO.read_text(encoding="utf-8"))

    assert session.status == "ready"
    assert session.bank_id == "bbva"
    assert (session.period_year, session.period_month) == (2026, 8)
    # Única tarjeta: elegida sola; resumen nuevo creado con las fechas del PDF.
    stmt = await db.get(CreditCardStatement, session.statement_id)
    assert stmt.card_id == card.id
    assert stmt.closing_date == date(2026, 8, 27)

    actions = (await db.scalars(select(ReconciliationAction))).all()
    missing = [a for a in actions if a.klass == "missing"]
    assert len(missing) == 31  # todo faltante: el resumen de la app nace vacío
    # La diferencia es exactamente la suma de faltantes → cierra en ambas monedas.
    assert Decimal(session.totals["ARS"]["unexplained"]) == 0
    assert Decimal(session.totals["USD"]["unexplained"]) == 0

    # El embudo registró el intento como resuelto por código.
    from app.models.reconciliation import CaptureEvent
    ev = await db.scalar(select(CaptureEvent).order_by(CaptureEvent.id.desc()))
    assert ev.outcome == "parsed_code"
    assert ev.input_kind == "text"
    assert ev.bank_detected == "bbva"
