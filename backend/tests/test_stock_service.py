"""El stock de un negocio: suma de movimientos con signo, de dónde sale cada
uno, y qué pasa cuando se borra o se edita lo que lo generó."""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.models.business import StockMovement
from app.models.expense import EXPENSE_SOURCE_MANUAL, ExpenseCategory
from app.schemas.business import SaleLineIn, SalePaymentIn, StockLineIn
from app.services import expenses as expenses_service
from app.services.business import products, sales, stock

DAY = date(2026, 10, 9)


async def _product(db, name="Empanada", kind="elaborado", **kw):
    return await products.create_product(db, 1, name=name, kind=kind, **kw)


async def _ticket(db, product, qty, amount="1000", day=DAY):
    sale, _ = await sales.create_ticket(
        db, tenant_id=1, user_id=1, sale_date=day,
        lines=[SaleLineIn(product_id=product.id, qty=Decimal(qty))],
        payments=[SalePaymentIn(method="efectivo", amount=Decimal(amount))],
    )
    return sale


async def _level(db, product):
    return (await stock.on_hand(db, 1, [product.id])).get(product.id, Decimal(0))


async def test_production_waste_and_count(db):
    empanada = await _product(db)
    assert not empanada.track_stock
    await stock.record_movement(db, tenant_id=1, user_id=1, product_id=empanada.id,
                                kind="produccion", qty=Decimal(30), movement_date=DAY)
    # Cargarle producción es decir que se quiere contar.
    assert empanada.track_stock
    await stock.record_movement(db, tenant_id=1, user_id=1, product_id=empanada.id,
                                kind="merma", qty=Decimal(2), movement_date=DAY)
    assert await _level(db, empanada) == Decimal(28)

    adj = await stock.record_count(db, tenant_id=1, user_id=1, product_id=empanada.id,
                                   counted_qty=Decimal(25), movement_date=DAY)
    assert adj.kind == "ajuste" and adj.qty == Decimal(-3) and adj.counted_qty == Decimal(25)
    assert await _level(db, empanada) == Decimal(25)
    # Si ya coincide no se guarda un ajuste de cero.
    assert await stock.record_count(db, tenant_id=1, user_id=1, product_id=empanada.id,
                                    counted_qty=Decimal(25), movement_date=DAY) is None


async def test_a_purchase_brings_stock_and_takes_it_when_deleted(db):
    coca = await _product(db, "Coca-Cola", kind="reventa")
    cat = ExpenseCategory(tenant_id=1, name="Mercadería", color="#000000", is_fixed=False)
    db.add(cat)
    await db.flush()
    entry = await expenses_service.create_expense(
        db, tenant_id=1, user_id=1, amount=Decimal("18000"), expense_date=DAY,
        category_id=cat.id, source=EXPENSE_SOURCE_MANUAL,
    )
    [mv] = await stock.add_purchase_lines(db, tenant_id=1, user_id=1, entry=entry,
                                          lines=[StockLineIn(product_id=coca.id, qty=Decimal(12))])
    assert mv.unit_cost == Decimal("1500.00")  # el gasto entre la cantidad
    assert await _level(db, coca) == Decimal(12)

    await expenses_service.delete_expense(db, entry, 1)
    assert await _level(db, coca) == Decimal(0)


async def test_card_purchases_do_not_carry_stock(db):
    coca = await _product(db, "Coca-Cola", kind="reventa")
    entry = type("E", (), {"payment_method": "tarjeta_credito", "amount": Decimal(1), "id": 1, "expense_date": DAY})()
    with pytest.raises(HTTPException) as exc:
        await stock.add_purchase_lines(db, tenant_id=1, user_id=1, entry=entry,
                                       lines=[StockLineIn(product_id=coca.id, qty=Decimal(1))])
    assert exc.value.status_code == 422


async def test_a_sale_takes_stock_and_editing_or_deleting_it_gives_it_back(db):
    coca = await _product(db, "Coca-Cola", kind="reventa")
    tarta = await _product(db, "Tarta")  # elaborado sin stock: no genera movimientos
    sale, _ = await sales.create_ticket(
        db, tenant_id=1, user_id=1, sale_date=DAY,
        lines=[SaleLineIn(product_id=coca.id, qty=Decimal(2)), SaleLineIn(product_id=tarta.id, qty=Decimal(1))],
        payments=[SalePaymentIn(method="efectivo", amount=Decimal(15000))],
    )
    assert await _level(db, coca) == Decimal(-2)  # negativo y sin frenar la venta
    assert await _level(db, tarta) == Decimal(0)

    await sales.update_ticket(db, sale, user_id=1, sale_date=DAY,
                              lines=[SaleLineIn(product_id=coca.id, qty=Decimal(5))],
                              payments=[SalePaymentIn(method="efectivo", amount=Decimal(15000))])
    assert await _level(db, coca) == Decimal(-5)

    await sales.delete_ticket(db, sale, user_id=1)
    assert await _level(db, coca) == Decimal(0)


async def test_the_close_takes_what_tickets_did_not(db):
    empanada = await _product(db, track_stock=True)
    await stock.record_movement(db, tenant_id=1, user_id=1, product_id=empanada.id,
                                kind="produccion", qty=Decimal(40), movement_date=DAY)
    await _ticket(db, empanada, 3)
    # Al cerrar: salieron 10 en el día; 3 ya los restó el ticket.
    await sales.upsert_close(
        db, tenant_id=1, user_id=1, day=DAY,
        counted=[SalePaymentIn(method="efectivo", amount=Decimal(15000))],
        units=[SaleLineIn(product_id=empanada.id, qty=Decimal(10))],
    )
    assert await _level(db, empanada) == Decimal(30)

    # Un ticket más del día: el cierre resta menos, el total no cambia.
    await _ticket(db, empanada, 2)
    assert await _level(db, empanada) == Decimal(30)

    await sales.delete_close(db, tenant_id=1, user_id=1, day=DAY)
    assert await _level(db, empanada) == Decimal(35)


async def test_tickets_over_the_close_units_warn_instead_of_adding_back(db):
    empanada = await _product(db, track_stock=True)
    await _ticket(db, empanada, 6)
    await sales.upsert_close(
        db, tenant_id=1, user_id=1, day=DAY,
        counted=[SalePaymentIn(method="efectivo", amount=Decimal(1000))],
        units=[SaleLineIn(product_id=empanada.id, qty=Decimal(4))],
    )
    assert await _level(db, empanada) == Decimal(-6)
    summary = await sales.day_summary(db, 1, DAY)
    assert any("más unidades que las del cierre" in w for w in summary.warnings)


async def test_levels_flag_negative_and_low_and_linked_moves_are_protected(db):
    coca = await _product(db, "Coca-Cola", kind="reventa", min_stock=Decimal(6))
    agua = await _product(db, "Agua", kind="reventa")
    await stock.record_movement(db, tenant_id=1, user_id=1, product_id=coca.id,
                                kind="compra", qty=Decimal(5), movement_date=DAY)
    await _ticket(db, agua, 1)

    alerts = {lv["name"]: lv["alert"] for lv in await stock.stock_levels(db, 1)}
    assert alerts == {"Agua": "negativo", "Coca-Cola": "bajo"}

    sale_move = await db.scalar(select(StockMovement).where(StockMovement.product_id == agua.id))
    with pytest.raises(HTTPException) as exc:
        await stock.delete_manual_movement(db, 1, sale_move.id)
    assert exc.value.status_code == 409
