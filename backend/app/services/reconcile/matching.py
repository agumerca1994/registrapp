"""Matching entre el resumen del banco y lo cargado en la app.

Motor puro: listas adentro, reporte afuera, nada de DB — es lo que lo hace
testeable contra el caso de referencia. Las reglas vienen del doc de
conciliación y de la práctica manual que lo originó:

- **El match es por monto, no por descripción**: en la app el usuario
  reescribe las descripciones ("Ferreteria - Mercadopago" donde el banco
  imprimió "MERPAGO*LUCIANOGABRIELCAM"). La descripción sólo desempata.
- **Cada ítem se usa una sola vez, por moneda por separado.** Dos cargos
  iguales del banco contra un solo ítem de la app dejan un faltante — el
  caso Aerolíneas.
- **El cupón va primero**: si una conciliación anterior guardó
  `bank_coupon`, ese ítem se matchea exacto sin mirar monto ni fecha.
- **Las cuotas no comparan fecha.** El banco imprime la fecha de la compra
  original en todas las cuotas; la app fecha la cuota n en compra+n−1 meses.
  Comparar fechas ahí rompería todos los planes — van por (n/N, monto).
- **En USD también se mira el comercio**: los montos chicos se repiten
  (7,99 / 9,99) y el monto solo empareja cualquier cosa con cualquier cosa.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
from decimal import Decimal

from app.services.category_suggest import normalize

# Tolerancia de redondeo: hasta $5 o 0,1% — el redondeo de cuota típico.
ABS_TOL = Decimal("5")
REL_TOL = Decimal("0.001")
DATE_WINDOW_DAYS = 5

# Clases de diferencia (las del doc).
MATCHED = "matched"
ROUNDING = "rounding"            # corregir esa cuota (scope="item")
AMOUNT_DIFF = "amount_diff"      # corregir el monto al del banco
DOUBLE_COUNT = "double_count"    # ítem de la app que sumó dos cargos del banco
USD_FIX = "usd_fix"              # USD mal identificado: corregir descripción y monto
MISSING = "missing"              # crear
SURPLUS = "surplus"              # preguntar (borrar)


@dataclass
class BankItem:
    idx: int
    item_date: date
    description: str
    amount: Decimal
    currency: str
    cupon: str | None = None
    cuota: tuple[int, int] | None = None  # (n, N)

    @property
    def tokens(self) -> frozenset[str]:
        return normalize(self.description)


@dataclass
class AppItem:
    id: int
    item_date: date
    description: str
    amount: Decimal
    currency: str
    bank_description: str | None = None
    bank_coupon: str | None = None
    cuota: tuple[int, int] | None = None
    is_root: bool = True
    shared: bool = False
    category_id: int | None = None

    @property
    def tokens(self) -> frozenset[str]:
        toks = normalize(self.description)
        if self.bank_description:
            toks = toks | normalize(self.bank_description)
        return toks


@dataclass
class Pair:
    bank: BankItem
    app: AppItem
    klass: str
    # En double_count, el cargo del banco que el ítem de la app sumó de más
    # (ese cargo además matchea su propio ítem suelto de la app).
    extra_bank_idx: int | None = None


@dataclass
class MatchReport:
    pairs: list[Pair] = field(default_factory=list)
    missing: list[BankItem] = field(default_factory=list)
    surplus: list[AppItem] = field(default_factory=list)
    # Por moneda: la diferencia de totales y cuánto queda sin explicar.
    totals: dict[str, dict[str, Decimal]] = field(default_factory=dict)

    @property
    def closes(self) -> bool:
        """La diferencia queda explicada al centavo por la suma de las clases."""
        return all(t["unexplained"] == 0 for t in self.totals.values())

    def pairs_of(self, klass: str) -> list[Pair]:
        return [p for p in self.pairs if p.klass == klass]


def _overlap(a: frozenset[str], b: frozenset[str]) -> int:
    return len(a & b)


def _within_tolerance(bank_amount: Decimal, app_amount: Decimal) -> bool:
    diff = abs(bank_amount - app_amount)
    return diff <= max(ABS_TOL, abs(bank_amount) * REL_TOL)


def _date_dist(a: date, b: date) -> int:
    return abs((a - b).days)


def match_statement(bank_items: list[BankItem], app_items: list[AppItem]) -> MatchReport:
    report = MatchReport()
    for currency in sorted({i.currency for i in bank_items} | {i.currency for i in app_items}):
        _match_currency(
            [b for b in bank_items if b.currency == currency],
            [a for a in app_items if a.currency == currency],
            currency,
            report,
        )
    return report


def _match_currency(
    bank: list[BankItem], app: list[AppItem], currency: str, report: MatchReport
) -> None:
    bank_left = list(bank)
    app_left = list(app)

    def take(pair: Pair) -> None:
        report.pairs.append(pair)
        bank_left.remove(pair.bank)
        app_left.remove(pair.app)

    # 1. Cupón guardado por una conciliación anterior: match exacto sin mirar
    #    monto ni fecha; si el monto difiere, es corrección (chica o grande).
    for b in list(bank_left):
        if not b.cupon:
            continue
        a = next((x for x in app_left if x.bank_coupon == b.cupon), None)
        if a is None:
            continue
        if a.amount == b.amount:
            klass = MATCHED
        elif _within_tolerance(b.amount, a.amount):
            klass = ROUNDING
        else:
            klass = AMOUNT_DIFF
        take(Pair(b, a, klass))

    # 2. Match exacto por monto (+ n/N para cuotas; fecha ±5 días para el
    #    resto; en USD, el comercio desempata y es requisito si hay ambigüedad).
    for b in list(bank_left):
        candidates = [a for a in app_left if a.amount == b.amount and a.cuota == b.cuota]
        if b.cuota is None:
            candidates = [a for a in candidates if _date_dist(a.item_date, b.item_date) <= DATE_WINDOW_DAYS]
        if currency == "USD" and len(candidates) > 1:
            with_overlap = [a for a in candidates if _overlap(a.tokens, b.tokens) > 0]
            if with_overlap:
                candidates = with_overlap
        if not candidates:
            continue
        candidates.sort(key=lambda a: (-_overlap(a.tokens, b.tokens), _date_dist(a.item_date, b.item_date)))
        take(Pair(b, candidates[0], MATCHED))

    # 3. Redondeo: misma cuota n/N y diferencia de hasta $5 o 0,1%.
    for b in list(bank_left):
        if b.cuota is None:
            continue
        candidates = [
            a for a in app_left if a.cuota == b.cuota and _within_tolerance(b.amount, a.amount)
        ]
        if not candidates:
            continue
        candidates.sort(key=lambda a: (abs(b.amount - a.amount), -_overlap(a.tokens, b.tokens)))
        take(Pair(b, candidates[0], ROUNDING))

    # 4. Doble conteo: un ítem de la app igual a un cargo del banco MÁS otro
    #    cargo que también está cargado suelto (Taxi 5.437 = 5.353 + 84, con
    #    el 84 aparte). Se corrige el monto del ítem sumado al cargo grande.
    matched_bank = [p.bank for p in report.pairs if p.bank.currency == currency]
    for a in list(app_left):
        found = None
        for b in bank_left:
            for c in matched_bank + [x for x in bank_left if x is not b]:
                if b.amount + c.amount == a.amount:
                    found = (b, c)
                    break
            if found:
                break
        if found:
            b, c = found
            take(Pair(b, a, DOUBLE_COUNT, extra_bank_idx=c.idx))

    # 5. USD mal identificado: con sobrantes de los dos lados, se proponen de
    #    a pares por cercanía de fecha (corregir descripción y monto) — el
    #    caso PlayStation 7,99 cargado como Google One 9,99.
    if currency == "USD":
        while bank_left and app_left:
            b = bank_left[0]
            a = min(app_left, key=lambda x: _date_dist(x.item_date, b.item_date))
            take(Pair(b, a, USD_FIX))

    # 6. Lo que queda: faltantes del banco, sobrantes de la app.
    report.missing.extend(bank_left)
    report.surplus.extend(app_left)

    # Cierre por moneda: la diferencia de totales explicada por las clases.
    bank_total = sum((i.amount for i in bank), Decimal("0"))
    app_total = sum((i.amount for i in app), Decimal("0"))
    explained = sum((i.amount for i in bank_left), Decimal("0"))
    explained -= sum((i.amount for i in app_left), Decimal("0"))
    for p in report.pairs:
        if p.bank.currency == currency and p.klass in (ROUNDING, AMOUNT_DIFF, DOUBLE_COUNT, USD_FIX):
            explained += p.bank.amount - p.app.amount
    report.totals[currency] = {
        "bank_total": bank_total,
        "app_total": app_total,
        "difference": bank_total - app_total,
        "explained": explained,
        "unexplained": bank_total - app_total - explained,
    }
