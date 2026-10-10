"""Las tools `save_expense` / `delete_expense` del conector, ejecutadas de punta
a punta sobre el SQLite de los tests.

Lo que el test del servicio no puede ver y éste sí: que la vista previa
(`dry_run=True`) es la escritura real deshecha — no queda nada guardado —, que
el modo real sí guarda, y que los espejos de tarjeta se rechazan en la tool.
Se reemplazan sólo la sesión, el usuario del token y la auditoría (que escribe
en `app_logs`, una tabla con JSONB que SQLite no puede crear).
"""
from contextlib import asynccontextmanager
from datetime import date
from decimal import Decimal
from types import SimpleNamespace

import pytest

pytest.importorskip("mcp")

from mcp.server.fastmcp.exceptions import ToolError  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.mcp_server import tools_expenses_write as tools  # noqa: E402
from app.mcp_server.context import McpCaller  # noqa: E402
from app.models.credit_card import CreditCard  # noqa: E402
from app.models.expense import ExpenseCategory, ExpenseEntry  # noqa: E402
from app.schemas.credit_card import CreditCardItemCreate  # noqa: E402
from app.services.credit_cards import create_item_in_statement, find_or_create_statement  # noqa: E402

CALLER = McpCaller(user_id=1, tenant_id=1, scopes=("registrapp:read",), client_name="test")


@pytest.fixture
def wired(db, monkeypatch):
    """Las tools usan la sesión del test y un usuario fijo."""
    @asynccontextmanager
    async def _session():
        yield db

    async def _caller(_db):
        return CALLER

    async def _audit(*args, **kwargs):
        return None

    monkeypatch.setattr(tools, "tool_session", _session)
    monkeypatch.setattr(tools, "current_caller", _caller)
    monkeypatch.setattr(tools, "audit", _audit)
    return db


async def _cat(db, name):
    cat = ExpenseCategory(tenant_id=1, name=name, color="#22c55e", is_fixed=False)
    db.add(cat)
    await db.commit()
    return cat


async def _count(db):
    return len((await db.scalars(select(ExpenseEntry))).all())


async def test_preview_saves_nothing_and_real_run_saves(wired):
    db = wired
    await _cat(db, "Verdulería")

    preview = await tools.save_expense(
        amount=12000, expense_date="2026-10-09", description="Verdu", category="verduleria",
        payment_method="efectivo",
    )
    assert preview["dry_run"] is True
    assert preview["entry"]["category"] == "Verdulería"  # por nombre, sin tilde
    assert preview["entry"]["id"] is None
    assert await _count(db) == 0  # la vista previa es la escritura deshecha

    saved = await tools.save_expense(
        amount=12000, expense_date="2026-10-09", description="Verdu", category="Verdulería",
        dry_run=False,
    )
    assert saved["dry_run"] is False
    assert await _count(db) == 1
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.source == "mcp"
    assert entry.amount == Decimal("12000.00")


async def test_duplicate_warning(wired):
    db = wired
    await _cat(db, "Kiosco")
    await tools.save_expense(amount=500, expense_date="2026-10-09", category="Kiosco", dry_run=False)
    again = await tools.save_expense(amount=500, expense_date="2026-10-10", category="Kiosco")
    assert again["warnings"] and "mismo monto" in again["warnings"][0]


async def test_edit_and_delete_simple_expense(wired):
    db = wired
    await _cat(db, "Kiosco")
    await _cat(db, "Varios")
    await tools.save_expense(amount=500, expense_date="2026-10-09", category="Kiosco", dry_run=False)
    entry = await db.scalar(select(ExpenseEntry))

    edited = await tools.save_expense(entry_id=entry.id, amount=650, category="varios", dry_run=False)
    assert edited["before"]["amount"] == 500
    assert edited["entry"]["amount"] == 650
    assert edited["entry"]["category"] == "Varios"

    await tools.delete_expense(entry_id=entry.id, dry_run=False)
    assert await _count(db) == 0


async def test_card_mirror_is_refused(wired):
    db = wired
    cat = await _cat(db, "Super")
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa")
    db.add(card)
    await db.flush()
    stmt = await find_or_create_statement(card, 2026, 10, 1, db)
    item = await create_item_in_statement(
        stmt, card,
        CreditCardItemCreate(description="SUPER", category_id=cat.id, item_date=date(2026, 10, 2),
                             item_type="single", amount=Decimal("8000")),
        SimpleNamespace(id=1, tenant_id=1), db,
    )
    await db.commit()

    with pytest.raises(ToolError, match="tarjeta"):
        await tools.save_expense(entry_id=item.expense_entry_id, amount=9000)
    with pytest.raises(ToolError, match="tarjeta"):
        await tools.delete_expense(entry_id=item.expense_entry_id)


async def test_validation_errors(wired):
    db = wired
    await _cat(db, "Kiosco")
    with pytest.raises(ToolError, match="faltan"):
        await tools.save_expense(category="Kiosco")
    with pytest.raises(ToolError, match="positivo"):
        await tools.save_expense(amount=-5, expense_date="2026-10-09", category="Kiosco")
    with pytest.raises(ToolError, match="No hay una categoría"):
        await tools.save_expense(amount=5, expense_date="2026-10-09", category="Inexistente")
    with pytest.raises(ToolError, match="payment_method"):
        await tools.save_expense(amount=5, expense_date="2026-10-09", category="Kiosco",
                                 payment_method="tarjeta")
    with pytest.raises(ToolError, match="No hay un egreso"):
        await tools.delete_expense(entry_id=9999)
