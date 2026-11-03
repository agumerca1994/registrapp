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
from dataclasses import dataclass, field
from datetime import date, timedelta
from decimal import Decimal, InvalidOperation

from sqlalchemy import func, select
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

# "12 lucas", "1,5 palos", "12k", "22mil", "15.000", "1500,50": número + multiplicador.
_AMOUNT_RE = re.compile(
    r"(?<![\w,./-])(\$\s*)?"
    r"(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)"
    r"\s*(lucas?|palos?|mil(?:es)?\b|mill[oó]n(?:es)?\b|k\b)?"
    r"(\s*pesos\b)?",
    re.IGNORECASE,
)
_MULTIPLIER = {
    "luca": 1000, "lucas": 1000, "mil": 1000, "miles": 1000, "k": 1000,
    "palo": 1_000_000, "palos": 1_000_000, "millon": 1_000_000, "millón": 1_000_000,
    "millones": 1_000_000,
}

# Cómo pide la gente que se anote algo: lo de adelante no es parte del gasto.
_REQUEST_RE = re.compile(
    r"^\s*(?:(?:hola|che|buenas|buen\s+d[ií]a)[\s,!.]+)?(?:por\s+favor[\s,]+)?"
    r"(?:(?:quiero|quisiera|necesito|quer[ií]a|hay\s+que|podemos|pod[eé]s|podr[ií]as|me\s+pod[eé]s)\s+)?"
    r"(?:registr|carg|anot|agreg|sum)(?:ar|[aá])(?:me|lo|la)?\b\s*(?:(?:un|una|el|la|este|esta|que)\s+)?",
    re.IGNORECASE,
)
_LEADING_VERB_RE = re.compile(
    r"^\s*(?:(?:hoy|ayer)\s+)?(?:me\s+)?(?:gast[eé]|gastamos|gasto|egreso|pagu[eé]|pagamos|pago|compr[eé]|compramos|"
    r"compra|sali[oó]|salieron|abon[eé]|abonamos|puse|pusimos|saqu[eé]|sacamos)\b[\s:,-]*",
    re.IGNORECASE,
)
_LEADING_FILLER_RE = re.compile(
    r"^(?:(?:de|del|en|el|la|los|las|lo|un|una|unos|unas|al|a|por|mi|mis|para)\s+)+", re.IGNORECASE
)
_TRAILING_FILLER_RE = re.compile(r"(?:\s+(?:de|del|en|el|la|a|al|por|con|y|para))+$", re.IGNORECASE)

# "categoría súper", "descripción zapatero": el dato ya viene con su nombre.
_SLOT_RE = re.compile(r"\b(categor[ií]a|rubro|fuente|descripci[oó]n|detalle|nota)\b\s*:?\s+", re.IGNORECASE)

_CARD_RE = re.compile(
    r"\b(?:con|en|x|por)\s+(?:la\s+|mi\s+|una\s+)?"
    r"(?:(?:tarjeta|tc)(?:\s+de\s+cr[eé]dito)?(?:\s+(?P<name>(?!de\b)[\wáéíóúñ]+(?:\s+d[eé]bito)?))?"
    r"|(?P<brand>visa|master(?:card)?|amex|american\s+express|naranja(?:\s*x)?|cabal|bbva|galicia|santander|macro|naci[oó]n|icbc|hsbc|supervielle|patagonia|credicoop|brubank|uala|ual[aá])(?:\s+d[eé]bito)?)"
    r"(?:\s+(?:terminada\s+en\s+|que\s+termina\s+en\s+)?(?P<last4>\d{4})\b)?",
    re.IGNORECASE,
)
_CUOTAS_RE = re.compile(
    r"(?:\b(?:en|a)\s+)?\b(?P<n>\d{1,2})\s*cuotas?\b(?:\s+(?:sin\s+inter[eé]s|fijas))?"
    r"(?P<per>\s+de\s+(?=\$?\s*\d))?",
    re.IGNORECASE,
)
_METHOD_RE = re.compile(
    r"\b(?:en|con|por|x)\s+(?:la\s+)?(efectivo|d[eé]bito|transferencia|transfer|mercado\s*pago|mp)\b", re.IGNORECASE
)
_METHODS = {"efectivo": "efectivo", "debito": "debito", "transferencia": "transferencia",
            "transfer": "transferencia", "mercado pago": "transferencia", "mercadopago": "transferencia",
            "mp": "transferencia"}
_NAME_LIST = r"(?P<names>[\wáéíóúñ@.+-]+(?:\s*(?:,|\sy\s)\s*[\wáéíóúñ@.+-]+){0,4})"
_SHARE_RES = [
    re.compile(r"\b(?:lo\s+|la\s+)?(?:compart[ií]\w*|divid[ií]\w*|dividirlo|a\s+medias|mitad(?:\s+y\s+mitad)?)\s+con\s+" + _NAME_LIST, re.IGNORECASE),
    re.compile(r"\bcon\s+" + _NAME_LIST + r"\s+a\s+medias\b", re.IGNORECASE),
    re.compile(r"\bentre\s+" + _NAME_LIST + r"\s+y\s+yo\b", re.IGNORECASE),
]

_DATE_NUM_RE = re.compile(
    r"(?:\b(?:con\s+fecha(?:\s+de)?|fecha|del?|el)\s+)?(?<![\d/])(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?(?![\d/])", re.IGNORECASE
)
_DATE_WORDS_RE = re.compile(
    r"(?:\b(?:con\s+fecha(?:\s+de)?|fecha|del?|el)\s+)?\b(\d{1,2})\s+de\s+"
    r"(enero|febrero|marzo|abril|mayo|junio|julio|agosto|sep?tiembre|octubre|noviembre|diciembre)"
    r"(?:\s+(?:de\s+)?(\d{4}))?\b", re.IGNORECASE
)
_WEEKDAY_RE = re.compile(r"\b(?:el\s+)?(lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)(?:\s+pasado)?\b", re.IGNORECASE)
_WEEKDAYS = {"lunes": 0, "martes": 1, "miercoles": 2, "jueves": 3, "viernes": 4, "sabado": 5, "domingo": 6}
_MONTH_NAMES = {
    "enero": 1, "febrero": 2, "marzo": 3, "abril": 4, "mayo": 5, "junio": 6, "julio": 7, "agosto": 8,
    "septiembre": 9, "setiembre": 9, "octubre": 10, "noviembre": 11, "diciembre": 12,
}
# Una fecha escrita a mano puede adelantarse (un ingreso que cae el 1°), no por meses.
_MAX_FUTURE_DAYS = 45
# De acá para arriba el término ya es una frase: es probable que no se haya entendido.
LONG_TERM_WORDS = 6

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
    # Lo que la persona dijo además del monto. Todo opcional.
    description: str | None = None
    category_name: str | None = None   # "categoría súper": nombrada a propósito
    wants_card: bool = False           # dijo tarjeta, una marca o cuotas
    card_hint: str | None = None       # "visa", "4919", "bbva"
    installments: int | None = None
    per_installment: bool = False      # "3 cuotas de 10 lucas": el monto es por cuota
    payment_method: str | None = None
    share_with: list[str] = field(default_factory=list)
    # Había más de un número sin marca, o el término es una frase: el texto puede
    # haberse leído mal. La IA lo mira primero, si está prendida.
    uncertain: bool = False


@dataclass
class CategoryPick:
    category_id: int | None
    category_name: str | None
    source: str | None          # "exact" | "rule" | "suggest" | "created"
    description: str | None     # descripción que impone una regla, si hay
    options: list[str]          # para preguntar, cuando no se pudo decidir


def _parse_number(raw: str) -> Decimal | None:
    try:
        # "1.5" es uno y medio ("1.5 lucas"); "1.500" son mil quinientos.
        if re.fullmatch(r"\d+\.\d{1,2}", raw):
            value = Decimal(raw)
        else:
            value = Decimal(raw.replace(".", "").replace(",", "."))
    except InvalidOperation:
        return None
    return value if 0 < value <= MAX_AMOUNT else None


def parse_quick_text(text: str, today: date | None = None) -> QuickDraft | None:
    """Texto libre → borrador de gasto, o None si no hay un monto claro."""
    draft = parse_amount_text(text, today)
    if draft is None or not draft.term:
        return None
    return draft


def strip_request(text: str) -> str:
    """"Quiero registrar un ingreso de 100000" → "ingreso de 100000"."""
    return _REQUEST_RE.sub("", text or "", count=1)


def _valid_date(year: int, month: int, day: int) -> date | None:
    try:
        return date(year, month, day)
    except ValueError:
        return None


def _month_day(month: int, day: int, year: int | None, today: date) -> date | None:
    """Sin año, el más cercano: en enero, "28/12" es de hace unos días."""
    if year is not None:
        return _valid_date(year if year > 99 else 2000 + year, month, day)
    when = _valid_date(today.year, month, day)
    if when is not None and when > today + timedelta(days=_MAX_FUTURE_DAYS):
        when = _valid_date(today.year - 1, month, day)
    return when


def extract_date(text: str, today: date) -> tuple[date | None, str]:
    """La fecha escrita en el texto y el texto sin ella. "ayer", "el lunes",
    "1/11", "el 5 de octubre". Una fecha absurda no se usa: queda en el texto."""
    for pattern, days in _DATE_WORDS:
        if pattern.search(text):
            return today - timedelta(days=days), pattern.sub(" ", text, count=1)
    when = None
    m = _DATE_NUM_RE.search(text)
    if m:
        when = _month_day(int(m.group(2)), int(m.group(1)), int(m.group(3)) if m.group(3) else None, today)
    if when is None:
        m = _DATE_WORDS_RE.search(text)
        if m:
            when = _month_day(
                _MONTH_NAMES[fold_text(m.group(2))], int(m.group(1)),
                int(m.group(3)) if m.group(3) else None, today,
            )
    if when is not None and today - timedelta(days=400) <= when <= today + timedelta(days=_MAX_FUTURE_DAYS):
        return when, text[: m.start()] + " " + text[m.end():]
    m = _WEEKDAY_RE.search(text)
    if m:
        back = (today.weekday() - _WEEKDAYS[fold_text(m.group(1))]) % 7
        return today - timedelta(days=back or 7), text[: m.start()] + " " + text[m.end():]
    return None, text


def _clean_term(term: str) -> str:
    term = re.sub(r"\s{2,}", " ", term).strip(" .,;:-¿?¡!")
    term = _LEADING_VERB_RE.sub("", term, count=1)
    term = _LEADING_FILLER_RE.sub("", term)
    term = _TRAILING_FILLER_RE.sub("", term)
    return term.strip(" .,;:-¿?¡!")


def _pop_slots(text: str) -> tuple[str, dict[str, str]]:
    """Saca "categoría X" y "descripción Y" del texto. Cada uno llega hasta el
    próximo nombre de dato o el final."""
    matches = list(_SLOT_RE.finditer(text))
    slots: dict[str, str] = {}
    if not matches:
        return text, slots
    for i, m in enumerate(matches):
        stop = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        value = text[m.end():stop].strip(" .,;:-")
        key = fold_text(m.group(1))
        if value:
            slots["category" if key in ("categoria", "rubro", "fuente") else "description"] = value[:120]
    return text[: matches[0].start()], slots


def _pop_card(text: str, draft_fields: dict) -> str:
    m = _CARD_RE.search(text)
    if not m:
        return text
    draft_fields["wants_card"] = True
    draft_fields["card_hint"] = m.group("last4") or m.group("name") or m.group("brand")
    return text[: m.start()] + " " + text[m.end():]


def _pop_share(text: str, draft_fields: dict) -> str:
    for pattern in _SHARE_RES:
        m = pattern.search(text)
        if m:
            names = [n.strip() for n in re.split(r",|\sy\s", m.group("names")) if n.strip()]
            draft_fields["share_with"] = names[:5]
            return text[: m.start()] + " " + text[m.end():]
    return text


def _choose_amount(matches: list[re.Match]) -> tuple[re.Match | None, bool]:
    """El número que es la plata. Uno con marca ($, lucas, mil, pesos) le gana a
    uno pelado; entre pelados, el más grande ("2 kilos de carne 15000"), y queda
    marcado como dudoso porque es una deducción."""
    if not matches:
        return None, False
    marked = [m for m in matches if m.group(1) or m.group(3) or m.group(4)]
    if marked:
        return marked[0], False
    if len(matches) == 1:
        return matches[0], False
    values = sorted(((_parse_number(m.group(2)) or Decimal(0)), i) for i, m in enumerate(matches))
    best, runner_up = values[-1], values[-2]
    # "15000 kiosco 24": diez veces más grande ya no es duda.
    return matches[best[1]], best[0] < runner_up[0] * 10


def parse_amount_text(text: str, today: date | None = None) -> QuickDraft | None:
    """Monto, moneda y fecha de un texto; lo que sobra queda en `term`, que
    puede venir vacío. Lo comparten el gasto y el ingreso ("cobré 850 lucas")."""
    today = today or ar_today()
    original = text.strip()
    if not original:
        return None

    legacy = bool(LEGACY_RE.match(original))
    fields: dict = {}
    working = strip_request(original)

    currency = "ARS"
    if _USD_RE.search(working):
        currency = "USD"
        working = _USD_RE.sub(" ", working)

    when, working = extract_date(working, today)
    expense_date = when or today

    # Antes de buscar el monto: "visa 4919" y "3 cuotas" también son números.
    working = _pop_card(working, fields)
    cuotas = _CUOTAS_RE.search(working)
    if cuotas and 2 <= int(cuotas.group("n")) <= 60:
        fields["wants_card"] = True
        fields["installments"] = int(cuotas.group("n"))
        fields["per_installment"] = bool(cuotas.group("per"))
        working = working[: cuotas.start()] + " " + working[cuotas.end():]
    method = _METHOD_RE.search(working)
    if method:
        fields["payment_method"] = _METHODS.get(fold_text(re.sub(r"\s+", " ", method.group(1))))
        working = working[: method.start()] + " " + working[method.end():]
    working = _pop_share(working, fields)
    # Al final: "categoría nafta con la visa" no es una categoría de cuatro palabras.
    # Si el monto quedó después del nombre del dato, no son datos sino el texto.
    head, slots = _pop_slots(working)
    if _AMOUNT_RE.search(head):
        working = head
    else:
        slots = {}

    m, doubtful = _choose_amount(list(_AMOUNT_RE.finditer(working)))
    if m is None:
        return None
    value = _parse_number(m.group(2))
    if value is None:
        return None
    mult = _MULTIPLIER.get(fold_text(m.group(3) or ""))
    if mult:
        value = (value * mult).quantize(Decimal("0.01"))
    if value > MAX_AMOUNT:
        return None

    term = _clean_term(working[: m.start()] + " " + working[m.end():])
    return QuickDraft(
        amount=value, currency=currency, expense_date=expense_date,
        term=term, legacy=legacy,
        description=slots.get("description"), category_name=slots.get("category"),
        uncertain=doubtful or len(term.split()) >= LONG_TERM_WORDS,
        **fields,
    )


@dataclass
class CaptionHints:
    """Lo que alguien escribió junto a una foto o un PDF."""
    when: date | None = None
    kind: str | None = None    # "income" | "expense", si lo dijo
    note: str | None = None    # el resto, si se puede usar como descripción


_CAPTION_INCOME_RE = re.compile(r"\b(ingreso|cobr[eé]|me\s+(?:pagaron|entr[oó]|transfirieron|depositaron))\b", re.IGNORECASE)
_CAPTION_EXPENSE_RE = re.compile(r"\b(gasto|egreso|pagu[eé]|gast[eé])\b", re.IGNORECASE)
_CAPTION_NOISE_RE = re.compile(
    r"\b(este|esta|esto|es|un|una|el|la|de|comprobante|registr\w*|carg\w*|anot\w*|podemos|pod[eé]s|quiero)\b",
    re.IGNORECASE,
)


def caption_hints(text: str | None, today: date | None = None) -> CaptionHints:
    today = today or ar_today()
    raw = (text or "").strip()
    if not raw:
        return CaptionHints()
    when, rest = extract_date(raw, today)
    kind = None
    if _CAPTION_INCOME_RE.search(rest):
        kind, rest = "income", _CAPTION_INCOME_RE.sub(" ", rest)
    elif _CAPTION_EXPENSE_RE.search(rest):
        kind, rest = "expense", _CAPTION_EXPENSE_RE.sub(" ", rest)
    # Una pregunta no es una descripción: "¿podemos registrar esto?" no describe nada.
    is_question = "?" in raw
    note = re.sub(r"\s{2,}", " ", _CAPTION_NOISE_RE.sub(" ", rest) if kind or when else rest)
    note = note.strip(" .,;:-¿?¡!")
    if is_question or not note or len(note) > 60 or not re.search(r"[A-Za-zÁÉÍÓÚÑáéíóúñ]", note):
        note = None
    return CaptionHints(when=when, kind=kind, note=note)


# Las que se muestran al preguntar: pocas y las que se usan. Con el orden de
# creación, la que hacía falta no aparecía y la persona escribía el nombre a ciegas.
MAX_CATEGORY_OPTIONS = 6
USD_CATEGORY_NAME = "Consumo en dólares"


async def category_options(db: AsyncSession, tenant_id: int, cats) -> list[str]:
    """Las categorías más usadas en los últimos meses, sin nombres repetidos y
    sin la de dólares (es automática, nunca una opción para un gasto en pesos)."""
    rows = await db.execute(
        select(ExpenseEntry.category_id, func.count(ExpenseEntry.id))
        .where(
            ExpenseEntry.tenant_id == tenant_id,
            ExpenseEntry.expense_date >= ar_today() - timedelta(days=180),
        )
        .group_by(ExpenseEntry.category_id)
    )
    uses = dict(rows.all())
    ordered = sorted(cats, key=lambda c: (-uses.get(c.id, 0), c.id))
    seen: set[str] = set()
    out: list[str] = []
    for c in ordered:
        key = fold_text(c.name).strip()
        if key in seen or key == fold_text(USD_CATEGORY_NAME):
            continue
        seen.add(key)
        out.append(c.name)
    return out[:MAX_CATEGORY_OPTIONS]


async def resolve_category(
    db: AsyncSession, tenant_id: int, term: str, *, allow_create: bool
) -> CategoryPick:
    """De un término a una categoría del hogar, en el orden barato→caro:
    nombre exacto → regla comercio→categoría → sugerencia por historial →
    crearla (formato histórico, o un hogar sin categorías) → preguntar."""
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

    # Un hogar recién creado no tiene categorías: no hay ninguna que elegir mal,
    # y sin esto el primer gasto (el que esperaba el alta por WhatsApp) no se
    # podía cargar. El término pasa a ser la categoría, como en el formato histórico.
    if allow_create or not cats:
        return CategoryPick(None, term, "created", None, [])

    return CategoryPick(None, None, None, None, await category_options(db, tenant_id, cats))


async def create_quick_expense(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int,
    draft: QuickDraft,
    category_id: int,
    description: str | None = None,
    payment_method: str | None = None,
    payee_id: int | None = None,
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
        payee_id=payee_id,
        source=EXPENSE_SOURCE_WHATSAPP,
    )
    db.add(entry)
    await db.flush()
    category_suggest.invalidate(tenant_id)
    return entry
