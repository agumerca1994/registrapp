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

El ingreso se escribe igual que desde la app: neto en `amount`. Sin detalle,
salvo un recibo de sueldo leído por la IA: sus conceptos se cargan en los
campos que la fuente YA tiene (`match_payslip_lines`). Un concepto sin campo
no se guarda ni crea uno: la diferencia queda como "Sin detallar" en la app.
"""
from __future__ import annotations

import re

from sqlalchemy import extract, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.income import IncomeEntry, IncomeSource, IncomeSourceField, IncomeType
from app.schemas.income import IncomeEntryItemIn
from app.services import quick_capture
from app.services.ai_capture import PayslipLine
from app.services.income import apply_items, fold_name, match_field
from app.services.quick_capture import QuickDraft
from app.services.reconcile import rules as capture_rules
from app.services.search import fold_text

KIND_INCOME_SOURCE = "income_source"
MAX_OPTIONS = 7  # + "Nueva fuente" + "No es un ingreso" = 9, lo que entra en un dígito

_TRIGGER_RE = re.compile(
    r"^\s*(?:"
    r"cobr[eé]|cobramos|cobraron|gan[eé]|ganamos"
    r"|me\s+(?:pagaron|pag[oó]|depositaron|deposit[oó]|transfirieron|transfiri[oó]|mandaron|mand[oó]|enviaron|envi[oó]|entr[oó]|entraron"
    r"|reintegraron|reintegr[oó]|devolvieron|devolvi[oó]|reembolsaron|reembols[oó])"
    r"|nos\s+(?:pagaron|depositaron|transfirieron|mandaron|enviaron|entr[oó]|entraron)"
    r"|entr[oó]|entraron|recib[ií]|recibimos|ingres[oó]|ingresaron|ingresos?"
    r")\b[\s:,-]*",
    re.IGNORECASE,
)
# "recibí la factura de luz 45 lucas" es un gasto que llegó, no plata que entró.
_BILL_RE = re.compile(r"\b(?:factura|boleta|expensas|resumen|multa|impuesto|vencimiento)\b", re.IGNORECASE)
# "9500 reintegro": la palabra sola ya dice que la plata entró, aunque no haya verbo.
# El verbo es la regla para "sueldo", que puede ser de la empleada; acá no hay esa duda.
_REFUND_RE = re.compile(r"\b(?:reintegros?|reintegraron|reintegr[oó]|reembolsos?|reembolsaron|reembols[oó]|devolvieron|devolvi[oó])\b", re.IGNORECASE)
# Lo que queda entre el verbo y el nombre: "cobré *el* sueldo", "850 lucas *de* alquiler".
_FILLER_RE = re.compile(r"^(?:(?:de|del|el|la|los|las|por|en|un|una|mi|mis)\s+)+", re.IGNORECASE)

_TYPE_HINTS = [
    (re.compile(r"aguinaldo|\bsac\b", re.IGNORECASE), IncomeType.aguinaldo),
    (re.compile(r"bono|premio|gratificaci", re.IGNORECASE), IncomeType.bonus),
    (re.compile(r"sueldo|salario|haberes|recibo", re.IGNORECASE), IncomeType.salary),
    (re.compile(r"plazo\s+fijo|inter[eé]s|dividendo|renta|fci|cedear|cup[oó]n", re.IGNORECASE), IncomeType.investment),
]


def looks_like_income(text: str) -> bool:
    stripped = quick_capture.strip_request(text or "")
    return parse_income_text(stripped) is not None or bool(_TRIGGER_RE.match(stripped))


def parse_income_text(text: str) -> QuickDraft | None:
    """"cobré 850 lucas sueldo" → borrador con `term="sueldo"`. None si no
    empieza con un verbo de ingreso o no tiene un monto. El término puede
    quedar vacío ("cobré 850 lucas"): entonces se pregunta la fuente."""
    text = quick_capture.strip_request(text or "")
    m = _TRIGGER_RE.match(text)
    # "Pagué el reintegro de la señal": ahí la plata salió.
    refund = None if quick_capture._LEADING_VERB_RE.match(text) else _REFUND_RE.search(text)
    if not m and not refund:
        return None
    draft = quick_capture.parse_amount_text(text[m.end():] if m else text)
    if draft is None or _BILL_RE.search(draft.term):
        return None
    # "categoría otros" o "fuente sueldo": lo nombró a propósito, es la fuente.
    draft.term = (draft.category_name or _FILLER_RE.sub("", draft.term)).strip()
    # "me reintegraron 780": el verbo se fue con el monto, pero dice de qué es.
    if refund and (not draft.term or _REFUND_RE.fullmatch(draft.term)):
        draft.term = "reintegro"
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
    singular = lambda value: {w.rstrip("s") for w in fold_text(value).split()}  # "Reintegros" y "reintegro"
    words = singular(term)
    contained = [s for s in sources if fold_text(s.name).strip() and singular(s.name) <= words]
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



# ------------------------------------------------------- recibo de sueldo ---
# "Jubilación 11%" contra un campo "Jubilación", "0010 Sueldo básico" contra
# "Sueldo básico", "Ley 19.032 3%" contra "Ley 19032": el recibo imprime el
# código y el porcentaje, el campo casi nunca. No es una tabla de sinónimos:
# sólo se saca lo que el recibo agrega alrededor del nombre.
_CODE_RE = re.compile(r"^\s*\d+\s*[-.]?\s+")
_PCT_RE = re.compile(r"\(?\s*\d+(?:[.,]\d+)?\s*%\s*\)?")
_THOUSANDS_RE = re.compile(r"(?<=\d)\.(?=\d{3}\b)")
_EDGE_PUNCT_RE = re.compile(r"^[\s:.\-]+|[\s:.\-]+$")


def payslip_key(name: str) -> str:
    s = _CODE_RE.sub("", name or "")
    s = _PCT_RE.sub(" ", s)
    s = _THOUSANDS_RE.sub("", s)
    return fold_name(_EDGE_PUNCT_RE.sub("", s))


def match_payslip_lines(
    lines: list[PayslipLine], fields: list[IncomeSourceField]
) -> list[tuple[IncomeSourceField, PayslipLine]]:
    """Cada concepto del recibo → un campo activo de la fuente, o nada.

    Por línea, en este orden: el nombre tal cual (el mismo `match_field` del
    conector MCP), el nombre sin código ni porcentaje, y por último el campo
    que señaló la IA, si es de esta fuente. La IA sólo señala; el que decide
    es esto, y es conservador:
    - un concepto que suma no va a un campo que resta, ni al revés;
    - si dos conceptos caen en el mismo campo, gana el que lo nombra; si
      ninguno lo nombra (o lo nombran dos), el campo queda vacío: sumar o
      elegir sería adivinar, y un hueco se ve como "Sin detallar".
    """
    active = [f for f in fields if f.is_active]
    if not active:
        return []
    by_key = {}
    for f in active:
        by_key.setdefault(payslip_key(f.name), f)
    by_name = {f.name: f for f in active}

    candidates: dict[int, list[tuple[bool, PayslipLine]]] = {}
    fields_by_id = {f.id: f for f in active}
    for line in lines:
        named = match_field(line.name, active) or by_key.get(payslip_key(line.name))
        fl = named or by_name.get(line.field)
        if fl is None:
            continue
        if {line.kind, fl.kind} == {"add", "subtract"}:
            continue
        candidates.setdefault(fl.id, []).append((named is not None, line))

    out: list[tuple[IncomeSourceField, PayslipLine]] = []
    for fid, cands in candidates.items():
        if len(cands) == 1:
            out.append((fields_by_id[fid], cands[0][1]))
            continue
        by_name_hits = [line for was_named, line in cands if was_named]
        if len(by_name_hits) == 1:
            out.append((fields_by_id[fid], by_name_hits[0]))
    out.sort(key=lambda pair: (pair[0].position, pair[0].id))
    return out


async def apply_payslip_lines(
    db: AsyncSession, entry: IncomeEntry, lines: list[PayslipLine]
) -> tuple[list[str], bool]:
    """Carga el detalle del recibo en el ingreso (sólo flush). Devuelve los
    campos que se llenaron y si la fuente tiene campos (para decir algo o no)."""
    fields = list((await db.scalars(
        select(IncomeSourceField).where(
            IncomeSourceField.source_id == entry.source_id,
            IncomeSourceField.is_active.is_(True),
        )
    )).all())
    if not fields:
        return [], False
    matched = match_payslip_lines(lines, fields)
    if matched:
        await apply_items(
            entry, [IncomeEntryItemIn(field_id=f.id, amount=line.amount) for f, line in matched], db,
        )
        await db.flush()
    return [f.name for f, _line in matched], True
