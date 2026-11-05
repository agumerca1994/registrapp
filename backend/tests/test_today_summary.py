"""Las cuentas de Inicio: qué se dice según el momento del mes, y qué cuenta como gastado hoy."""
from datetime import date
from decimal import Decimal

import pytest_asyncio

from app.models.credit_card import CreditCard, CreditCardItem
from app.models.expense import EXPENSE_SOURCE_MORTGAGE, ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource, IncomeType
from app.models.mortgage import MortgageLoan, MortgageRecord
from app.models.payment_reminder import PaymentReminder
from app.models.tenant import Tenant
from app.models.user import User
from app.routers import expenses as expenses_router
from app.services.analytics import month_summary, today_summary
from app.services.credit_cards import find_or_create_statement

TODAY = date(2026, 11, 18)


@pytest_asyncio.fixture
async def cat(db):
    db.add(Tenant(id=1, name="Casa", code="AAAAAAAA"))
    db.add(User(id=1, firebase_uid="uid1", tenant_id=1, email="a@x.com"))
    category = ExpenseCategory(tenant_id=1, name="Comida", color="#8b5cf6", is_fixed=False)
    db.add(category)
    await db.flush()
    return category


def _expense(cat, day, amount, **kw):
    return ExpenseEntry(tenant_id=1, user_id=1, category_id=cat.id, amount=Decimal(amount), expense_date=day, **kw)


async def _income(db, day, amount):
    source = IncomeSource(tenant_id=1, name="Sueldo", income_type=IncomeType.salary)
    db.add(source)
    await db.flush()
    db.add(IncomeEntry(tenant_id=1, user_id=1, source_id=source.id, amount=Decimal(amount), period_date=day))
    await db.flush()


async def _card_statement(db, due, year=2026, month=10):
    # El alias distinto por mes: `statement_totals_by_period` agrupa por tarjeta dentro del mes de pago.
    card = CreditCard(tenant_id=1, user_id=1, bank="BBVA", alias="Visa" if month == 10 else f"Tarjeta {month}", due_day=10)
    db.add(card)
    await db.flush()
    statement = await find_or_create_statement(card, year, month, 1, db)
    statement.due_date = due
    await db.flush()
    return statement


async def test_cuenta_nueva_esta_vacia_y_sin_ingreso(db, cat):
    today = await today_summary(db, 1, TODAY)
    assert today.is_empty
    assert today.moment == "no_income"
    assert today.left_to_spend == 0
    assert len(today.week) == 7


async def test_lo_que_queda_descuenta_lo_que_vence_mas_adelante_en_el_mes(db, cat):
    await _income(db, date(2026, 11, 1), "1000")
    statement = await _card_statement(db, date(2026, 11, 24))
    entry = _expense(cat, date(2026, 10, 20), "300")
    db.add(entry)
    await db.flush()
    db.add(CreditCardItem(statement_id=statement.id, description="Súper", category_id=cat.id, item_date=entry.expense_date,
                          item_type="single", amount=Decimal("300"), expense_entry_id=entry.id))
    await db.flush()

    today = await today_summary(db, 1, TODAY)
    assert today.moment == "running"
    assert today.left_to_spend == Decimal("700")
    assert today.days_left == 13  # del 18 al 30, contando hoy
    assert today.per_day == Decimal("53.85")
    # Todavía no salió: vence el 24.
    assert today.paid_month == 0
    assert [(i.kind, i.title, i.amount) for i in today.upcoming] == [("card", "Visa", Decimal("300"))]


async def test_del_25_en_adelante_el_mes_ya_se_compara(db, cat):
    await _income(db, date(2026, 11, 1), "1000")
    assert (await today_summary(db, 1, date(2026, 11, 24))).moment == "running"
    assert (await today_summary(db, 1, date(2026, 11, 25))).moment == "closing"


async def test_sin_ingreso_el_numero_es_lo_que_sale_en_diez_dias(db, cat):
    await _card_statement(db, date(2026, 11, 12))
    statement = await _card_statement(db, date(2026, 11, 20), month=9)
    db.add(CreditCardItem(statement_id=statement.id, description="A", category_id=cat.id, item_date=date(2026, 9, 1),
                          item_type="single", amount=Decimal("500")))
    late = await _card_statement(db, date(2026, 11, 29), month=8)
    db.add(CreditCardItem(statement_id=late.id, description="B", category_id=cat.id, item_date=date(2026, 8, 1),
                          item_type="single", amount=Decimal("900")))
    await db.flush()

    today = await today_summary(db, 1, TODAY)
    assert today.moment == "no_income"
    assert today.next_10_days == Decimal("500")  # el del 29 queda afuera


async def test_gastado_hoy_cuenta_por_compra_sin_cuotas_viejas_ni_hipoteca(db, cat):
    statement = await _card_statement(db, date(2026, 12, 10), month=11)
    cuota_vieja = _expense(cat, TODAY, "70")
    cuota_uno = _expense(cat, TODAY, "40")
    db.add_all([_expense(cat, TODAY, "100"), cuota_vieja, cuota_uno,
                _expense(cat, TODAY, "5", currency="USD"),
                _expense(cat, date(2026, 11, 17), "20"),
                _expense(cat, date(2026, 11, 19), "999")])
    await db.flush()
    db.add_all([
        CreditCardItem(statement_id=statement.id, description="Plan viejo", category_id=cat.id, item_date=TODAY,
                       item_type="installment", amount=Decimal("70"), installment_number=3, installment_count=6,
                       expense_entry_id=cuota_vieja.id),
        CreditCardItem(statement_id=statement.id, description="Plan nuevo", category_id=cat.id, item_date=TODAY,
                       item_type="installment", amount=Decimal("40"), installment_number=1, installment_count=6,
                       expense_entry_id=cuota_uno.id),
    ])
    await db.flush()

    today = await today_summary(db, 1, TODAY)
    assert today.spent_today == Decimal("140")
    assert today.spent_today_usd == Decimal("5")
    assert today.spent_week == Decimal("160")
    assert [d.date for d in today.week][-1] == TODAY


async def test_a_esta_altura_el_mes_pasado_mira_el_mismo_dia(db, cat):
    db.add_all([_expense(cat, date(2026, 10, 18), "30"), _expense(cat, date(2026, 10, 19), "500"),
                _expense(cat, date(2026, 11, 2), "10")])
    await db.flush()
    today = await today_summary(db, 1, TODAY)
    assert today.spent_mtd == Decimal("10")
    assert today.spent_mtd_prev == Decimal("30")


async def test_hipoteca_proyectada_se_descuenta_y_aparece_en_lo_que_viene(db, cat):
    await _income(db, date(2026, 11, 1), "1000")
    db.add(MortgageLoan(tenant_id=1, loan_type="tasa_fija", total_cuotas=240,
                        first_payment_date=date(2025, 2, 10), payment_day=10, cuota_pesos=Decimal("100")))
    await db.flush()

    today = await today_summary(db, 1, date(2026, 11, 4))
    assert today.left_to_spend == Decimal("900")
    mortgage = today.upcoming[0]
    assert (mortgage.kind, mortgage.date, mortgage.amount) == ("mortgage", date(2026, 11, 10), Decimal("100"))
    assert mortgage.detail == "Cuota 22 de 240"
    assert today.next_month_committed == Decimal("100")


async def test_la_lista_por_fecha_de_pago_suma_lo_mismo_que_el_resumen_del_mes(db, cat):
    statement = await _card_statement(db, date(2026, 11, 24))
    comprado_antes = _expense(cat, date(2026, 10, 20), "300", description="Heladera")
    comprado_ahora_se_paga_despues = _expense(cat, date(2026, 11, 3), "50", description="Zapatillas")
    db.add_all([comprado_antes, comprado_ahora_se_paga_despues, _expense(cat, date(2026, 11, 2), "10", description="Pan")])
    await db.flush()
    siguiente = await _card_statement(db, date(2026, 12, 12), month=11)
    db.add_all([
        CreditCardItem(statement_id=statement.id, description="Heladera", category_id=cat.id, item_date=comprado_antes.expense_date,
                       item_type="single", amount=Decimal("300"), expense_entry_id=comprado_antes.id),
        CreditCardItem(statement_id=siguiente.id, description="Zapatillas", category_id=cat.id, item_date=comprado_ahora_se_paga_despues.expense_date,
                       item_type="single", amount=Decimal("50"), expense_entry_id=comprado_ahora_se_paga_despues.id),
    ])
    await db.commit()

    params = dict(q=None, category_id=None, currency=None, payee_id=None, loaded_by=None, date_from=None, date_to=None,
                  sort="date", order="desc", firebase_user={"uid": "uid1"}, db=db)
    por_pago = await expenses_router.list_entries(year=2026, month=11, basis="payment", **params)
    por_compra = await expenses_router.list_entries(year=2026, month=11, basis="purchase", **params)

    assert {e.description for e in por_pago} == {"Heladera", "Pan"}
    assert {e.description for e in por_compra} == {"Zapatillas", "Pan"}
    resumen = await month_summary(db, 1, 2026, 11)
    assert sum(e.amount for e in por_pago) == resumen.total_expenses


async def test_un_recordatorio_va_sin_monto_y_no_suma(db, cat):
    db.add(PaymentReminder(tenant_id=1, user_id=1, title="Expensas", remind_date=date(2026, 11, 20)))
    await db.flush()
    today = await today_summary(db, 1, TODAY)
    assert [(i.kind, i.amount) for i in today.upcoming] == [("reminder", None)]
    assert today.next_10_days == 0


async def test_la_cuota_de_hipoteca_registrada_no_cuenta_como_gasto_del_dia_y_pasa_a_la_siguiente(db, cat):
    db.add(MortgageLoan(id=1, tenant_id=1, loan_type="tasa_fija", total_cuotas=240,
                        first_payment_date=date(2025, 2, 10), payment_day=10, cuota_pesos=Decimal("100")))
    cuota = _expense(cat, date(2026, 11, 10), "100", source=EXPENSE_SOURCE_MORTGAGE)
    db.add(cuota)
    await db.flush()
    db.add(MortgageRecord(tenant_id=1, mortgage_loan_id=1, expense_entry_id=cuota.id,
                          period_date=date(2026, 11, 1), payment_amount=Decimal("100")))
    await db.flush()

    today = await today_summary(db, 1, TODAY)
    assert today.spent_mtd == 0
    mortgage = today.upcoming[0]
    assert (mortgage.date, mortgage.detail) == (date(2026, 12, 10), "Cuota 23 de 240")
