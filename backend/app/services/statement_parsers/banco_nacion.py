"""Parser de resúmenes Banco Nación Visa.

Movido tal cual desde `scripts/import_banconacion_statements.py`; el script
ahora importa de acá. Cambio único: la línea "TARJETA NNNN Total Consumos de …"
captura sus dos montos en `block_total` para el control de totales.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from app.services.statement_parsers.common import MONTHS, assign_period

BANK_ID = "banco_nacion"

AMOUNT_RE = re.compile(r"(\d{1,3}(?:\.\d{3})*,\d{2}-?)\s*$")
AMOUNT_TOKEN_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
DATE_PREFIX_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{2})\s+(.+)$")
DATE_HEADER_RE = re.compile(r"(\d{2})\s+([A-Za-zÁ-Úá-ú]{3})\.?\s+(\d{2})")
CUPON_RE = re.compile(r"^(\d{4,8})\s+(.*)$")
CUOTA_RE = re.compile(r"C\.(\d{2})/(\d{2})")
CARD_TOTAL_RE = re.compile(
    r"^TARJETA (\d+) Total Consumos de (.+?)\s+\d{1,3}(?:\.\d{3})*,\d{2}\s+\d{1,3}(?:\.\d{3})*,\d{2}$"
)

PAGOS_PREFIX = "SU PAGO"


def parse_amount(raw: str) -> Decimal:
    raw = raw.strip()
    negative = raw.endswith("-")
    if negative:
        raw = raw[:-1]
    val = Decimal(raw.replace(".", "").replace(",", "."))
    return -val if negative else val


def parse_short_date(dd: str, mm: str, yy: str) -> date:
    return date(2000 + int(yy), int(mm), int(dd))


def parse_header_date(dd: str, mon: str, yy: str) -> date:
    month = MONTHS[mon.strip().lower().rstrip(".")[:3]]
    return date(2000 + int(yy), month, int(dd))


def detect(lines: list[str]) -> bool:
    return any(
        line.startswith("FECHA COMPROBANTE")
        or CARD_TOTAL_RE.match(line)
        or line.startswith("N DE CUENTA:")
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

    amt_m = AMOUNT_RE.search(rest)
    if not amt_m:
        return None
    amount = parse_amount(amt_m.group(1))
    remainder = rest[: amt_m.start()].strip()
    if not remainder:
        return None

    if remainder.startswith(PAGOS_PREFIX) or amount < 0:
        return {
            "date": item_date.isoformat(),
            "description": remainder,
            "amount": str(amount),
            "currency": "ARS",
            "_excluded": "payment",
        }

    cupon = None
    cm = CUPON_RE.match(remainder)
    if cm:
        cupon = cm.group(1)
        remainder = cm.group(2)

    item_type = "single"
    installment_number = None
    installment_count = None
    cuota_m = CUOTA_RE.search(remainder)
    if cuota_m:
        item_type = "installment"
        installment_number = int(cuota_m.group(1))
        installment_count = int(cuota_m.group(2))
        remainder = CUOTA_RE.sub("", remainder).strip()
        remainder = re.sub(r"\s{2,}", " ", remainder)

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


def parse_fee_row(line: str) -> dict | None:
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
    description = rest[: amt_m.start()].strip().lstrip("$").strip()
    if not description:
        return None
    return {"date": item_date.isoformat(), "description": description, "amount": str(amount), "currency": "ARS"}


def parse_header(lines: list[str]) -> dict:
    full_text = "\n".join(lines)

    def find_date(label_pattern: str) -> str | None:
        m = re.search(label_pattern + r"\s*(\d{2})\s+([A-Za-zÁ-Úá-ú]{3})\.?\s+(\d{2})", full_text)
        if not m:
            return None
        return parse_header_date(m.group(1), m.group(2), m.group(3)).isoformat()

    def find_amount(label_pattern: str) -> str | None:
        m = re.search(label_pattern + r"\s*\$?\s*([\d.,]+)", full_text)
        return str(parse_amount(m.group(1))) if m else None

    account_m = re.search(r"N DE CUENTA:\s*(\d+)", full_text)

    meta = {
        "bank": "Banco Nación",
        "account_number": account_m.group(1) if account_m else None,
        "closing_date": find_date(r"CIERRE ACTUAL:"),
        "due_date": find_date(r"VENCIMIENTO ACTUAL:"),
        "prev_closing_date": find_date(r"CIERRE ANTERIOR"),
        "prev_due_date": find_date(r"VTO\. ANTERIOR"),
        "next_closing_date": find_date(r"PROXIMO CIERRE"),
        "next_due_date": find_date(r"PROXIMO VTO"),
        "saldo_actual_ars": find_amount(r"SALDO ACTUAL:"),
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
    hint_last_4 = None

    for line in lines:
        if line.startswith("FECHA COMPROBANTE"):
            mode = "consumo"
            continue
        if line == "SALDO ANTERIOR":
            continue
        cm = CARD_TOTAL_RE.match(line)
        if cm:
            hint_last_4 = cm.group(1)
            cardholder = cm.group(2).strip()
            # Los dos montos al final de la línea son el total del bloque que
            # imprime el banco ($ y U$S) — el dato de control de la conciliación.
            amounts = AMOUNT_TOKEN_RE.findall(line)
            if len(amounts) >= 2:
                block_total = {
                    "ars": str(parse_amount(amounts[-2])),
                    "usd": str(parse_amount(amounts[-1])),
                }
            mode = "fees"
            continue
        if line.startswith("SALDO ACTUAL") or line.startswith("PAGO MINIMO"):
            mode = None
            continue

        if mode == "consumo":
            row = parse_consumo_row(line)
            if row:
                if row.pop("_excluded", None) == "payment":
                    excluded_payments.append(row)
                else:
                    row["category_id"] = None
                    items.append(row)
        elif mode == "fees":
            row = parse_fee_row(line)
            if row:
                excluded_fees.append(row)

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
                "hint_last_4": hint_last_4,
                "hint_label": "Visa Platinum",
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
