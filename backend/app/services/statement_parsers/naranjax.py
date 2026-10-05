"""Parser de resúmenes Naranja X.

Movido tal cual desde `scripts/import_naranjax_statements.py`; el script ahora
importa de acá. Cambio único: el "Total" que cierra cada bloque de consumos se
captura en `block_total` para el control de totales de la conciliación.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from app.services.statement_parsers.common import assign_period

BANK_ID = "naranjax"

AMOUNT_RE = re.compile(r"(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$")
AMOUNT_TOKEN_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}")
DATE_PREFIX_RE = re.compile(r"^(\d{2})/(\d{2})/(\d{2})\s+(.+)$")
TARJETA_CUPON_RE = re.compile(r"^(NX \S+|Naranja X)\s+(\d+)\s+(.*)$")
INSTALLMENT_RE = re.compile(r"(\d{2})/(\d{2})$")
ZETA_RE = re.compile(r"[Zz]eta$")
DEBAUT_RE = re.compile(r"Deb\.Aut\.$")
BARE_CUOTA_RE = re.compile(r"(?<!\d)(\d{2})$")

CONSUMOS_PREFIX = "Consumos tarjeta de crédito de "
ROW_HEADER = "FECHA TARJETA CUPON DETALLE CUOTA/PLAN $ U$S"
PAGO_HEADER = "FECHA DETALLE $ U$S"


def parse_amount(raw: str) -> Decimal:
    return Decimal(raw.strip().replace(".", "").replace(",", "."))


def parse_short_date(dd: str, mm: str, yy: str) -> date:
    return date(2000 + int(yy), int(mm), int(dd))


def detect(lines: list[str]) -> bool:
    return any(
        line == ROW_HEADER
        or line.startswith(CONSUMOS_PREFIX)
        or line.startswith("Tu total a pagar es $")
        for line in lines
    )


def parse_consumo_row(line: str) -> dict | None:
    m = DATE_PREFIX_RE.match(line)
    if not m:
        return None
    dd, mm, yy, rest = m.groups()
    try:
        item_date = parse_short_date(dd, mm, yy)
    except ValueError:
        return None

    if rest.startswith("*"):
        return None  # comisiones/cargos — se procesan aparte como excluidos

    amt_m = AMOUNT_RE.search(rest)
    if not amt_m:
        return None
    amount = parse_amount(amt_m.group(1))
    remainder = rest[: amt_m.start()].strip()
    if not remainder:
        return None

    item_type = "single"
    installment_number = None
    installment_count = None
    zeta_plan = False

    im = INSTALLMENT_RE.search(remainder)
    if im and int(im.group(1)) <= int(im.group(2)):
        stripped = remainder[: im.start()].strip()
        tm_check = TARJETA_CUPON_RE.match(stripped)
        detalle_check = tm_check.group(3).strip() if tm_check else stripped
        if detalle_check.upper().startswith("ZETA "):
            # Línea "ZETA <mes>/<año>" ya consolidada (cuota 2 o 3 de un plan
            # Zeta): no se importa como ítem propio — es la misma plata que
            # ya se auto-propaga desde la compra original "(Zeta)" (ver más
            # abajo), importarla también duplicaría el gasto.
            return None
        item_type = "installment"
        installment_number = int(im.group(1))
        installment_count = int(im.group(2))
        remainder = stripped
    elif ZETA_RE.search(remainder):
        # Compra recién taggeada "Zeta": Naranja X la divide en 3 cuotas
        # iguales sin interés — acá se ve el monto TOTAL de la compra, pero
        # solo se cobra 1/3 este ciclo (confirmado con el usuario contra los
        # montos reales de las líneas "ZETA <mes>/<año>" de los meses
        # siguientes). La importamos como cuota 1/3 marcada zeta_plan=True
        # para que SIEMPRE se propaguen las otras 2 cuotas futuras (Zeta
        # siempre son exactamente 3, a diferencia de las cuotas normales que
        # solo se propagan desde el resumen más reciente).
        remainder = ZETA_RE.sub("", remainder).strip()
        item_type = "installment"
        installment_number = 1
        installment_count = 3
        amount = (amount / 3).quantize(Decimal("0.01"))
        zeta_plan = True
    elif DEBAUT_RE.search(remainder):
        remainder = DEBAUT_RE.sub("", remainder).strip()
    else:
        bm = BARE_CUOTA_RE.search(remainder)
        if bm:
            remainder = remainder[: bm.start()].strip()

    tm = TARJETA_CUPON_RE.match(remainder)
    if tm:
        cupon = tm.group(2)
        description = tm.group(3).strip()
    else:
        cupon = None
        description = remainder

    if not description:
        return None

    return {
        "date": item_date.isoformat(),
        "description": description,
        "cupon": cupon,
        "amount": str(amount),
        "currency": "ARS",
        "item_type": item_type,
        "installment_number": installment_number,
        "installment_count": installment_count,
        "zeta_plan": zeta_plan,
    }


def parse_excluded_row(line: str) -> dict | None:
    m = DATE_PREFIX_RE.match(line)
    if not m:
        return None
    dd, mm, yy, rest = m.groups()
    try:
        item_date = parse_short_date(dd, mm, yy)
    except ValueError:
        return None
    amt_m = AMOUNT_RE.search(rest)
    if not amt_m:
        return None
    amount = parse_amount(amt_m.group(1))
    description = rest[: amt_m.start()].strip().lstrip("*").strip()
    if not description:
        return None
    return {
        "date": item_date.isoformat(),
        "description": description,
        "amount": str(amount),
        "currency": "ARS",
    }


def parse_header(lines: list[str]) -> dict:
    full_text = "\n".join(lines)

    def find(pattern: str) -> str | None:
        m = re.search(pattern, full_text)
        return m.group(1) if m else None

    saldo_str = find(r"Tu total a pagar es \$([\d.,]+)")
    due_full = find(r"y vence el (\d{2}/\d{2}/\d{2})\.")
    prev_closing_md = find(r"resumen anterior cerró el (\d{2}/\d{2}),")
    prev_due_md = find(r"venció el (\d{2}/\d{2}), por")
    closing_md = find(r"resumen actual cerró el (\d{2}/\d{2})\.")
    next_closing_md = find(r"próximo resumen cierra el (\d{2}/\d{2}),")
    next_due_md = find(r"y vence el (\d{2}/\d{2})\.")

    meta = {
        "bank": "Naranja X",
        "closing_date": None,
        "due_date": None,
        "prev_closing_date": None,
        "prev_due_date": None,
        "next_closing_date": None,
        "next_due_date": None,
        "saldo_actual_ars": str(parse_amount(saldo_str)) if saldo_str else None,
        "year": None,
        "month": None,
    }

    if not due_full or not closing_md:
        return meta

    due_dd, due_mm, due_yy = due_full.split("/")
    due_date = date(2000 + int(due_yy), int(due_mm), int(due_dd))

    def with_year_before(md: str, ref: date) -> date:
        dd, mm = md.split("/")
        d, m = int(dd), int(mm)
        year = ref.year if m <= ref.month else ref.year - 1
        return date(year, m, d)

    def with_year_after(md: str, ref: date) -> date:
        dd, mm = md.split("/")
        d, m = int(dd), int(mm)
        year = ref.year if m >= ref.month else ref.year + 1
        return date(year, m, d)

    closing_date = with_year_before(closing_md, due_date)
    meta["closing_date"] = closing_date.isoformat()
    meta["due_date"] = due_date.isoformat()

    if prev_closing_md:
        meta["prev_closing_date"] = with_year_before(prev_closing_md, closing_date).isoformat()
    if prev_due_md:
        meta["prev_due_date"] = with_year_before(prev_due_md, closing_date).isoformat()
    if next_closing_md:
        meta["next_closing_date"] = with_year_after(next_closing_md, closing_date).isoformat()
    if next_due_md:
        meta["next_due_date"] = with_year_after(next_due_md, closing_date).isoformat()

    meta["year"], meta["month"] = assign_period(closing_date)

    return meta


def parse_lines(lines: list[str]) -> dict:
    meta = parse_header(lines)

    items: list[dict] = []
    excluded_fees: list[dict] = []
    excluded_payments: list[dict] = []
    block_totals: dict[str, dict] = {}
    mode = None
    current_cardholder = None

    for line in lines:
        if line in (ROW_HEADER, PAGO_HEADER):
            continue
        if line.startswith(CONSUMOS_PREFIX):
            current_cardholder = line[len(CONSUMOS_PREFIX):].strip()
            mode = "consumo"
            continue
        if line.startswith("Otros") or line == "Otros cargos:":
            mode = "otros"
            continue
        if line.startswith("Total"):
            # El "Total …" que cierra el bloque de consumos del titular es el
            # dato de control de la conciliación. Sólo se captura si veníamos
            # de consumos — "Total a pagar" y similares no son de un bloque.
            if mode == "consumo" and current_cardholder and current_cardholder not in block_totals:
                amounts = AMOUNT_TOKEN_RE.findall(line)
                if amounts:
                    block_totals[current_cardholder] = {
                        "ars": str(parse_amount(amounts[0])),
                        "usd": str(parse_amount(amounts[1])) if len(amounts) >= 2 else None,
                    }
            mode = None
            continue
        if line.startswith("Pago del resumen anterior"):
            mode = "pagos"
            continue
        if line.startswith("Información legal") or line.startswith("Para que"):
            mode = None
            continue

        if mode == "consumo":
            if DATE_PREFIX_RE.match(line) and line.split(None, 1)[-1].lstrip().startswith("*"):
                # línea de comisión dentro de la sección de consumos
                row = parse_excluded_row(line)
                if row:
                    excluded_fees.append(row)
                continue
            row = parse_consumo_row(line)
            if row:
                row["cardholder"] = current_cardholder
                row["category_id"] = None
                items.append(row)
        elif mode == "otros":
            row = parse_excluded_row(line)
            if row:
                excluded_fees.append(row)
        elif mode == "pagos":
            row = parse_excluded_row(line)
            if row:
                excluded_payments.append(row)

    statements = []
    for cardholder in sorted({i["cardholder"] for i in items if i["cardholder"]}):
        cardholder_items = [i for i in items if i["cardholder"] == cardholder]
        statements.append({
            "cardholder": cardholder,
            "year": meta["year"],
            "month": meta["month"],
            "closing_date": meta["closing_date"],
            "due_date": meta["due_date"],
            "is_latest_statement": False,
            "card": {
                "bank": "Naranja X",
                "hint_last_4": None,
                "hint_label": "Naranja X",
                "existing_card_id": None,
                "create_new": None,
                "new_alias": None,
            },
            "items": cardholder_items,
            "block_total": block_totals.get(cardholder),
        })

    return {
        **meta,
        "statements": statements,
        "excluded": {"payments": excluded_payments, "fees": excluded_fees},
    }
