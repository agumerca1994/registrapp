"""Captura rápida de un ingreso desde el bot ("cobré 850 lucas sueldo").

El gemelo de `quick_capture` para la plata que entra. Dos diferencias que
son a propósito:

- **Hace falta un verbo.** "sueldo 850 lucas" puede ser lo que se le paga a
  la empleada de la casa, o sea un gasto; "cobré", "me pagaron", "me
  transfirieron" o "ingreso" no dejan dudas. Sin verbo, sigue siendo un gasto
  como siempre.
- **La fuente se pregunta, nunca se inventa en silencio.** Nombre exacto →
  nombre contenido en el texto → regla aprendida (`income_source`) → pregunta
  con las fuentes del hogar más "Nueva fuente «…»". Contestar la pregunta
  guarda la regla, igual que con las categorías de los gastos.

El ingreso se escribe igual que desde la app: neto en `amount`, sin detalle
(los campos de la fuente se completan en la app si hacen falta).
"""
from __future__ import annotations

import re

from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.income import IncomeEntry, IncomeSource, IncomeType
from app.services import quick_capture
from app.services.quick_capture import QuickDraft
from app.services.reconcile import rules as capture_rules
from app.services.search import fold_text

KIND_INCOME_SOURCE = "income_source"
MAX_OPTIONS = 7  # + "Nueva fuente" + "No es un ingreso" = 9, lo que entra en un dígito

_TRIGGER_RE = re.compile(
    r"^\s*(?:"
    r"cobr[eé]|cobramos|cobraron"
    r"|me\s+(?:pagaron|depositaron|transfirieron|mandaron|enviaron|entr[oó]|entraron)"
    r"|nos\s+(?:pagaron|depositaron|transfirieron|mandaron|enviaron|entr[oó]|entraron)"
    r"|entr[oó]|entraron|recib[ií]|recibimos|ingres[oó]|ingresaron|ingresos?"
    r")\b[\s:,-]*",
    re.IGNORECASE,
)
# "recibí la factura de luz 45 lucas" es un gasto que llegó, no plata que entró.
_BILL_RE = re.compile(r"\b(?:factura|boleta|expensas|resumen|multa|impuesto|vencimiento)\b", re.IGNORECASE)
# Lo que queda entre el verbo y el nombre: "cobré *el* sueldo", "850 lucas *de* alquiler".
_FILLER_RE = re.compile(r"^(?:(?:de|del|el|la|los|las|por|en|un|una|mi|mis)\s+)+", re.IGNORECASE)

_TYPE_HINTS = [
    (re.compile(r"aguinaldo|\bsac\b", re.IGNORECASE), IncomeType.aguinaldo),
    (re.compile(r"bono|premio|gratificaci", re.IGNORECASE), IncomeType.bonus),
    (re.compile(r"sueldo|salario|haberes|recibo", re.IGNORECASE), IncomeType.salary),
    (re.compile(r"plazo\s+fijo|inter[eé]s|dividendo|renta|fci|cedear|cup[oó]n", re.IGNORECASE), IncomeType.investment),
]


def looks_like_income(text: str) -> bool:
    return bool(_TRIGGER_RE.match(text or ""))


def parse_income_text(text: str) -> QuickDraft | None:
    """"cobré 850 lucas sueldo" → borrador con `term="sueldo"`. None si no
    empieza con un verbo de ingreso o no tiene un monto. El término puede
    quedar vacío ("cobré 850 lucas"): entonces se pregunta la fuente."""
    m = _TRIGGER_RE.match(text or "")
    if not m:
        return None
    draft = quick_capture.parse_amount_text(text[m.end():])
    if draft is None or _BILL_RE.search(draft.term):
        return None
    draft.term = _FILLER_RE.sub("", draft.term).strip()
    return draft


def guess_type(name: str) -> IncomeType:
    for pattern, kind in _TYPE_HINTS:
        if pattern.search(name):
            return kind
    return IncomeType.other


async def writable_sources(db: AsyncSession, tenant_id: int) -> list[IncomeSource]:
    """Las fuentes donde el bot puede cargar: activas y no del sistema (la de
    Ventas de un negocio se arma sola)."""
    rows = await db.scalars(
        select(IncomeSource).where(
            IncomeSource.tenant_id == tenant_id,
            IncomeSource.is_active.is_(True),
            IncomeSource.system_key.is_(None),
        ).order_by(IncomeSource.id)
    )
    return list(rows.all())


def match_by_name(sources: list[IncomeSource], name: str) -> IncomeSource | None:
    folded = fold_text(name).strip()
    if not folded:
        return None
    return next((s for s in sources if fold_text(s.name).strip() == folded), None)


async def resolve_source(
    db: AsyncSession, tenant_id: int, term: str, sources: list[IncomeSource]
) -> IncomeSource | None:
    """Del término a una fuente, o None para preguntar."""
    if not term:
        return None
    exact = match_by_name(sources, term)
    if exact:
        return exact
    # "sueldo de octubre" → "Sueldo". Sólo si es una sola: con dos candidatas
    # elegir una es adivinar.
    words = set(fold_text(term).split())
    contained = [s for s in sources if fold_text(s.name).strip() and set(fold_text(s.name).split()) <= words]
    if len(contained) == 1:
        return contained[0]
    rules = await capture_rules.get_rules(db, tenant_id, KIND_INCOME_SOURCE)
    rule = rules.get(capture_rules.merchant_key(term))
    if rule:
        return next((s for s in sources if s.id == rule.get("source_id")), None)
    return None


async def learn(db: AsyncSession, tenant_id: int, term: str, source_id: int) -> None:
    if term:
        await capture_rules.save_rule(
            db, tenant_id, KIND_INCOME_SOURCE, capture_rules.merchant_key(term),
            {"source_id": source_id},
        )


async def create_source(db: AsyncSession, tenant_id: int, name: str) -> IncomeSource:
    source = IncomeSource(tenant_id=tenant_id, name=name.strip()[:120], income_type=guess_type(name))
    db.add(source)
    await db.flush()
    return source


async def create_income(
    db: AsyncSession, *, tenant_id: int, user_id: int, draft: QuickDraft,
    source: IncomeSource, notes: str | None,
) -> IncomeEntry:
    """Sólo flush — el commit es del bot, que después responde."""
    entry = IncomeEntry(
        tenant_id=tenant_id, user_id=user_id, source_id=source.id,
        amount=draft.amount, currency=draft.currency,
        period_date=draft.expense_date, notes=(notes or None) and notes[:500],
    )
    db.add(entry)
    await db.flush()
    return entry


async def same_month(db: AsyncSession, entry: IncomeEntry) -> list[IncomeEntry]:
    """Otros ingresos de la misma fuente y moneda en el mismo mes: el
    duplicado probable (el mismo sueldo mandado dos veces). Se avisa, no se frena."""
    rows = await db.scalars(
        select(IncomeEntry).where(
            IncomeEntry.tenant_id == entry.tenant_id,
            IncomeEntry.source_id == entry.source_id,
            IncomeEntry.currency == entry.currency,
            extract("year", IncomeEntry.period_date) == entry.period_date.year,
            extract("month", IncomeEntry.period_date) == entry.period_date.month,
            IncomeEntry.id != entry.id,
        )
    )
    return list(rows.all())

