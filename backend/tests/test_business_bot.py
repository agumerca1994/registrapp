"""El bot de WhatsApp de un negocio (business/bot.py): de lo que se escribe a
ventas, cierres, compras, stock y pagos, con sus preguntas y su deshacer."""
from decimal import Decimal
from types import SimpleNamespace

from sqlalchemy import func, select

from app.models.business import Sale, StockMovement
from app.models.expense import ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry
from app.models.tenant import Tenant
from app.models.user import UserRole
from app.schemas.business import SaleLineIn, SalePaymentIn
from app.services import wa_bot
from app.services.business import payees, products, sales, stock
from app.services.clock import business_today
from app.services.wa_bot import InboundMessage

D = Decimal
OWNER = SimpleNamespace(id=1, tenant_id=1)
EMPLOYEE = SimpleNamespace(id=7, tenant_id=1, role=UserRole.employee)
_seq = iter(range(1, 10_000))


def _in(text):
    return InboundMessage(phone="549383", wa_id=f"W{next(_seq)}", kind="text", text=text)


async def _say(db, text, user=OWNER):
    [reply] = await wa_bot.handle(db, user, _in(text))
    return reply


async def _rotiseria(db):
    db.add(Tenant(id=1, name="Rotisería", kind="business"))
    await db.flush()
    empanada = await products.create_product(
        db, 1, name="Empanada de carne", kind="elaborado", sale_price=D(1500), track_stock=True,
    )
    coca = await products.create_product(db, 1, name="Coca-Cola", kind="reventa", sale_price=D(2500))
    return empanada, coca


async def _cat(db, name):
    cat = ExpenseCategory(tenant_id=1, name=name, color="#000000", is_fixed=False)
    db.add(cat)
    await db.flush()
    return cat


async def _level(db, product):
    return (await stock.on_hand(db, 1, [product.id])).get(product.id, D(0))


async def _count(db, model):
    return await db.scalar(select(func.count()).select_from(model))


# ── Ventas ─────────────────────────────────────────────────────────────────────

async def test_a_sale_with_products_amount_and_method(db):
    empanada, coca = await _rotiseria(db)
    reply = await _say(db, "vendí 3 empanadas y 1 coca 6500 efectivo")

    assert reply.startswith("✅ Venta de hoy: 3 Empanada de carne + 1 Coca-Cola · $6.500,00 en efectivo")
    sale = await db.scalar(select(Sale))
    assert (sale.total, sale.source, sale.sale_date) == (D(6500), "whatsapp", business_today())
    assert [(ln.product_id, ln.qty) for ln in sale.lines] == [(empanada.id, 3), (coca.id, 1)]
    # Entra al libro como el ingreso del día, y no como un gasto.
    assert (await db.scalar(select(IncomeEntry))).amount == D(6500)
    assert await _count(db, ExpenseEntry) == 0
    # Sin stock cargado la venta no se frena: avisa.
    assert "Coca-Cola quedó en -1: cargá el ingreso" in reply
    assert "Empanada de carne quedó en -3: cargá la producción" in reply


async def test_without_an_amount_it_uses_the_list_price(db):
    await _rotiseria(db)
    reply = await _say(db, "vendí 2 empanadas")
    assert "$3.000,00 en efectivo (a precio de lista)" in reply
    assert (await db.scalar(select(Sale))).total == D(3000)


async def test_without_amount_or_price_it_asks_and_resumes(db):
    await _rotiseria(db)
    reply = await _say(db, "vendí 2 tartas")  # no hay un producto "tartas"
    assert reply.startswith("¿Cuánto cobraste por 2 Tartas?")
    assert await _count(db, Sale) == 0

    reply = await _say(db, "4 lucas mp")
    assert "✅ Venta de hoy: 2 Tartas · $4.000,00 en Mercado Pago" in reply
    sale = await db.scalar(select(Sale))
    # Lo que no es un producto queda como texto, no se inventa un producto.
    assert [(ln.product_id, ln.description) for ln in sale.lines] == [(None, "Tartas")]
    assert sale.payments[0].method == "mercadopago"


async def test_two_products_that_match_are_asked(db):
    empanada, _ = await _rotiseria(db)
    pollo = await products.create_product(db, 1, name="Empanada de pollo", sale_price=D(1500))
    reply = await _say(db, "vendí 2 empanadas 3000")
    assert reply.startswith("¿Cuál es «Empanadas»?")
    assert "1️⃣ Empanada de carne" in reply and "2️⃣ Empanada de pollo" in reply and "3️⃣ Ninguno" in reply

    await _say(db, "2")
    sale = await db.scalar(select(Sale))
    assert [ln.product_id for ln in sale.lines] == [pollo.id]
    assert sale.total == D(3000)


async def test_quantity_and_money_without_a_verb_asks_sale_or_purchase(db):
    await _rotiseria(db)
    assert (await _say(db, "3 empanadas 4500")).startswith("¿Qué fue?")
    await _say(db, "1")
    assert (await db.scalar(select(Sale))).total == D(4500)


async def test_edit_the_amount_and_undo_a_sale(db):
    await _rotiseria(db)
    await _say(db, "vendí 2 empanadas 3000")
    assert "$3.500,00 en efectivo" in await _say(db, "editar monto 3500")
    assert (await db.scalar(select(IncomeEntry))).amount == D(3500)

    assert "Deshecha la venta de hoy de $3.500,00" in await _say(db, "deshacer")
    assert await _count(db, Sale) == 0
    assert await _count(db, IncomeEntry) == 0


# ── Cierre ─────────────────────────────────────────────────────────────────────

async def test_the_close_counts_by_method_and_compares_with_tickets(db):
    await _rotiseria(db)
    await _say(db, "vendí 2 empanadas 3000")
    reply = await _say(db, "cierre: 200 lucas efectivo, 150 mp")
    assert reply.startswith("✅ Cierre de hoy: efectivo $200.000,00 · Mercado Pago $150.000,00 = $350.000,00")
    assert "Ventas cargadas: $3.000,00 · sin ticket: $347.000,00" in reply
    # El día suma lo contado.
    assert (await db.scalar(select(IncomeEntry))).amount == D(350000)

    assert "Deshecho el cierre de hoy" in await _say(db, "deshacer")
    assert (await db.scalar(select(IncomeEntry))).amount == D(3000)


async def test_closing_again_by_chat_keeps_the_units_loaded_in_the_app(db):
    empanada, _ = await _rotiseria(db)
    await sales.upsert_close(
        db, tenant_id=1, user_id=1, day=business_today(),
        counted=[SalePaymentIn(method="efectivo", amount=D(100000))],
        units=[SaleLineIn(product_id=empanada.id, qty=D(10))],
    )
    reply = await _say(db, "cierre 300 lucas")
    assert "Reemplazó al cierre" in reply
    close = await sales.get_close(db, 1, business_today())
    assert close.total == D(300000)
    assert [(ln.product_id, ln.qty) for ln in close.lines] == [(empanada.id, 10)]


# ── Compras y gastos ───────────────────────────────────────────────────────────

async def test_a_stock_purchase_is_an_expense_with_stock_and_undo_takes_both(db):
    _, coca = await _rotiseria(db)
    await _cat(db, "Mercadería")
    reply = await _say(db, "compré 12 coca a 18 lucas")

    assert "✅ $18.000,00 · 12 Coca-Cola — Mercadería" in reply
    assert "📦 Coca-Cola: hay 12" in reply
    entry = await db.scalar(select(ExpenseEntry))
    assert entry.amount == D(18000)  # no $12: el 12 es la cantidad
    assert await _level(db, coca) == 12
    move = await db.scalar(select(StockMovement))
    assert (move.expense_entry_id, move.unit_cost) == (entry.id, D(1500))

    assert "Deshecho" in await _say(db, "deshacer")
    assert await _count(db, ExpenseEntry) == 0
    assert await _level(db, coca) == 0


async def test_raw_material_is_a_plain_expense_without_stock(db):
    await _rotiseria(db)
    await _cat(db, "Materia prima")
    reply = await _say(db, "compré 3 kilos de pan a 6 lucas")
    assert "¿En qué categoría va *Pan* ($6.000,00)?" in reply

    await _say(db, "materia prima")
    entry = await db.scalar(select(ExpenseEntry))
    assert (entry.amount, entry.description) == (D(6000), "Pan")
    assert await _count(db, StockMovement) == 0
    # "12 lucas de verdura": la plata no es una cantidad.
    await _say(db, "compré 12 lucas de verdura")
    assert await db.scalar(select(func.max(ExpenseEntry.amount))) == D(6000)  # pregunta la categoría


async def test_a_stock_purchase_waits_for_the_category_with_its_stock(db):
    _, coca = await _rotiseria(db)
    await _cat(db, "Bebidas")  # sin "Mercadería": hay que preguntar
    assert "¿En qué categoría va" in await _say(db, "compré 6 coca 9000")
    assert await _level(db, coca) == 0
    reply = await _say(db, "bebidas")
    assert "📦 Coca-Cola: hay 6" in reply
    assert await _level(db, coca) == 6


async def test_paying_an_employee_goes_to_their_category(db):
    await _rotiseria(db)
    sueldos = await _cat(db, "Sueldos")
    juan = await payees.create_payee(db, 1, name="Juan Pérez", kind="empleado")
    reply = await _say(db, "pagué 80 lucas a juan")
    assert "✅ $80.000,00 · Juan Pérez — Sueldos" in reply
    entry = await db.scalar(select(ExpenseEntry))
    assert (entry.payee_id, entry.category_id) == (juan.id, sueldos.id)


async def test_a_card_purchase_goes_through_the_app(db):
    await _rotiseria(db)
    assert "desde la app" in await _say(db, "compré 12 coca a 18 lucas con tarjeta")
    assert await _count(db, ExpenseEntry) == 0


# ── Stock ──────────────────────────────────────────────────────────────────────

async def test_production_offers_to_create_the_product_and_undo_removes_the_batch(db):
    empanada, _ = await _rotiseria(db)
    reply = await _say(db, "hice 30 tartas y 20 empanadas")
    assert reply.startswith("No tengo un producto «Tartas». ¿Lo creo?")

    reply = await _say(db, "1")
    assert "✅ Producción de hoy: 30 Tartas (hay 30) · 20 Empanada de carne (hay 20)" in reply
    assert "Creé Tartas en Productos" in reply
    tarta = (await products.resolve_product(db, 1, "tartas"))[0]
    assert tarta.track_stock and await _level(db, tarta) == 30

    # Un "deshacer" se lleva todo lo que cargó ese mensaje.
    assert "Deshecho lo que cargué de Tartas y Empanada de carne" in await _say(db, "deshacer")
    assert await _level(db, tarta) == 0 and await _level(db, empanada) == 0


async def test_count_adjusts_and_query_tells(db):
    _, coca = await _rotiseria(db)
    await stock.record_movement(db, tenant_id=1, user_id=1, product_id=coca.id, kind="compra",
                                qty=D(8), movement_date=business_today())
    reply = await _say(db, "quedan 5 coca")
    assert reply.startswith("📦 Conteo de hoy: Coca-Cola 5 (ajuste -3)")
    assert await _level(db, coca) == 5
    assert await _say(db, "stock coca") == "📦 Coca-Cola: 5"
    assert "Coca-Cola: 5" in await _say(db, "stock")


# ── Empleados ──────────────────────────────────────────────────────────────────

async def test_an_employee_sells_and_counts_but_does_not_buy(db):
    _, coca = await _rotiseria(db)
    assert "✅ Venta de hoy" in await _say(db, "vendí 2 empanadas 3000", EMPLOYEE)
    assert "Conteo de hoy" in await _say(db, "quedan 4 coca", EMPLOYEE)
    assert "Como empleado podés cargar" in await _say(db, "compré 12 coca a 18 lucas", EMPLOYEE)
    assert "lo de hoy y de ayer" in await _say(db, "anteayer vendí 2 empanadas 3000", EMPLOYEE)
    # Un empleado no crea productos: se le avisa en vez de preguntarle.
    assert "Pedile al dueño" in await _say(db, "hice 10 flanes", EMPLOYEE)
    assert await _count(db, ExpenseEntry) == 0
    assert await _count(db, Sale) == 1
