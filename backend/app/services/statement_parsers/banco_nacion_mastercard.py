"""Parser de resúmenes Banco Nación Mastercard.

Movido tal cual desde `scripts/import_banconacion_mastercard_statements.py`;
el script ahora importa de acá. Este resumen NO usa separador de miles
(ej. "12721,05") — ver AMOUNT_RE. Cambio único: la línea "TOTAL TITULAR …"
captura sus dos montos en `block_total` para el control de totales.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from app.services.statement_parsers.common import MONTHS, assign_period

BANK_ID = "banco_nacion_mastercard"

# Este resumen NO usa separador de miles (ej. "12721,05", no "12.721,05"),
# a diferencia de los demás bancos — el monto es simplemente dígitos + coma + 2 decimales.
AMOUNT_RE = re.compile(r"(-?\d+,\d{2}-?)\s*$")
AMOUNT_TOKEN_RE = re.compile(r"-?\d+,\d{2}")
DATE_PREFIX_RE = re.compile(r"^(\d{2})-([A-Za-zÁ-Úá-ú]{3})-(\d{2})\s+(.+)$")
CUPON_RE = re.compile(r"^(.*?)\s+(\d{4,8})$")
CUOTA_RE = re.compile(r"^(.*?)\s+(\d{2})/(\d{2})$")
TITULAR_RE = re.compile(r"^TOTAL TITULAR\s+(.+?)\s+-?\d+,\d{2}\s+-?\d+,\d{2}$")

PAGO_PREFIXES = ("SU PAGO", "PAGO CAJERO")
FEE_LABELS = (
    "INTERESES COMPENSATORIOS", "INTERESES PUNITORIOS", "INTERESES DE FINANCIACION",
    "COM.ADM.DE.CUENTA", "IMPUESTO DE SELLOS", "I.V.A.",
)


def parse_amount(raw: str) -> Decimal:
    raw = raw.strip()
    negative = raw.startswith("-") or raw.endswith("-")
    raw = raw.strip("-")
    val = Decimal(raw.replace(".", "").replace(",", "."))
    return -val if negative else val


def parse_short_date(dd: str, mon: str, yy: str) -> date:
    month = MONTHS[mon.strip().lower()[:3]]
    return date(2000 + int(yy), month, int(dd))


def detect(lines: list[str]) -> bool:
    return any(
        line.startswith("TOTAL TITULAR") or line.startswith("Estado de cuenta al:")
        for line in lines
    )


def parse_consumo_row(line: str) -> dict | None:
    m = DATE_PREFIX_RE.match(line)
    if not m:
        return None
    dd, mon, yy, rest = m.groups()
    try:
        item_date = parse_short_date(dd, mon, yy)
    except (KeyError, ValueError):
        return None

    amt_m = AMOUNT_RE.search(rest)
    if not amt_m:
        return None
    amount = parse_amount(amt_m.group(1))
    remainder = rest[: amt_m.start()].strip()
    if not remainder:
        return None

    cm = CUPON_RE.match(remainder)
    cupon = None
    if cm:
        remainder, cupon = cm.group(1).strip(), cm.group(2)

    item_type = "single"
    installment_number = None
    installment_count = None
    qm = CUOTA_RE.match(remainder)
    if qm:
        remainder = qm.group(1).strip()
        item_type = "installment"
        installment_number = int(qm.group(2))
        installment_count = int(qm.group(3))

    if not remainder:
        return None

    return {
        "date": item_date.isoformat(),
        "description": remainder,
        "cupon": cupon,
        "amount": str(amount),
        "currency": "ARS",
        "item_type": item_type,
        "installment_number": installment_number,
        "installment_count": installment_count,
    }


def parse_pago_row(line: str) -> dict | None:
    m = DATE_PREFIX_RE.match(line)
    if not m:
        return None
    dd, mon, yy, rest = m.groups()
    try:
        item_date = parse_short_date(dd, mon, yy)
    except (KeyError, ValueError):
        return None
    amt_m = AMOUNT_RE.search(rest)
    if not amt_m:
        return None
    amount = parse_amount(amt_m.group(1))
    description = rest[: amt_m.start()].strip()
    if not description:
        return None
    return {"date": item_date.isoformat(), "description": description, "amount": str(amount), "currency": "ARS"}


def parse_fee_row(line: str) -> dict | None:
    amt_m = AMOUNT_RE.search(line)
    if not amt_m:
        return None
    amount = parse_amount(amt_m.group(1))
    description = line[: amt_m.start()].strip()
    if not description or not any(description.startswith(lbl) for lbl in FEE_LABELS):
        return None
    return {"description": description, "amount": str(amount), "currency": "ARS"}


def parse_header(lines: list[str]) -> dict:
    full_text = "\n".join(lines)

    def find_date(label_pattern: str) -> str | None:
        m = re.search(label_pattern + r"\s*(\d{2})-([A-Za-zÁ-Úá-ú]{3})-(\d{2})", full_text)
        if not m:
            return None
        try:
            return parse_short_date(m.group(1), m.group(2), m.group(3)).isoformat()
        except (KeyError, ValueError):
            return None

    def find_amount(label_pattern: str) -> str | None:
        m = re.search(label_pattern + r"\s*\$?\s*(-?[\d.,]+)", full_text)
        return str(parse_amount(m.group(1))) if m else None

    meta = {
        "bank": "Banco Nación",
        "card_product": "Mastercard Platinum",
        "closing_date": find_date(r"Estado de cuenta al:"),
        "due_date": find_date(r"Vencimiento actual:"),
        "prev_closing_date": find_date(r"Cierre Anterior:"),
        "prev_due_date": find_date(r"Vencimiento Anterior:"),
        "next_closing_date": find_date(r"Próximo Cierre:"),
        "next_due_date": find_date(r"Próximo Vencimiento:"),
        "saldo_actual_ars": find_amount(r"SALDO ACTUAL"),
        "year": None,
        "month": None,
    }

    if meta["closing_date"]:
        meta["year"], meta["month"] = assign_period(date.fromisoformat(meta["closing_date"]))

    return meta


def parse_lines(lines: list[str]) -> dict:
    meta = parse_header(lines)

    items: list[dict] = []
    excluded_payments: list[dict] = []
    excluded_fees: list[dict] = []
    block_total: dict | None = None
    mode = None
    cardholder = None

    for line in lines:
        if line.startswith("SALDO ANTERIOR"):
            mode = "pagos"
            continue
        if line.startswith("SALDO PENDIENTE"):
            mode = None
            continue
        if line.startswith("SUBTOTAL"):
            mode = "fees"
            continue
        if line.startswith("SALDO ACTUAL") or line.startswith("PAGO MINIMO"):
            mode = None
            continue
        if line.startswith("DETALLE DEL MES") or line.startswith("FECHA CONCEPTO") or line.startswith("CUOTAS DEL MES") or line.startswith("CONSUMOS DEL MES"):
            mode = "consumo"
            continue
        tm = TITULAR_RE.match(line)
        if tm:
            cardholder = tm.group(1).strip()
            # Los dos montos al final son el total del titular que imprime el
            # banco ($ y U$S) — el dato de control de la conciliación.
            amounts = AMOUNT_TOKEN_RE.findall(line)
            if len(amounts) >= 2:
                block_total = {
                    "ars": str(parse_amount(amounts[-2])),
                    "usd": str(parse_amount(amounts[-1])),
                }
            mode = None
            continue

        if mode == "pagos":
            row = parse_pago_row(line)
            if row:
                excluded_payments.append(row)
        elif mode == "fees":
            row = parse_fee_row(line)
            if row:
                excluded_fees.append(row)
        elif mode == "consumo":
            row = parse_consumo_row(line)
            if row:
                row["category_id"] = None
                items.append(row)

    statements = []
    if items:
        statements.append({
            "cardholder": cardholder or "Titular",
            "year": meta["year"],
            "month": meta["month"],
            "closing_date": meta["closing_date"],
            "due_date": meta["due_date"],
            "is_latest_statement": False,
            "card": {
                "bank": "Banco Nación",
                "hint_last_4": None,
                "hint_label": "Mastercard Platinum",
                "existing_card_id": None,
                "create_new": None,
                "new_alias": None,
            },
            "items": items,
            "block_total": block_total,
        })

    return {
        **meta,
        "statements": statements,
        "excluded": {"payments": excluded_payments, "fees": excluded_fees},
    }
