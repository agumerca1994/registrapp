from app.models.tenant import Tenant
from app.models.user import User
from app.models.income import IncomeSource, IncomeEntry, IncomeSourceField, IncomeEntryItem
from app.models.expense import ExpenseCategory, ExpenseEntry
# `expense_entries.payee_id` apunta a `payees`: la tabla tiene que estar en la
# metadata para cualquier create_all (los tests importan modelos sueltos).
from app.models.business import Payee
from app.models.macro_variable import MacroVariable
from app.models.mortgage import MortgageRecord
from app.models.shared_expense import SharedExpense, SharedExpenseSplit
from app.models.credit_card import CreditCard, CreditCardStatement, CreditCardItem
from app.models.contact import TenantContact, SharedContact
from app.models.app_log import AppLog
from app.models.payment_reminder import PaymentReminder
from app.models.device_token import DeviceToken
from app.models.currency_operation import CurrencyOperation
from app.models.mcp_auth import (
    McpAuthCode, McpOAuthAuthorization, McpOAuthClient, McpToken,
)
from app.models.wa_message import WaMessage
from app.models.auth_link_token import AuthLinkToken
from app.models.reconciliation import (
    CaptureEvent, CaptureRule, ReconciliationAction, ReconciliationSession,
)

__all__ = [
    "Tenant", "User",
    "IncomeSource", "IncomeEntry", "IncomeSourceField", "IncomeEntryItem",
    "ExpenseCategory", "ExpenseEntry",
    "MacroVariable", "MortgageRecord",
    "SharedExpense", "SharedExpenseSplit",
    "CreditCard", "CreditCardStatement", "CreditCardItem",
    "TenantContact",
    "SharedContact",
    "AppLog",
    "PaymentReminder",
    "DeviceToken",
    "CurrencyOperation",
    "McpOAuthClient", "McpOAuthAuthorization", "McpAuthCode", "McpToken",
    "ReconciliationSession", "ReconciliationAction", "CaptureRule", "CaptureEvent",
    "WaMessage", "AuthLinkToken",
    "Payee",
]
