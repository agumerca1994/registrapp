"""Captura rápida de un gasto desde texto libre ("12 lucas verdu").

Todo en código, sin IA: la jerga argentina de montos es un vocabulario chico
y cerrado ("lucas", "palos", "k"), la moneda y la fecha son un par de palabras,
y el resto del texto es el comercio o la categoría. La IA de respaldo, si los
datos del embudo la justifican, entraría recién cuando esto devuelve None —
y `capture_events` registra exactamente cuántas veces pasa.

El formato histórico del bot (`monto categoria`, una sola palabra) sigue
funcionando con su semántica original, incluida la creación de la categoría
si no existe: era el contrato publicado del bot y hay usuarios acostumbrados.
Para texto libre nunca se crea una categoría en silencio — se pregunta.
"""
from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.expense import EXPENSE_SOURCE_WHATSAPP, ExpenseCategory, ExpenseEntry
from app.services import category_suggest
from app.services.clock import ar_today
from app.services.reconcile import rules as capture_rules
from app.services.search import fold_text

MAX_AMOUNT = Decimal("999999999.00")

# Paleta para categorías creadas por el bot (la histórica del webhook).
CATEGORY_COLORS = [
    "#ef4444", "#f97316", "#eab308", "#22c55e", "#14b8a6",
    "#3b82f6", "#8b5cf6", "#ec4899", "#f43f5e", "#06b6d4",
]

# "12 lucas", "1,5 palos", "12k", "15.000", "1500,50" — número + multiplicador.
_AMOUNT_RE = re.compile(
    r"(?<![\w,])(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:,\d{1,2})?)\s*(lucas?|palos?|k\b)?",
    re.IGNORECASE,
)
_MULTIPLIER = {"luca": 1000, "lucas": 1000, "palo": 1_000_000, "palos": 1_000_000, "k": 1000}

_USD_RE = re.compile(r"(?<!\w)(usd|u\$s|u\$d|d[oó]lares|d[oó]lar|verdes)(?!\w)", re.IGNORECASE)

_DATE_WORDS = [
    (re.compile(r"(?<!\w)antes\s+de\s+ayer(?!\w)", re.IGNORECASE), 2),
    (re.compile(r"(?<!\w)anteayer(?!\w)", re.IGNORECASE), 2),
    (re.compile(r"(?<!\w)ayer(?!\w)", re.IGNORECASE), 1),
    (re.compile(r"(?<!\w)hoy(?!\w)", re.IGNORECASE), 0),
]

# El formato histórico del bot: monto + categoría de UNA palabra.
LEGACY_RE = re.compile(r"^([\d.,]+)\s+(\S+)$")


@dataclass
class QuickDraft:
    amount: Decimal
    currency: str  # "ARS" | "USD"
    expense_date: date
    term: str      # lo que queda del texto: comercio o categoría
    legacy: bool   # vino en el formato histórico `monto categoria`


@dataclass
class CategoryPick:
    category_id: int | None
    category_name: str | None
    source: str | None          # "exact" | "rule" | "suggest" | "created"
    description: str | None     # descripción que impone una regla, si hay
    options: list[str]          # para preguntar, cuando no se pudo decidir


def _parse_number(raw: str) -> Decimal | None:
    try:
        value = Decimal(raw.replace(".", "").replace(",", "."))
    except InvalidOperation:
        return None
    return value if 0 < value <= MAX_AMOUNT else None


def parse_quick_text(text: str, today: date | None = None) -> QuickDraft | None:
    """Texto libre → borrador de gasto, o None si no hay un monto claro."""
    today = today or ar_today()
    original = text.strip()
    if not original:
        return None

    legacy = bool(LEGACY_RE.match(original))
    working = original

    currency = "ARS"
    if _USD_RE.search(working):
        currency = "USD"
        working = _USD_RE.sub(" ", working)

    expense_date = today
    for pattern, days in _DATE_WORDS:
        if pattern.search(working):
            expense_date = today - timedelta(days=days)
            working = pattern.sub(" ", working)
            break

    m = _AMOUNT_RE.search(working)
    if not m:
        return None
    value = _parse_number(m.group(1))
    if value is None:
        return None
    mult = _MULTIPLIER.get((m.group(2) or "").lower())
    if mult:
        value = (value * mult).quantize(Decimal("0.01"))
    if value > MAX_AMOUNT:
        return None

    term = (working[: m.start()] + " " + working[m.end():]).strip()
    term = re.sub(r"\s{2,}", " ", term).strip(" .,;:-")
    if not term:
        return None

    return QuickDraft(
        amount=value, currency=currency, expense_date=expense_date,
        term=term, legacy=legacy,
    )


async def resolve_category(
    db: AsyncSession, tenant_id: int, term: str, *, allow_create: bool
) -> CategoryPick:
    """De un término a una categoría del hogar, en el orden barato→caro:
    nombre exacto → regla comercio→categoría → sugerencia por historial →
    (sólo formato histórico) crearla → preguntar."""
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == tenant_id)
    )).all()

    folded = fold_text(term)
    exact = next((c for c in cats if fold_text(c.name) == folded), None)
    if exact:
        return CategoryPick(exact.id, exact.name, "exact", None, [])

    merchant_rules = await capture_rules.get_rules(
        db, tenant_id, capture_rules.KIND_MERCHANT_CATEGORY
    )
    rule = merchant_rules.get(capture_rules.merchant_key(term))
    if rule and rule.get("category_id"):
        cat = next((c for c in cats if c.id == rule["category_id"]), None)
        if cat:
            return CategoryPick(cat.id, cat.name, "rule", rule.get("description"), [])

    suggestion = await category_suggest.suggest_category(db, tenant_id, term)
    if suggestion:
        return CategoryPick(
            suggestion.category_id, suggestion.category_name, "suggest", None, []
        )

    if allow_create:
        return CategoryPick(None, term, "created", None, [])

    return CategoryPick(None, None, None, None, [c.name for c in cats][:9])


async def create_quick_expense(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    draft: QuickDraft,
    category_id: int,
    description: str | None = None,
    payment_method: str | None = None,
) -> ExpenseEntry:
    """Crea el gasto. **Sólo flush** — el commit es del caller (el bot commitea
    y recién después responde, la regla de avisar-después-de-commitear)."""
    entry = ExpenseEntry(
        tenant_id=tenant_id,
        user_id=user_id,
        category_id=category_id,
        amount=draft.amount,
        description=(description or draft.term)[:255],
        expense_date=draft.expense_date,
        currency=draft.currency,
        payment_method=payment_method,
        source=EXPENSE_SOURCE_WHATSAPP,
    )
    db.add(entry)
    await db.flush()
    category_suggest.invalidate(tenant_id)
    return entry
