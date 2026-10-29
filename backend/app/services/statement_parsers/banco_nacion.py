"""Parser de resúmenes Banco Nación Visa.

Movido tal cual desde `scripts/import_banconacion_statements.py`; el script
ahora importa de acá. La línea "TARJETA NNNN Total Consumos de …" captura sus
dos montos en `block_total` para el control de totales.

Hay dos formatos. El viejo: fechas "21-09-26", un solo importe por renglón y
"VENCIMIENTO ACTUAL:". El de 2026-10 en adelante: fechas "04.11.24", dos
columnas de importe (PESOS y DOLAR, la que no aplica en 0,00), y el
vencimiento en la línea que sigue a "VENCIMIENTO SALDO $ …". Con el formato
nuevo el lector reconocía el banco y no leía un solo consumo.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from app.services.statement_parsers.common import MONTHS, assign_period

BANK_ID = "banco_nacion"

AMOUNT_RE = re.compile(r"(\d{1,3}(?:\.\d{3})*,\d{2}-?)\s*$")
AMOUNT_TOKEN_RE = re.compile(r"\d{1,3}(?:\.\d{3})*,\d{2}")
DATE_PREFIX_RE = re.compile(r"^(\d{2})[-.](\d{2})[-.](\d{2})\s+(.+)$")
# Formato nuevo: dos columnas al final, pesos y dólares ("54.541,62 0,00"). El
# pago trae el signo adelante ("-337.635,99 0,00").
_AMT = r"-?\d{1,3}(?:\.\d{3})*,\d{2}-?"
TWO_AMOUNTS_RE = re.compile(rf"\s({_AMT})\s+({_AMT})\s*$")
DATE_HEADER_RE = re.compile(r"(\d{2})\s+([A-Za-zÁ-Úá-ú]{3})\.?\s+(\d{2})")
CUPON_RE = re.compile(r"^(\d{4,8})\s+(.*)$")
CUOTA_RE = re.compile(r"C\.(\d{2})/(\d{2})")
CARD_TOTAL_RE = re.compile(
    r"^TARJETA (\d+) Total Consumos de (.+?)\s+\d{1,3}(?:\.\d{3})*,\d{2}\s+\d{1,3}(?:\.\d{3})*,\d{2}$"
)

PAGOS_PREFIX = "SU PAGO"


def parse_amount(raw: str) -> Decimal:
    raw = raw.strip()
    negative = raw.endswith("-") or raw.startswith("-")
    raw = raw.strip("-")
    val = Decimal(raw.replace(".", "").replace(",", "."))
    return -val if negative else val


def parse_short_date(dd: str, mm: str, yy: str) -> date:
    return date(2000 + int(yy), int(mm), int(dd))


def parse_header_date(dd: str, mon: str, yy: str) -> date:
    month = MONTHS[mon.strip().lower().rstrip(".")[:3]]
    return date(2000 + int(yy), month, int(dd))


def split_amount(rest: str) -> tuple[Decimal, str, str] | None:
    """(importe, moneda, lo que queda adelante) del final de un renglón: las
    dos columnas del formato nuevo (gana la que no es cero), o el importe
    único del viejo."""
    two = TWO_AMOUNTS_RE.search(rest)
    if two:
        ars, usd = parse_amount(two.group(1)), parse_amount(two.group(2))
        if ars == 0 and usd != 0:
            return usd, "USD", rest[: two.start()].strip()
        return ars, "ARS", rest[: two.start()].strip()
    one = AMOUNT_RE.search(rest)
    if not one:
        return None
    return parse_amount(one.group(1)), "ARS", rest[: one.start()].strip()


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

    split = split_amount(rest)
    if split is None:
        return None
    amount, currency, remainder = split
    if not remainder:
        return None

    if remainder.startswith(PAGOS_PREFIX) or amount < 0:
        return {
            "date": item_date.isoformat(),
            "description": remainder,
            "amount": str(amount),
            "currency": currency,
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
        "currency": currency,
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
    split = split_amount(rest)
    if split is None:
        return None
    amount, currency, description = split
    description = description.strip("$ ").strip()
    if not description:
        return None
    return {"date": item_date.isoformat(), "description": description, "amount": str(amount), "currency": currency}


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

    account_m = re.search(r"N(?:RO)? DE CUENTA:?\s*(\d+)", full_text)

    # Formato nuevo: "VENCIMIENTO SALDO $ …" es un encabezado de columnas y la
    # fecha va al principio de la línea siguiente ("28 Oct 26 344.714,44 …").
    due = find_date(r"VENCIMIENTO ACTUAL:")
    if due is None:
        m = re.search(r"VENCIMIENTO SALDO[^\n]*\n(\d{2})\s+([A-Za-zÁ-Úá-ú]{3})\.?\s+(\d{2})", full_text)
        if m:
            due = parse_header_date(m.group(1), m.group(2), m.group(3)).isoformat()

    meta = {
        "bank": "Banco Nación",
        "account_number": account_m.group(1) if account_m else None,
        "closing_date": find_date(r"CIERRE ACTUAL:"),
        "due_date": due,
        "prev_closing_date": find_date(r"CIERRE ANTERIOR"),
        "prev_due_date": find_date(r"VTO\. ANTERIOR"),
        "next_closing_date": find_date(r"PROXIMO CIERRE"),
        "next_due_date": find_date(r"PROXIMO VTO"),
        "saldo_actual_ars": find_amount(r"SALDO ACTUAL:?"),
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
