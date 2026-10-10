"""Lo que escribe un negocio por WhatsApp, leído en código y sin IA.

Mismo criterio que `services/quick_capture.py`: un vocabulario chico y cerrado
alcanza. Un mensaje de negocio empieza con lo que pasó (vendí, cierre, compré,
hice, quedan, pagué, stock) y el resto son cantidades, productos, plata y cómo
se cobró. Este módulo es puro (sin base): devuelve una `Intent` y
`services/business/bot.py` la resuelve contra los productos y la ejecuta.

Lo difícil es **separar cantidades de plata**, que es justo lo que el gasto
genérico no hace ("compré 12 coca a 18 lucas" era un gasto de $12):

- Es plata: `$N`, `N lucas/luca/k/mil/palos/pesos`, el número después de "a",
  "por" o "total", y un número que no va seguido de un producto (al final,
  antes de un medio de pago o de un conector).
- Es cantidad: un número (o "una", "dos", "media docena") seguido de una
  palabra que no es plata, ni medio de pago, ni conector: "3 empanadas",
  "una coca", "1,5 kg de asado".
- En un cierre la unidad se dice una vez ("200 lucas efectivo, 150 mp"): si
  algún monto vino con lucas/k/mil, un número suelto menor a mil se lee en
  miles.

El bot repite siempre lo que entendió, y todo se puede deshacer.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation

from app.services.search import fold_text

MULTIPLIERS = {
    "luca": 1000, "lucas": 1000, "k": 1000, "mil": 1000,
    "palo": 1_000_000, "palos": 1_000_000,
    "peso": 1, "pesos": 1, "mango": 1, "mangos": 1,
}
METHODS = {
    "efectivo": "efectivo", "cash": "efectivo",
    "mercadopago": "mercadopago", "mp": "mercadopago", "qr": "mercadopago",
    "debito": "debito", "credito": "credito", "tarjeta": "credito",
    "transferencia": "transferencia", "transf": "transferencia",
}
# Frases de más de una palabra que se vuelven un token antes de partir. El
# texto ya llega plegado (sin tildes, en minúscula).
_PHRASES = [
    (re.compile(r"mercado\s*pago"), "mercadopago"),
    (re.compile(r"tarjeta\s+(?:de\s+)?debito"), "debito"),
    (re.compile(r"tarjeta\s+(?:de\s+)?credito"), "credito"),
    (re.compile(r"\bal\s+contado\b"), "efectivo"),
    (re.compile(r"\ben\s+total\b"), "total"),
    (re.compile(r"\bantes\s+de\s+ayer\b"), "anteayer"),
    (re.compile(r"\bc\s*/\s*u\b|\bcada\s+un[oa]\b"), " cu "),
]
USD_WORDS = {"usd", "u$s", "u$d", "dolares", "dolar", "verdes"}
CONNECTORS = {",", "y", "e", "mas"}
MONEY_PREPS = {"a", "por", "total", "x"}
# "con mp", "en efectivo", "por transferencia": la palabra se va con el medio.
_BEFORE_METHOD = {"con", "en", "por", "via"}
DATES = {"hoy": 0, "ayer": 1, "anteayer": 2}
NUMBER_WORDS = {
    "un": 1, "una": 1, "uno": 1, "dos": 2, "tres": 3, "cuatro": 4, "cinco": 5,
    "seis": 6, "siete": 7, "ocho": 8, "nueve": 9, "diez": 10, "once": 11, "doce": 12,
    "quince": 15, "veinte": 20, "treinta": 30, "cuarenta": 40, "cincuenta": 50,
    "medio": Decimal("0.5"), "media": Decimal("0.5"),
}
DOZEN = {"docena", "docenas"}
# Unidades que no cambian qué producto es: "1,5 kg de asado" es asado. Los
# envases no van ("2 cajas de coca" no son 2 cocas): quedan en el nombre, no
# matchean ningún producto y la compra se carga como gasto.
UNIT_WORDS = {"kg", "kgs", "kilo", "kilos", "porcion", "porciones", "unidad", "unidades"}
_FILLER = {"de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas", "al", "lo"}
# Lo que rodea a una venta sin cantidades y no es un producto ("venta del día 6500").
_NOISE = _FILLER | {"dia", "venta", "ventas", "total", "caja", "hoy", "en", "por", "con", "que", "me", "le", "nos"}

_NUMBER = re.compile(r"^\$?(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,3})?)$")

VERBS = {
    **dict.fromkeys(("vendi", "vendimos", "vendio", "vendieron", "vendo", "venta", "ventas"), "sale"),
    **dict.fromkeys(("compre", "compramos", "compro", "compraron"), "purchase"),
    **dict.fromkeys(("hice", "hicimos", "hicieron", "produje", "produjimos", "cocine", "cocinamos",
                     "prepare", "preparamos"), "production"),
    **dict.fromkeys(("quedan", "queda", "hay"), "count"),
    **dict.fromkeys(("pague", "pagamos", "pago", "abone", "abonamos"), "pay"),
}
CLOSE_VERBS = {"cierre", "cerre", "cerramos", "cerro", "cerrar"}
# Lo que puede ir antes del verbo: "ayer vendí", "le pagué", "ya cerramos".
_LEAD = {"le", "les", "nos", "me", "se", "ya", "recien"}

_QUERY_RES = [
    re.compile(r"^cuant[oa]s?\s+(?P<term>.+?)\s+(?:hay|queda|quedan|tenemos|tengo)$"),
    re.compile(r"^cuant[oa]s?\s+(?:hay|queda|quedan|tenemos|tengo)\s+(?:de\s+)?(?P<term>.+)$"),
]


@dataclass
class Item:
    qty: Decimal
    term: str


@dataclass
class Intent:
    """Qué pasó. `op`: sale | close | purchase | production | count | query |
    pay | expense | ambiguous (cantidad + producto + plata sin verbo: venta o
    compra, se pregunta)."""
    op: str
    items: list[Item] = field(default_factory=list)
    amount: Decimal | None = None       # el total (con `each`, el precio de cada uno)
    method: str | None = None
    # Un pago dividido ("4500 efectivo y 2000 mp"): medio → monto.
    payments: dict[str, Decimal] = field(default_factory=dict)
    day_offset: int = 0
    term: str = ""                      # query / expense
    payee_term: str | None = None
    counted: dict[str, Decimal] = field(default_factory=dict)  # close
    each: bool = False                  # "a 1500 c/u"


@dataclass
class _Parsed:
    items: list[Item] = field(default_factory=list)
    amounts: list[list] = field(default_factory=list)  # [monto, medio | None]
    method: str | None = None
    day_offset: int = 0
    payee_term: str | None = None
    each: bool = False
    words: list[str] = field(default_factory=list)  # lo suelto; "|" separa grupos

    @property
    def amount(self) -> Decimal | None:
        return sum((a for a, _ in self.amounts), Decimal(0)) if self.amounts else None

    @property
    def payments(self) -> dict[str, Decimal]:
        """Sólo si cada monto dijo su medio y son todos distintos."""
        methods = [m for _, m in self.amounts]
        if len(self.amounts) < 2 or None in methods or len(set(methods)) != len(methods):
            return {}
        return {m: a for a, m in self.amounts}

    @property
    def single_method(self) -> str | None:
        methods = {m for _, m in self.amounts if m}
        return next(iter(methods)) if len(methods) == 1 else self.method


def _number(tok: str) -> Decimal | None:
    m = _NUMBER.match(tok)
    if not m:
        return None
    raw = m.group(1)
    if "," in raw:                                      # 1.500,50 / 1,5
        raw = raw.replace(".", "").replace(",", ".")
    elif re.fullmatch(r"\d{1,3}(?:\.\d{3})+", raw):     # 15.000
        raw = raw.replace(".", "")
    try:
        return Decimal(raw)
    except InvalidOperation:
        return None


def _tokens(text: str) -> list[str]:
    t = fold_text(text or "")
    for pattern, repl in _PHRASES:
        t = pattern.sub(repl, t)
    t = re.sub(r"(\d)(lucas?|k|mil|palos?|pesos?|kgs?|kilos?)\b", r"\1 \2", t)  # "12k" → "12 k"
    t = re.sub(r"\$\s*", "$", t)
    t = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", t)    # el punto que termina una frase, no el de miles
    t = re.sub(r"(?<!\d),|,(?!\d)", " , ", t)    # la coma que separa, no la decimal
    t = re.sub(r"[;:+]", " , ", t)
    t = re.sub(r"[¿?¡!()\"'*_]", " ", t)
    t = re.sub(r"(?<!\w)-+|-+(?!\w)", " ", t)    # el guion suelto; "coca-cola" queda
    return t.split()


def _kind(tok: str) -> str:
    if tok in DATES:
        return "date"
    if tok in METHODS:
        return "method"
    if tok in MULTIPLIERS:
        return "mult"
    if tok in USD_WORDS:
        return "usd"
    if tok in CONNECTORS:
        return "conn"
    if tok == "cu":
        return "each"
    if _number(tok) is not None:
        return "num"
    return "word"


def _is_qty(tokens: list[str], i: int) -> bool:
    """¿Arranca una cantidad en `i`? Un número o "una"/"dos"/"media" seguido
    de una palabra que no es plata ni un "a 18 lucas"."""
    tok = tokens[i]
    nxt = tokens[i + 1] if i + 1 < len(tokens) else None
    if nxt is None or _kind(nxt) != "word" or tok.startswith("$"):
        return False
    after = tokens[i + 2] if i + 2 < len(tokens) else None
    if nxt in MONEY_PREPS | _BEFORE_METHOD and after is not None and _kind(after) in ("num", "method"):
        return False  # "12 a 18 lucas", "4.500 en efectivo"
    return _kind(tok) == "num" or tok in NUMBER_WORDS


def _qty_value(tok: str) -> Decimal:
    value = _number(tok)
    return value if value is not None else Decimal(NUMBER_WORDS[tok])


def _strip(words: list[str], noise: set[str] = _FILLER) -> list[str]:
    w = [x for x in words if x != "|"]
    while w and w[0] in noise:
        w = w[1:]
    while w and w[-1] in noise:
        w = w[:-1]
    return w


def _item_term(words: list[str]) -> str:
    w = list(words)
    if len(w) > 1 and w[0] in UNIT_WORDS:
        w = w[1:]
    return " ".join(_strip(w))


def _groups(words: list[str]) -> list[str]:
    """Lo suelto partido por los conectores: "empanada y coca" → dos."""
    groups, current = [], []
    for w in words + ["|"]:
        if w == "|":
            term = " ".join(_strip(current, _NOISE))
            if term:
                groups.append(term)
            current = []
        else:
            current.append(w)
    return groups


def _scan(tokens: list[str], *, allow_payee: bool) -> _Parsed:
    out = _Parsed()
    i, n = 0, len(tokens)
    last_was_amount = False
    pending_method: str | None = None

    def money_at(j: int) -> int:
        nonlocal pending_method, last_was_amount
        value = _number(tokens[j])
        j += 1
        if j < n and tokens[j] in MULTIPLIERS:
            value *= MULTIPLIERS[tokens[j]]
            j += 1
        out.amounts.append([value, pending_method])
        last_was_amount = pending_method is None
        pending_method = None
        return j

    while i < n:
        tok, kind = tokens[i], _kind(tokens[i])
        nxt = tokens[i + 1] if i + 1 < n else None
        if kind == "date":
            out.day_offset = DATES[tok]
            i += 1
        elif kind == "method":
            method = METHODS[tok]
            out.method = method
            if last_was_amount and out.amounts[-1][1] is None:
                out.amounts[-1][1] = method   # "4500 efectivo": el medio del monto anterior
            else:
                pending_method = method       # "efectivo 4500": el del siguiente
            last_was_amount = False
            i += 1
        elif kind in ("conn", "usd"):
            out.words.append("|")
            i += 1
        elif kind == "each":
            out.each = True
            i += 1
        elif tok in _BEFORE_METHOD and nxt is not None and _kind(nxt) == "method":
            i += 1
        elif tok in MONEY_PREPS and nxt is not None and _kind(nxt) == "num":
            i = money_at(i + 1)
        elif allow_payee and tok == "a" and nxt is not None and _kind(nxt) == "word":
            # "a juan", "a la verdulería": a quién se le pagó.
            words, i = [], i + 1
            while i < n and _kind(tokens[i]) == "word" and tokens[i] not in _BEFORE_METHOD:
                if tokens[i] in MONEY_PREPS and i + 1 < n and _kind(tokens[i + 1]) == "num":
                    break
                words.append(tokens[i])
                i += 1
            out.payee_term = " ".join(_strip(words)) or None
            last_was_amount = False
        elif _is_qty(tokens, i):
            qty = _qty_value(tok)
            i += 1
            if tokens[i] in DOZEN:                     # "media docena", "2 docenas"
                qty *= 12
                i += 1
            words = []
            while i < n and _kind(tokens[i]) == "word":
                t = tokens[i]
                after = tokens[i + 1] if i + 1 < n else None
                if words and t in NUMBER_WORDS and _is_qty(tokens, i):
                    break                              # "3 empanadas una coca"
                if after is not None and t in MONEY_PREPS | _BEFORE_METHOD and _kind(after) in ("num", "method"):
                    break
                words.append(t)
                i += 1
            term = _item_term(words)
            if term:
                out.items.append(Item(qty=qty, term=term))
                last_was_amount = False
            else:  # sólo relleno después del número: era plata
                out.amounts.append([qty, pending_method])
                last_was_amount, pending_method = pending_method is None, None
        elif kind == "num":
            i = money_at(i)
        else:
            out.words.append(tok)
            last_was_amount = False
            i += 1
    return out


def _close(tokens: list[str]) -> Intent | None:
    """El cierre: montos por medio de pago. Un monto sin medio es efectivo."""
    amounts: list[list] = []  # [monto, medio | None, sin unidad]
    pending_method: str | None = None
    last_was_amount = False
    any_thousands = False
    day_offset = 0
    i, n = 0, len(tokens)
    while i < n:
        tok, kind = tokens[i], _kind(tokens[i])
        if kind == "date":
            day_offset = DATES[tok]
            i += 1
        elif kind == "num" and _is_qty(tokens, i):
            # "salieron 40 empanadas": unidades, no plata (el cierre por chat
            # no las toma; se cargan en la app).
            i += 1
            while i < n and _kind(tokens[i]) == "word":
                i += 1
            last_was_amount = False
        elif kind == "num":
            value, bare = _number(tok), True
            i += 1
            if i < n and tokens[i] in MULTIPLIERS:
                mult = MULTIPLIERS[tokens[i]]
                value *= mult
                bare = mult == 1
                any_thousands = any_thousands or mult >= 1000
                i += 1
            amounts.append([value, pending_method, bare])
            last_was_amount = pending_method is None
            pending_method = None
        elif kind == "method":
            method = METHODS[tok]
            if last_was_amount and amounts[-1][1] is None:
                amounts[-1][1] = method
            else:
                pending_method = method
            last_was_amount = False
            i += 1
        elif kind == "conn" or tok in _BEFORE_METHOD:
            i += 1
        else:
            last_was_amount = False
            i += 1
    if not amounts:
        return None
    counted: dict[str, Decimal] = {}
    for value, method, bare in amounts:
        if any_thousands and bare and value < 1000:
            value *= 1000
        key = method or "efectivo"
        counted[key] = counted.get(key, Decimal(0)) + value
    if any(v <= 0 for v in counted.values()):
        return None
    return Intent(op="close", counted=counted, day_offset=day_offset)


def _verbless(tokens: list[str], day: int) -> Intent | None:
    """"3 empanadas 4500", "12 coca 18000": cantidad chica + producto + plata.
    Puede ser una venta o una compra: el bot pregunta. "15000 súper" o "45
    lucas alquiler" no son esto (son gastos, como siempre)."""
    if not _is_qty(tokens, 0) or _qty_value(tokens[0]) > 999:
        return None
    parsed = _scan(tokens, allow_payee=False)
    if not parsed.items or parsed.amount is None:
        return None
    return Intent(
        op="ambiguous", items=parsed.items, amount=parsed.amount, method=parsed.single_method,
        payments=parsed.payments, day_offset=parsed.day_offset or day, each=parsed.each,
    )


def parse_business_text(text: str) -> Intent | None:
    """Texto → intención de negocio, o None si no es una (va al gasto simple)."""
    raw = fold_text(text or "").lstrip("¿¡").rstrip("?!. ").strip()
    if not raw:
        return None
    for rx in _QUERY_RES:
        m = rx.match(raw)
        if m:
            return Intent(op="query", term=" ".join(_strip(_tokens(m.group("term")))))

    tokens = _tokens(text)
    # Lo que está en dólares no es una venta ni una compra del negocio: sigue
    # al gasto en USD de siempre.
    if not tokens or any(_kind(t) == "usd" for t in tokens):
        return None
    day = 0
    while tokens and (tokens[0] in DATES or tokens[0] in _LEAD):
        day = DATES.get(tokens[0], day)
        tokens = tokens[1:]
    if not tokens:
        return None
    verb, rest = tokens[0], tokens[1:]

    if verb == "stock":
        return Intent(op="query", term=" ".join(_strip(rest)))
    if verb in CLOSE_VERBS:
        intent = _close(rest)
        if intent is not None and not intent.day_offset:
            intent.day_offset = day
        return intent
    op = VERBS.get(verb)
    if op is None:
        return _verbless(tokens, day)

    parsed = _scan(rest, allow_payee=op in ("purchase", "pay"))
    day = parsed.day_offset or day
    common = dict(amount=parsed.amount, method=parsed.single_method, payments=parsed.payments,
                  day_offset=day, each=parsed.each)

    if op == "sale":
        items = parsed.items or [Item(qty=Decimal(1), term=g) for g in _groups(parsed.words)]
        if not items and parsed.amount is None:
            return None
        return Intent(op="sale", items=items, **common)
    if op == "purchase":
        if parsed.items:
            return Intent(op="purchase", items=parsed.items, payee_term=parsed.payee_term, **common)
        term = " ".join(_groups(parsed.words))
        if parsed.amount is not None and term:
            # "compré 12 lucas de verdura": plata y lo que se compró, sin
            # cantidades. Es un gasto (materia prima), no stock.
            return Intent(op="expense", term=term, payee_term=parsed.payee_term, **common)
        return None
    if op == "production":
        return Intent(op="production", items=parsed.items, day_offset=day) if parsed.items else None
    if op == "count":
        if parsed.items:
            return Intent(op="count", items=parsed.items, day_offset=day)
        term = " ".join(_groups(parsed.words))
        return Intent(op="query", term=term) if term else None   # "queda coca?"
    if op == "pay":
        if parsed.amount is None:
            return None
        term = " ".join([it.term for it in parsed.items if it.term] + _groups(parsed.words))
        if parsed.payee_term:
            return Intent(op="pay", payee_term=parsed.payee_term, term=term, **common)
        return Intent(op="expense", term=term, **common) if term else None
    return None


def parse_amount(text: str) -> tuple[Decimal | None, str | None]:
    """La respuesta a "¿cuánto cobraste?": sólo plata y, si viene, el medio
    ("6500", "6500 efectivo", "6 lucas mp"). Cualquier otra cosa no es una
    respuesta (puede ser un mensaje nuevo)."""
    tokens = _tokens(text)
    if not tokens or any(_kind(t) == "usd" for t in tokens):
        return None, None
    parsed = _scan(tokens, allow_payee=False)
    if parsed.items or parsed.amount is None or _strip(parsed.words):
        return None, None
    return parsed.amount, parsed.single_method


def display(original: str, term: str) -> str:
    """El término como lo escribió la persona (con tildes y mayúsculas), con
    la primera letra en mayúscula: lo que se muestra y el nombre de un
    producto nuevo. Si no se encuentra tal cual, el término plegado."""
    if not term:
        return term
    folded = "".join(fold_text(ch) or ch for ch in original)
    idx = folded.find(term)
    shown = original[idx: idx + len(term)] if idx >= 0 and len(folded) == len(original) else term
    return shown[:1].upper() + shown[1:]


def fmt_qty(qty) -> str:
    """3 → "3", 1.5 → "1,5", -2 → "-2"."""
    value = Decimal(qty)
    if value == value.to_integral_value():
        return str(int(value))
    return f"{value.normalize():f}".replace(".", ",")
