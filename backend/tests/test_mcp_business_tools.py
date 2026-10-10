"""Las tools del negocio del conector (tools_business, más `save_expense` con
`payee` y `stock_lines`), de punta a punta sobre el SQLite de los tests.

Lo que importa de cada una: la vista previa es la escritura real deshecha
(no queda nada), el modo real guarda con los mismos servicios que la app, y en
un hogar no hay nada que tocar. Se reemplazan la sesión, el usuario del token,
la auditoría (escribe en `app_logs`, con JSONB) y el límite por hora.
"""
from contextlib import asynccontextmanager
from decimal import Decimal

import pytest

pytest.importorskip("mcp")

from mcp.server.fastmcp.exceptions import ToolError  # noqa: E402
from sqlalchemy import func, select  # noqa: E402

from app.mcp_server import tools_business as biz, tools_expenses_write as exp_tools, tools_meta  # noqa: E402
from app.mcp_server.context import McpCaller  # noqa: E402
from app.models.business import Sale, StockMovement  # noqa: E402
from app.models.expense import ExpenseCategory, ExpenseEntry  # noqa: E402
from app.models.income import IncomeEntry  # noqa: E402
from app.models.tenant import Tenant  # noqa: E402
from app.services.business import payees, products, stock  # noqa: E402

D = Decimal
CALLER = McpCaller(user_id=1, tenant_id=1, scopes=("registrapp:read",), client_name="test")
DAY = "2026-10-09"


@pytest.fixture
def wired(db, monkeypatch):
    @asynccontextmanager
    async def _session():
        yield db

    async def _caller(_db):
        return CALLER

    async def _audit(*args, **kwargs):
        return None

    for module in (biz, exp_tools, tools_meta):
        monkeypatch.setattr(module, "tool_session", _session)
        monkeypatch.setattr(module, "current_caller", _caller)
    for module in (biz, exp_tools):
        monkeypatch.setattr(module, "audit", _audit)
        monkeypatch.setattr(module, "limit_writes", lambda caller: None)
    return db


async def _business(db):
    db.add(Tenant(id=1, name="Rotisería", kind="business"))
    await db.flush()
    empanada = await products.create_product(
        db, 1, name="Empanada de carne", sale_price=D(1500), track_stock=True,
    )
    coca = await products.create_product(db, 1, name="Coca-Cola", kind="reventa", sale_price=D(2500))
    await db.commit()
    return empanada, coca


async def _count(db, model):
    return await db.scalar(select(func.count()).select_from(model))


async def _level(db, product):
    return (await stock.on_hand(db, 1, [product.id])).get(product.id, D(0))


async def test_a_household_has_nothing_to_touch(wired):
    db = wired
    db.add(Tenant(id=1, name="Casa", kind="household"))
    db.add(ExpenseCategory(tenant_id=1, name="Varios", color="#000000", is_fixed=False))
    await db.commit()
    with pytest.raises(ToolError, match="negocio"):
        await biz.get_sales(date_from=DAY, date_to=DAY)
    with pytest.raises(ToolError, match="negocio"):
        await biz.record_sale(sale_date=DAY, amount=1000)
    with pytest.raises(ToolError, match="negocio"):
        await exp_tools.save_expense(amount=1000, expense_date=DAY, category="Varios", payee="juan")


async def test_record_sale_preview_saves_nothing_and_real_run_saves(wired):
    db = wired
    await _business(db)
    lines = [{"product": "empanadas", "qty": 3}, {"product": "coca", "qty": 1}]

    preview = await biz.record_sale(sale_date=DAY, lines=lines, amount=6500)
    assert preview["dry_run"] is True and preview["sale"]["id"] is None
    assert [ln["product"] for ln in preview["sale"]["lines"]] == ["Empanada de carne", "Coca-Cola"]
    assert preview["sale"]["payments"] == [{"method": "efectivo", "amount": 6500.0}]
    assert preview["day"]["total"] == 6500.0
    assert any("Coca-Cola queda en -1" in w for w in preview["warnings"])
    assert await _count(db, Sale) == 0 and await _count(db, IncomeEntry) == 0

    saved = await biz.record_sale(sale_date=DAY, lines=lines, amount=6500, dry_run=False)
    assert saved["note"] == "Guardado."
    assert (await db.scalar(select(Sale))).source == "mcp"
    assert (await db.scalar(select(IncomeEntry))).amount == D(6500)
    # La misma venta otra vez: avisa del posible duplicado.
    again = await biz.record_sale(sale_date=DAY, lines=lines, amount=6500)
    assert any("ya hay una venta" in w for w in again["warnings"])


async def test_sale_lines_by_name_list_price_and_free_text(wired):
    db = wired
    await _business(db)
    await products.create_product(db, 1, name="Empanada de pollo", sale_price=D(1500))
    await db.commit()
    with pytest.raises(ToolError, match="puede ser"):
        await biz.record_sale(sale_date=DAY, lines=[{"product": "empanada", "qty": 2}], amount=3000)

    res = await biz.record_sale(
        sale_date=DAY, lines=[{"product": "Coca-Cola", "qty": 2}, {"product": "tarta", "qty": 1, "unit_price": 4000}],
    )
    # Sin monto: los precios de lista. "tarta" no es un producto: queda como texto.
    assert res["sale"]["total"] == 9000.0
    assert res["sale"]["lines"][1] == {
        "product_id": None, "product": None, "description": "tarta", "qty": 1.0, "unit_price": 4000.0,
    }
    assert any("«tarta»" in w for w in res["warnings"])
    assert any("precios de lista" in w for w in res["warnings"])


async def test_the_daily_close_counts_compares_and_keeps_its_units(wired):
    db = wired
    empanada, _ = await _business(db)
    await biz.record_sale(sale_date=DAY, amount=3000, dry_run=False)

    res = await biz.record_daily_close(
        close_date=DAY,
        counted=[{"method": "efectivo", "amount": 2000}, {"method": "mercadopago", "amount": 5000}],
        units=[{"product": "empanada", "qty": 10}],
        dry_run=False,
    )
    assert res["action"] == "create"
    assert (res["day"]["total"], res["day"]["sales_total"]) == (7000.0, 3000.0)
    assert any("Diferencia de caja en efectivo" in w for w in res["warnings"])
    assert (await db.scalar(select(IncomeEntry))).amount == D(7000)
    assert await _level(db, empanada) == -10

    again = await biz.record_daily_close(close_date=DAY, counted=[{"method": "efectivo", "amount": 9000}], dry_run=False)
    assert again["action"] == "replace"
    assert [(ln["product"], ln["qty"]) for ln in again["close"]["lines"]] == [("Empanada de carne", 10.0)]

    deleted = await biz.delete_sale(close_date=DAY, dry_run=False)
    assert deleted["day"]["total"] == 3000.0
    assert (await db.scalar(select(IncomeEntry))).amount == D(3000)


async def test_get_sales_groupings_and_delete_a_sale(wired):
    db = wired
    await _business(db)
    await biz.record_sale(
        sale_date=DAY, lines=[{"product": "empanada", "qty": 2}],
        payments=[{"method": "efectivo", "amount": 2000}, {"method": "mercadopago", "amount": 1000}], dry_run=False,
    )
    await biz.record_sale(sale_date=DAY, lines=[{"product": "coca", "qty": 1}], amount=2500, method="debito", dry_run=False)

    by_day = await biz.get_sales(date_from=DAY, date_to=DAY)
    assert by_day["total"] == 5500.0
    assert by_day["days"] == [{"date": DAY, "total": 5500.0, "sales_count": 2, "closed": False}]
    by_method = await biz.get_sales(date_from=DAY, date_to=DAY, group_by="method")
    assert {m["method"]: m["total"] for m in by_method["by_method"]} == {
        "efectivo": 2000.0, "mercadopago": 1000.0, "debito": 2500.0,
    }
    by_product = await biz.get_sales(date_from=DAY, date_to=DAY, group_by="product")
    assert [p["name"] for p in by_product["by_product"]] == ["Empanada de carne", "Coca-Cola"]

    detail = await biz.get_sales(date_from=DAY, date_to=DAY, group_by="sale")
    first = detail["days"][0]["sales"][0]
    res = await biz.delete_sale(sale_id=first["id"], dry_run=False)
    assert res["deleted"]["total"] == 3000.0 and res["day"]["total"] == 2500.0
    assert (await db.scalar(select(IncomeEntry))).amount == D(2500)


async def test_stock_movements_counts_and_get_stock(wired):
    db = wired
    empanada, _ = await _business(db)
    preview = await biz.record_stock_movement(kind="produccion", qty=30, product="empanadas", movement_date=DAY)
    assert preview["on_hand_after"] == 30.0 and await _count(db, StockMovement) == 0

    await biz.record_stock_movement(kind="produccion", qty=30, product="empanadas", movement_date=DAY, dry_run=False)
    counted = await biz.record_stock_movement(kind="conteo", qty=25, product="empanada de carne", dry_run=False)
    assert counted["movement"]["qty"] == -5.0 and counted["on_hand_after"] == 25.0
    same = await biz.record_stock_movement(kind="conteo", qty=25, product_id=empanada.id, dry_run=False)
    assert same["movement"] is None
    await biz.record_stock_movement(kind="merma", qty=2, product="empanadas", dry_run=False)

    levels = await biz.get_stock()
    assert {p["name"]: p["on_hand"] for p in levels["products"]} == {"Coca-Cola": 0.0, "Empanada de carne": 23.0}
    detail = await biz.get_stock(product="empanadas", movements=10)
    assert [m["kind"] for m in detail["movements"]] == ["merma", "ajuste", "produccion"]
    assert all(m["from"] == "a mano" for m in detail["movements"])


async def test_save_product_creates_edits_and_archives(wired):
    db = wired
    await _business(db)
    preview = await biz.save_product(name="Flan", sale_price=2000)
    assert (preview["product"]["id"], preview["product"]["kind"]) == (None, "elaborado")
    assert not await products.resolve_product(db, 1, "flan")

    await biz.save_product(name="Flan", sale_price=2000, dry_run=False)
    flan = (await products.resolve_product(db, 1, "flan"))[0]
    edited = await biz.save_product(product_id=flan.id, sale_price=2500, min_stock=5, dry_run=False)
    assert (edited["before"]["sale_price"], edited["product"]["sale_price"]) == (2000.0, 2500.0)

    await biz.save_product(product_id=flan.id, is_active=False, dry_run=False)
    taxonomy = await tools_meta.get_taxonomy()
    assert taxonomy["account_kind"] == "business"
    assert [p["name"] for p in taxonomy["products"]] == ["Coca-Cola", "Empanada de carne"]
    assert any("stock_lines" in rule for rule in taxonomy["rules"])


async def test_save_expense_with_payee_and_stock_lines(wired):
    db = wired
    _, coca = await _business(db)
    merca = ExpenseCategory(tenant_id=1, name="Mercadería", color="#000000", is_fixed=False)
    sueldos = ExpenseCategory(tenant_id=1, name="Sueldos", color="#000000", is_fixed=True)
    db.add_all([merca, sueldos])
    await db.flush()
    await payees.create_payee(db, 1, name="Distribuidora Sur", kind="proveedor", default_category_id=merca.id)
    await payees.create_payee(db, 1, name="Juan Pérez", kind="empleado", default_category_id=sueldos.id)
    await db.commit()
    purchase = dict(amount=18000, expense_date=DAY, payee="distribuidora", stock_lines=[{"product": "coca", "qty": 12}])

    preview = await exp_tools.save_expense(**purchase)
    # El proveedor pone la categoría; con una sola línea, el costo sale del monto.
    assert (preview["entry"]["category"], preview["entry"]["payee"]) == ("Mercadería", "Distribuidora Sur")
    assert preview["entry"]["description"] == "12 Coca-Cola"  # sin descripción: lo que se compró
    assert preview["stock"] == [{"product": "Coca-Cola", "qty": 12.0, "unit_cost": 1500.0, "on_hand_after": 12.0}]
    assert await _count(db, ExpenseEntry) == 0 and await _count(db, StockMovement) == 0

    saved = await exp_tools.save_expense(**purchase, dry_run=False)
    assert await _level(db, coca) == 12
    # Borrar el gasto se lleva el stock que trajo.
    await exp_tools.delete_expense(entry_id=saved["entry"]["id"], dry_run=False)
    assert await _level(db, coca) == 0

    # Lo que no es un producto no va al stock: el error dice qué hacer.
    with pytest.raises(ToolError, match="materia prima"):
        await exp_tools.save_expense(
            amount=5000, expense_date=DAY, category="Mercadería", stock_lines=[{"product": "harina", "qty": 2}],
        )
    paid = await exp_tools.save_expense(amount=80000, expense_date=DAY, payee="juan", dry_run=False)
    assert (paid["entry"]["category"], paid["entry"]["payee"], paid["entry"]["description"]) == (
        "Sueldos", "Juan Pérez", "Juan Pérez",
    )
