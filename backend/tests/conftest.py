"""Infraestructura de tests del backend.

Dos trampas que este archivo resuelve, en orden:

1. `app.core.firebase` llama a `_init_firebase()` **al importar**, y eso exige
   un archivo real de credenciales. Los services llegan ahí vía
   `routers/expenses` (por `assert_owns_category`), así que acá se stubbea el
   módulo ANTES de cualquier import de `app.*`. Por lo mismo, este conftest
   tiene que ser el primer lugar que importe `app`.

2. `app.core.config.Settings` exige `DATABASE_URL` y `FIREBASE_PROJECT_ID`.
   En la máquina de desarrollo los tapa el `.env`; en un entorno pelado se
   setean acá con valores dummy (la base real de los tests es un SQLite en
   memoria propio, nunca la de `core.database`).
"""
import os
import sys
import types

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")
os.environ.setdefault("FIREBASE_PROJECT_ID", "test")

if "app.core.firebase" not in sys.modules:
    _fake_firebase = types.ModuleType("app.core.firebase")

    async def _no_auth_in_tests(*args, **kwargs):  # pragma: no cover
        raise RuntimeError("get_current_user no está disponible en los tests")

    _fake_firebase.get_current_user = _no_auth_in_tests
    sys.modules["app.core.firebase"] = _fake_firebase

import pytest_asyncio  # noqa: E402
from sqlalchemy import event  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine  # noqa: E402

from app.core.database import Base  # noqa: E402
from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement  # noqa: E402
from app.models.expense import ExpenseCategory, ExpenseEntry  # noqa: E402
from app.models.shared_expense import SharedExpense, SharedExpenseSplit  # noqa: E402
from app.models.mortgage import MortgageRecord  # noqa: E402
from app.models.wa_message import WaMessage  # noqa: E402
from app.models.auth_link_token import AuthLinkToken  # noqa: E402
from app.models.tenant import Tenant  # noqa: E402
from app.models.user import User  # noqa: E402
from app.models.mcp_auth import McpToken  # noqa: E402
from app.models.income import IncomeEntry, IncomeEntryItem, IncomeSource, IncomeSourceField  # noqa: E402
from app.models.currency_operation import CurrencyOperation  # noqa: E402
from app.models.mortgage import MortgageLoan  # noqa: E402
from app.models.payment_reminder import PaymentReminder  # noqa: E402
from app.models.business import Payee, Product, Sale, SaleLine, SalePayment, StockMovement  # noqa: E402
from app.models.contact import SharedContact  # noqa: E402
from app.models.reconciliation import (  # noqa: E402
    CaptureEvent,
    CaptureRule,
    ReconciliationAction,
    ReconciliationSession,
)

# Sólo las tablas que estos tests tocan: `Base.metadata` entera incluye JSONB
# y otros tipos de Postgres que SQLite no puede crear. (Las de conciliación
# declaran sus JSON con `with_variant(JSONB)` justamente para poder estar acá.)
_TABLES = [
    ExpenseCategory.__table__,
    ExpenseEntry.__table__,
    CreditCard.__table__,
    CreditCardStatement.__table__,
    CreditCardItem.__table__,
    SharedExpense.__table__,  # la carga el selectinload de shared_expense en reconcile
    SharedExpenseSplit.__table__,
    MortgageRecord.__table__,
    ReconciliationSession.__table__,
    ReconciliationAction.__table__,
    CaptureRule.__table__,
    CaptureEvent.__table__,
    WaMessage.__table__,
    AuthLinkToken.__table__,
    Tenant.__table__,
    User.__table__,
    McpToken.__table__,
    # Las que consultan los chequeos de "¿este tenant tiene datos?" (services/tenants.py).
    IncomeSource.__table__,
    IncomeSourceField.__table__,
    IncomeEntry.__table__,
    IncomeEntryItem.__table__,
    CurrencyOperation.__table__,
    MortgageLoan.__table__,
    PaymentReminder.__table__,
    # Negocio.
    Payee.__table__,
    Product.__table__,
    Sale.__table__,
    SaleLine.__table__,
    SalePayment.__table__,
    StockMovement.__table__,
    # La agenda: el alta (register/join) vincula contactos al usuario nuevo.
    SharedContact.__table__,
]


def _postgres_date_functions(dbapi_connection, _record):
    """`cash_out_date()` (services/currency.py) estima el vencimiento de un
    resumen sin fecha con `make_date(...) + make_interval(...)`, que SQLite no
    tiene: sin estas dos, nada que cuente por fecha de pago se puede testear.
    Devuelven NULL, así que el COALESCE cae igual que en Postgres para un gasto
    sin tarjeta (su fecha) y para un resumen con vencimiento real (esa fecha).
    Lo único que no se reproduce es la ESTIMACIÓN: un test que dependa de un
    resumen sin `due_date` tiene que cargarle la fecha."""
    dbapi_connection.create_function("make_date", 3, lambda *_: None)
    dbapi_connection.create_function("make_interval", 4, lambda *_: None)


@pytest_asyncio.fixture
async def db():
    """AsyncSession sobre un SQLite en memoria recién creado por test."""
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    event.listen(engine.sync_engine, "connect", _postgres_date_functions)
    async with engine.begin() as conn:
        await conn.run_sync(lambda sync_conn: Base.metadata.create_all(sync_conn, tables=_TABLES))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as session:
        yield session
    await engine.dispose()
