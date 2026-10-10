"""Ventas de un negocio: tickets, el cierre del día y el ingreso diario.

Las reglas del módulo (services/business/sales.py), una por test: un día es un
solo ingreso recalculado desde cero, el cierre guarda lo contado y manda sobre
los tickets, y ese ingreso no se toca a mano.
"""
from datetime import date
from decimal import Decimal

import pytest
from fastapi import HTTPException
from sqlalchemy import func, select

from app.models.business import Sale, SaleLine, SalePayment
from app.models.income import IncomeEntry, IncomeSource
from app.schemas.business import SaleLineIn, SalePaymentIn
from app.services import income as income_service
from app.services.business import analytics, products, sales

DAY = date(2026, 10, 9)


def pay(**amounts):
    return [SalePaymentIn(method=m, amount=Decimal(a)) for m, a in amounts.items()]


async def ticket(db, day=DAY, client_ref=None, lines=None, **amounts):
    sale, _ = await sales.create_ticket(
        db, tenant_id=1, user_id=1, sale_date=day, lines=lines or [],
        payments=pay(**amounts), client_ref=client_ref,
    )
    return sale


async def ledger(db, day=DAY):
    """Los ingresos de Ventas de ese día (tiene que haber 0 o 1)."""
    return (await db.scalars(
        select(IncomeEntry).join(IncomeSource, IncomeSource.id == IncomeEntry.source_id)
        .where(IncomeSource.system_key == "sales", IncomeEntry.period_date == day)
    )).all()


async def test_a_ticket_becomes_the_days_income(db):
    await ticket(db, efectivo="6500")
    await ticket(db, mercadopago="3000", efectivo="1000")
    entries = await ledger(db)
    assert len(entries) == 1
    assert entries[0].amount == Decimal("10500")
    assert entries[0].notes == "2 ventas"


async def test_the_close_counts_what_was_counted(db):
    await ticket(db, efectivo="150000")
    await ticket(db, mercadopago="50000")
    await sales.upsert_close(db, tenant_id=1, user_id=1, day=DAY, counted=pay(efectivo="200000"))

    assert (await ledger(db))[0].amount == Decimal("200000")
    summary = await sales.day_summary(db, 1, DAY)
    by = {m.method: m for m in summary.by_method}
    assert by["efectivo"].diff == Decimal("50000")     # vendido sin ticket
    assert by["mercadopago"].diff == Decimal("-50000")  # no contado: diferencia de caja
    assert any("Diferencia de caja en Mercado Pago" in w for w in summary.warnings)
    assert summary.total == Decimal("200000")


async def test_a_late_ticket_does_not_change_a_closed_day(db):
    await ticket(db, efectivo="150000")
    await sales.upsert_close(db, tenant_id=1, user_id=1, day=DAY, counted=pay(efectivo="200000"))
    # El ticket olvidado: la plata ya estaba en lo contado.
    await ticket(db, efectivo="10000")

    assert (await ledger(db))[0].amount == Decimal("200000")
    summary = await sales.day_summary(db, 1, DAY)
    assert summary.ticketed_total == Decimal("160000")
    assert any("después del cierre" in w for w in summary.warnings)


async def test_closing_again_replaces_the_close(db):
    await sales.upsert_close(db, tenant_id=1, user_id=1, day=DAY, counted=pay(efectivo="100"))
    await sales.upsert_close(db, tenant_id=1, user_id=1, day=DAY, counted=pay(efectivo="80", debito="40"))
    closes = (await db.scalars(select(Sale).where(Sale.kind == "cierre"))).all()
    assert len(closes) == 1
    assert closes[0].total == Decimal("120")
    assert (await ledger(db))[0].amount == Decimal("120")

    await sales.delete_close(db, tenant_id=1, user_id=1, day=DAY)
    assert await ledger(db) == []


async def test_deleting_the_last_sale_deletes_the_income(db):
    sale = await ticket(db, efectivo="5000")
    await sales.delete_ticket(db, sale, user_id=1)
    assert await ledger(db) == []
    assert await db.scalar(select(func.count(SalePayment.id))) == 0


async def test_moving_a_sale_to_another_day_rebuilds_both(db):
    keep = await ticket(db, efectivo="1000")
    moved = await ticket(db, efectivo="500")
    other = date(2026, 10, 8)
    await sales.update_ticket(db, moved, user_id=1, sale_date=other, lines=[], payments=pay(debito="700"))

    assert (await ledger(db, DAY))[0].amount == Decimal("1000")
    assert (await ledger(db, other))[0].amount == Decimal("700")
    assert moved.payments[0].method == "debito"
    assert keep.total == Decimal("1000")


async def test_client_ref_makes_a_retry_return_the_same_sale(db):
    first = await ticket(db, client_ref="tap-1", efectivo="2000")
    again = await ticket(db, client_ref="tap-1", efectivo="2000")
    assert again.id == first.id
    assert await db.scalar(select(func.count(Sale.id))) == 1
    assert (await ledger(db))[0].amount == Decimal("2000")


async def test_payments_and_lines_are_validated(db):
    with pytest.raises(HTTPException) as exc:
        await ticket(db)
    assert exc.value.status_code == 422
    with pytest.raises(HTTPException):
        await sales.create_ticket(
            db, tenant_id=1, user_id=1, sale_date=DAY, lines=[],
            payments=[SalePaymentIn(method="efectivo", amount=Decimal(1)),
                      SalePaymentIn(method="efectivo", amount=Decimal(2))],
        )
    with pytest.raises(HTTPException):
        await ticket(db, lines=[SaleLineIn(qty=Decimal(1))], efectivo="10")
    foreign = await products.create_product(db, 2, name="Ajeno")
    with pytest.raises(HTTPException) as exc:
        await ticket(db, lines=[SaleLineIn(product_id=foreign.id)], efectivo="10")
    assert exc.value.status_code == 404


async def test_the_sales_income_is_read_only_by_hand(db):
    await ticket(db, efectivo="5000")
    entry = (await ledger(db))[0]
    with pytest.raises(HTTPException) as exc:
        await income_service.assert_entry_writable(entry, db)
    assert exc.value.status_code == 409
    with pytest.raises(HTTPException):
        await income_service.assert_writable_source(entry.source_id, db)


async def test_analytics_follow_the_close_rule(db):
    empanada = await products.create_product(db, 1, name="Empanada", sale_price=Decimal("1500"))
    coca = await products.create_product(db, 1, name="Coca-Cola 1,5 L", kind="reventa", sale_price=Decimal("3000"))
    assert coca.track_stock and not empanada.track_stock

    await ticket(db, lines=[SaleLineIn(product_id=empanada.id, qty=Decimal(3), unit_price=Decimal("1500")),
                            SaleLineIn(product_id=coca.id, qty=Decimal(1), unit_price=Decimal("3000"))],
                 efectivo="7500")
    await ticket(db, lines=[SaleLineIn(product_id=empanada.id, qty=Decimal(6), unit_price=Decimal("1500"))],
                 mercadopago="9000")
    other = date(2026, 10, 10)
    await ticket(db, day=other, efectivo="4000")
    await sales.upsert_close(db, tenant_id=1, user_id=1, day=other, counted=pay(efectivo="5000"))

    start, end = date(2026, 10, 1), date(2026, 11, 1)
    by_day = {d.day: d.total for d in await analytics.sales_by_day(db, 1, start, end)}
    assert by_day == {DAY: Decimal("16500"), other: Decimal("5000")}
    by_method = {m.method: m.total for m in await analytics.sales_by_method(db, 1, start, end)}
    assert by_method == {"efectivo": Decimal("12500"), "mercadopago": Decimal("9000")}
    top = await analytics.top_products(db, 1, start, end)
    assert top[0].name == "Empanada" and top[0].qty == Decimal(9)
    assert top[0].revenue == Decimal("13500")
