"""Quién cargó cada cosa en un hogar con varias personas."""
from contextlib import asynccontextmanager
from datetime import date, datetime
from decimal import Decimal
from types import SimpleNamespace

import pytest

pytest.importorskip("mcp")

from mcp.server.fastmcp.exceptions import ToolError  # noqa: E402
from sqlalchemy import select  # noqa: E402

from app.mcp_server import tools_cards_write, tools_expenses, tools_income, tools_meta  # noqa: E402
from app.mcp_server.context import McpCaller  # noqa: E402
from app.models.credit_card import CreditCard, CreditCardItem  # noqa: E402
from app.models.expense import EXPENSE_SOURCE_MORTGAGE, ExpenseCategory, ExpenseEntry  # noqa: E402
from app.models.income import IncomeEntry, IncomeSource, IncomeType  # noqa: E402
from app.models.tenant import Tenant  # noqa: E402
from app.models.user import User, UserRole  # noqa: E402
from app.routers import credit_cards as card_router  # noqa: E402
from app.routers import expenses as expenses_router  # noqa: E402
from app.routers import income as income_router  # noqa: E402
from app.schemas.credit_card import CreditCardItemCreate, CreditCardItemOut, CreditCardItemUpdate  # noqa: E402
from app.services import analytics, wa_bot  # noqa: E402
from app.services.credit_cards import create_item_in_statement, find_or_create_statement  # noqa: E402
from app.services.people import DELETED_LABEL, people_of  # noqa: E402
from app.services.wa_bot import InboundMessage  # noqa: E402


def _user(id, tenant_id=1, first=None, display=None, **kw):
    return User(
        id=id, firebase_uid=f"uid{id}", tenant_id=tenant_id, email=f"persona{id}@x.com",
        first_name=first, display_name=display or first, **kw,
    )


async def _household(db, *users):
    db.add(Tenant(id=1, name="Casa", code="AAAAAAAA"))
    db.add(Tenant(id=2, name="Otra", code="BBBBBBBB"))
    db.add_all(users)
    cat = ExpenseCategory(tenant_id=1, name="Comida", color="#8b5cf6", is_fixed=False)
    db.add(cat)
    await db.flush()
    return cat


def _expense(cat, user_id, description="súper", **kw):
    return ExpenseEntry(
        tenant_id=1, user_id=user_id, category_id=cat.id, amount=Decimal("100"),
        description=description, expense_date=date(2026, 11, 1), **kw,
    )


async def _list(db, viewer=1, **params):
    defaults = dict(
        year=None, month=None, q=None, category_id=None, currency=None, payee_id=None,
        loaded_by=None, date_from=None, date_to=None, sort="date", order="desc",
    )
    return await expenses_router.list_entries(
        **{**defaults, **params}, firebase_user={"uid": f"uid{viewer}"}, db=db,
    )


async def test_someone_who_left_keeps_their_name_on_what_they_loaded(db):
    cat = await _household(db, _user(1, first="Ana"), _user(2, tenant_id=2, first="Beto"), _user(3, tenant_id=2, first="Caro"))
    db.add(_expense(cat, 2))
    await db.flush()
    # Beto se fue y dejó un gasto; Caro nunca estuvo.
    assert [(p.id, p.name) for p in await people_of(db, 1)] == [(1, "Ana"), (2, "Beto")]


async def test_a_solo_household_has_one_person(db):
    cat = await _household(db, _user(1, first="Ana"))
    db.add(_expense(cat, 1))
    await db.flush()
    assert len(await people_of(db, 1)) == 1


async def test_people_with_the_same_first_name_show_the_full_one(db):
    await _household(
        db, _user(1, first="Ana", display="Ana Gómez"), _user(2, first="ana", display="Ana Ruiz"),
        _user(3, first="Beto", display="Beto Paz"),
    )
    await db.flush()
    assert [p.name for p in await people_of(db, 1)] == ["Ana Gómez", "Ana Ruiz", "Beto"]


async def test_a_deleted_account_never_shows_its_hash(db):
    gone = _user(2, first="a1b2c3", display="a1b2c3", deleted_at=datetime(2026, 11, 1))
    cat = await _household(db, _user(1, first="Ana"), gone)
    db.add(_expense(cat, 2))
    await db.flush()
    assert [p.name for p in await people_of(db, 1)] == ["Ana", DELETED_LABEL]


async def test_nameless_person_does_not_expose_their_mail(db):
    await _household(db, _user(1, first="Ana"), _user(2))
    await db.flush()
    names = [p.name for p in await people_of(db, 1)]
    assert names[1] == "Sin nombre"
    assert not any("@" in n for n in names)


async def test_an_employee_who_only_exists_does_not_count(db):
    # Si contara, el dueño de un negocio vería "Vos" en cada fila.
    await _household(db, _user(1, first="Dueño", role=UserRole.admin), _user(2, first="Empleado", role=UserRole.employee))
    await db.flush()
    assert [p.name for p in await people_of(db, 1)] == ["Dueño"]


async def test_the_daily_sales_income_does_not_count_as_loaded(db):
    await _household(db, _user(1, first="Dueño"), _user(2, tenant_id=2, first="Empleado", role=UserRole.employee))
    source = IncomeSource(tenant_id=1, name="Ventas", income_type=IncomeType.other, system_key="sales")
    db.add(source)
    await db.flush()
    db.add(IncomeEntry(tenant_id=1, user_id=2, source_id=source.id, amount=Decimal("10"), period_date=date(2026, 11, 1)))
    await db.flush()
    assert [p.name for p in await people_of(db, 1)] == ["Dueño"]


async def test_filter_by_who_loaded_it(db):
    cat = await _household(db, _user(1, first="Ana"), _user(2, first="Beto"))
    db.add_all([_expense(cat, 1, "mío"), _expense(cat, 2, "suyo")])
    await db.flush()
    assert [e.description for e in await _list(db, loaded_by=2)] == ["suyo"]


async def test_filter_leaves_out_the_synced_mortgage(db):
    cat = await _household(db, _user(1, first="Ana"))
    db.add_all([_expense(cat, 1, "mío"), _expense(cat, 1, "cuota", source=EXPENSE_SOURCE_MORTGAGE)])
    await db.flush()
    assert [e.description for e in await _list(db, loaded_by=1)] == ["mío"]


async def test_search_finds_what_someone_else_loaded_by_their_name(db):
    cat = await _household(db, _user(1, first="Ana"), _user(2, first="José", display="José Paz"))
    db.add_all([_expense(cat, 1, "mío"), _expense(cat, 2, "suyo")])
    await db.flush()
    assert [e.description for e in await _list(db, q="jose")] == ["suyo"]


async def test_searching_your_own_name_does_not_bring_everything(db):
    # Tu fila dice "Vos": si matcheara tu nombre, no se vería por qué apareció.
    cat = await _household(db, _user(1, first="Ana"))
    db.add(_expense(cat, 1, "súper"))
    await db.flush()
    assert await _list(db, q="ana") == []


async def test_income_search_and_filter_use_who_loaded_it(db):
    await _household(db, _user(1, first="Ana"), _user(2, first="Beto"))
    source = IncomeSource(tenant_id=1, name="Sueldo", income_type=IncomeType.salary)
    db.add(source)
    await db.flush()
    for user_id in (1, 2):
        db.add(IncomeEntry(tenant_id=1, user_id=user_id, source_id=source.id, amount=Decimal("10"), period_date=date(2026, 11, 1)))
    await db.flush()
    params = dict(
        year=None, month=None, q=None, source_id=None, loaded_by=None, date_from=None,
        date_to=None, sort="date", order="desc", firebase_user={"uid": "uid1"}, db=db,
    )
    assert [e.user_id for e in await income_router.list_entries(**{**params, "loaded_by": 2})] == [2]
    assert [e.user_id for e in await income_router.list_entries(**{**params, "q": "beto"})] == [2]


async def test_a_card_item_knows_who_loaded_it_after_being_created(db):
    cat = await _household(db, _user(1, first="Ana"), _user(2, first="Beto"))
    card = CreditCard(id=1, tenant_id=1, user_id=1, bank="BBVA", alias="Visa", due_day=10)
    db.add(card)
    await db.flush()
    statement = await find_or_create_statement(card, 2026, 11, 1, db)
    loader = await db.get(User, 2)
    item = await create_item_in_statement(
        statement, card,
        CreditCardItemCreate(
            description="Nafta", category_id=cat.id, item_date=date(2026, 11, 1),
            item_type="single", amount=Decimal("50"),
        ),
        loader, db,
    )
    await db.commit()
    # El camino de la respuesta del alta: el ítem ya está en la sesión, sin ese
    # valor, y leerlo a destiempo sería un MissingGreenlet.
    out = CreditCardItemOut.model_validate(await card_router._load_item_out(item.id, db))
    assert out.user_id == 2


async def test_the_statement_list_reads_who_loaded_each_item(db):
    cat = await _household(db, _user(1, first="Ana"))
    card = CreditCard(id=1, tenant_id=1, user_id=1, bank="BBVA", alias="Visa", due_day=10)
    db.add(card)
    await db.flush()
    statement = await find_or_create_statement(card, 2026, 11, 1, db)
    entry = _expense(cat, 1)
    db.add(entry)
    await db.flush()
    db.add_all([
        CreditCardItem(statement_id=statement.id, description="con espejo", category_id=cat.id,
                       item_date=date(2026, 11, 1), item_type="single", amount=Decimal("1"), expense_entry_id=entry.id),
        CreditCardItem(statement_id=statement.id, description="sin espejo", category_id=cat.id,
                       item_date=date(2026, 11, 1), item_type="single", amount=Decimal("1")),
    ])
    await db.commit()
    statement_id = statement.id
    db.expire_all()
    items = (await db.scalars(card_router._items_query(statement_id))).all()
    assert {i.description: i.user_id for i in items} == {"con espejo": 1, "sin espejo": None}


async def test_editing_a_card_item_still_answers_with_who_loaded_it(db):
    # Un UPDATE vence el column_property: la respuesta del PATCH tiene que volver a leerlo.
    cat = await _household(db, _user(1, first="Ana"))
    card = CreditCard(id=1, tenant_id=1, user_id=1, bank="BBVA", alias="Visa", due_day=10)
    db.add(card)
    await db.flush()
    statement = await find_or_create_statement(card, 2026, 11, 1, db)
    loader = await db.get(User, 1)
    item = await create_item_in_statement(
        statement, card,
        CreditCardItemCreate(
            description="Nafta", category_id=cat.id, item_date=date(2026, 11, 1),
            item_type="single", amount=Decimal("50"),
        ),
        loader, db,
    )
    await db.commit()
    out = await card_router.update_item(
        item.id, CreditCardItemUpdate(description="Nafta YPF"),
        firebase_user={"uid": "uid1"}, db=db,
    )
    assert CreditCardItemOut.model_validate(out).user_id == 1


# ---------------------------------------------------------- bot de WhatsApp ---

def _says(text, wa_id):
    return InboundMessage(phone="549383", wa_id=wa_id, kind="text", text=text)


async def test_what_the_bot_loads_is_marked_with_who_wrote(db):
    cat = await _household(db, _user(1, first="Ana"), _user(2, first="Beto"))
    db.add(IncomeSource(tenant_id=1, name="Sueldo", income_type=IncomeType.salary))
    db.add(CreditCard(id=1, tenant_id=1, user_id=1, bank="Galicia", alias="Visa", last_4_digits="4919", due_day=10))
    await db.flush()
    ana, beto = SimpleNamespace(id=1, tenant_id=1), SimpleNamespace(id=2, tenant_id=1)

    await wa_bot.handle(db, beto, _says(f"12 lucas {cat.name}", "B1"))
    await wa_bot.handle(db, ana, _says(f"5 lucas {cat.name}", "A1"))
    await wa_bot.handle(db, beto, _says("cobré 850 lucas sueldo", "B2"))
    await wa_bot.handle(db, beto, _says(f"20 lucas nafta categoría {cat.name} con la visa", "B3"))

    who = {e.amount: e.user_id for e in (await db.scalars(select(ExpenseEntry))).all()}
    assert who == {Decimal("12000.00"): 2, Decimal("5000.00"): 1, Decimal("20000.00"): 2}
    income = await db.scalar(select(IncomeEntry))
    assert income.amount == Decimal("850000.00") and income.user_id == 2
    item = await db.scalar(select(CreditCardItem))
    assert item.capture_source == "whatsapp"

    # Y en la lista de la app salen con quien los escribió, como cualquier otro.
    listed = await _list(db, loaded_by=2)
    assert {e.amount for e in listed} == {Decimal("12000.00"), Decimal("20000.00")}
    assert {e.source for e in listed} == {"whatsapp", "credit_card"}


# ---------------------------------------------------------------- conector ---

@pytest.fixture
def connector(db, monkeypatch):
    @asynccontextmanager
    async def _session():
        yield db

    async def _caller(_db):
        return McpCaller(user_id=1, tenant_id=1, scopes=("registrapp:read",), client_name="test")

    for module in (tools_expenses, tools_income, tools_meta, tools_cards_write):
        monkeypatch.setattr(module, "tool_session", _session)
        monkeypatch.setattr(module, "current_caller", _caller)
    return db


async def _two_people_expenses(db):
    cat = await _household(db, _user(1, first="Ana"), _user(2, first="José", display="José Paz"))
    db.add_all([
        _expense(cat, 1, "mío"),
        _expense(cat, 2, "suyo", source="whatsapp"),
        _expense(cat, 1, "cuota", source=EXPENSE_SOURCE_MORTGAGE),
    ])
    await db.flush()
    return cat


RANGE = dict(date_from="2026-11-01", date_to="2026-11-30")


async def test_connector_rows_say_who_loaded_them(connector):
    await _two_people_expenses(connector)
    out = await tools_expenses.list_expenses(**RANGE, group_by="none")
    assert {e["description"]: e["loaded_by"] for e in out["entries"]} == {
        "mío": "Ana", "suyo": "José", "cuota": None,
    }


async def test_connector_filters_by_name_without_accents(connector):
    await _two_people_expenses(connector)
    out = await tools_expenses.list_expenses(**RANGE, loaded_by="jose", group_by="none")
    assert out["total"] == 100 and [e["description"] for e in out["entries"]] == ["suyo"]


async def test_connector_filter_leaves_out_the_mortgage(connector):
    await _two_people_expenses(connector)
    out = await tools_expenses.list_expenses(**RANGE, loaded_by="ana", group_by="none")
    assert [e["description"] for e in out["entries"]] == ["mío"]


async def test_connector_totals_by_person_add_up(connector):
    await _two_people_expenses(connector)
    out = await tools_expenses.list_expenses(**RANGE, group_by="loaded_by")
    assert {g["key"]: g["total"] for g in out["groups"]} == {
        "Ana": 100, "José": 100, analytics.NOBODY_LOADED_IT: 100,
    }
    assert out["total"] == 300


async def test_connector_rejects_a_name_it_cannot_resolve(connector):
    await _household(connector, _user(1, first="Ana", display="Ana Gómez"), _user(2, first="Ana", display="Ana Ruiz"))
    await connector.flush()
    with pytest.raises(ToolError, match="no es nadie"):
        await tools_expenses.list_expenses(**RANGE, loaded_by="Beto")
    with pytest.raises(ToolError, match="más de una persona"):
        await tools_expenses.list_expenses(**RANGE, loaded_by="ana")
    # El nombre completo sí alcanza.
    assert (await tools_expenses.list_expenses(**RANGE, loaded_by="Ana Ruiz"))["count"] == 0


async def test_connector_income_by_person(connector):
    await _household(connector, _user(1, first="Ana"), _user(2, first="Beto"))
    source = IncomeSource(tenant_id=1, name="Sueldo", income_type=IncomeType.salary)
    sales = IncomeSource(tenant_id=1, name="Ventas", income_type=IncomeType.other, system_key="sales")
    connector.add_all([source, sales])
    await connector.flush()
    connector.add_all([
        IncomeEntry(tenant_id=1, user_id=2, source_id=source.id, amount=Decimal("10"), period_date=date(2026, 11, 1)),
        IncomeEntry(tenant_id=1, user_id=1, source_id=sales.id, amount=Decimal("5"), period_date=date(2026, 11, 2)),
    ])
    await connector.flush()

    rows = await tools_income.list_income(**RANGE, group_by="none")
    assert {e["source"]: e["loaded_by"] for e in rows["entries"]} == {"Sueldo": "Beto", "Ventas": None}
    grouped = await tools_income.list_income(**RANGE, group_by="loaded_by")
    assert {g["key"]: g["neto"] for g in grouped["groups"]} == {"Beto": 10, analytics.NOBODY_LOADED_IT: 5}
    filtered = await tools_income.list_income(**RANGE, loaded_by="ana", group_by="none")
    assert filtered["entries"] == []  # El ingreso de ventas no lo cargó nadie.


async def test_connector_taxonomy_lists_people_and_marks_the_caller(connector):
    await _household(connector, _user(1, first="Ana"), _user(2, first="Beto"))
    await connector.flush()
    out = await tools_meta.get_taxonomy()
    assert out["people"] == [{"id": 1, "name": "Ana", "me": True}, {"id": 2, "name": "Beto", "me": False}]


async def test_connector_card_statement_says_who_loaded_each_item(connector):
    cat = await _household(connector, _user(1, first="Ana"), _user(2, first="Beto"))
    card = CreditCard(id=1, tenant_id=1, user_id=1, bank="BBVA", alias="Visa", due_day=10)
    connector.add(card)
    await connector.flush()
    statement = await find_or_create_statement(card, 2026, 11, 1, connector)
    await create_item_in_statement(
        statement, card,
        CreditCardItemCreate(description="Nafta", category_id=cat.id, item_date=date(2026, 11, 1), item_type="single", amount=Decimal("50")),
        await connector.get(User, 2), connector,
    )
    await connector.commit()
    connector.expire_all()
    out = await tools_cards_write.get_card_statement(1, 2026, 11)
    assert [i["loaded_by"] for i in out["items"]] == ["Beto"]
