"""Parser de resúmenes BBVA (Visa y Mastercard — el formato es el mismo).

Movido tal cual desde `scripts/import_bbva_statements.py`; el script ahora
importa de acá. La única diferencia con el original es que cada bloque de
titular captura su total ("TOTAL CONSUMOS DE …") en `block_total`, que es lo
que permite el control de totales de la conciliación.
"""
from __future__ import annotations

import re
from datetime import date
from decimal import Decimal

from app.services.statement_parsers.common import MONTHS, assign_period

BANK_ID = "bbva"

AMOUNT_RE = re.compile(r"(-?\d{1,3}(?:\.\d{3})*,\d{2})\s*$")
AMOUNT_TOKEN_RE = re.compile(r"-?\d{1,3}(?:\.\d{3})*,\d{2}")
DATE_PREFIX_RE = re.compile(r"^(\d{2})-([A-Za-zÁ-Úá-ú]{3})-(\d{2})\s+(.+)$")
DATE_TOKEN_RE = re.compile(r"\d{2}-[A-Za-zÁ-Úá-ú]{3}-\d{2}")
CUOTA_RE = re.compile(r"C\.(\d{2})/(\d{2})")
TRAILING_DIGITS_RE = re.compile(r"^(.*?)\s+(\d{5,10})$")

CONSUMOS_PREFIX = "Consumos "
TOTAL_CONSUMOS_PREFIX = "TOTAL CONSUMOS DE"
PAGOS_HEADER = "Sus pagos y ajustes realizados"
IMPUESTOS_HEADER = "Impuestos, cargos e intereses"
ROW_HEADERS = {
    "FECHA DESCRIPCIÓN NRO. CUPÓN PESOS DÓLARES",
    "FECHA DESCRIPCIÓN PESOS DÓLARES",
}

# La "cuenta" consolidada de BBVA agrupa varias tarjetas físicas (titular +
# adicional) bajo un mismo resumen. Cada "Consumos <titular>" del PDF
# corresponde a una tarjeta real. Los hints sólo orientan la revisión manual
# del JSON; el nombre puede venir escrito distinto entre productos (p.ej.
# "Miguel A Mercado" en Visa y "Miguel Agus Mercado" en Mastercard).
VISA_CARDHOLDER_HINTS = {
    "Miguel A Mercado": {"last_4": "4919", "hint_label": "Visa Black"},
    "Maria F Diaz": {"last_4": "4901", "hint_label": "Visa Black"},
}
MASTERCARD_CARDHOLDER_HINTS = {
    "Miguel Agus Mercado": {"last_4": None, "hint_label": "Mastercard Black"},
}
ALL_CARDHOLDER_HINTS = {**VISA_CARDHOLDER_HINTS, **MASTERCARD_CARDHOLDER_HINTS}


def parse_amount(raw: str) -> Decimal:
    return Decimal(raw.strip().replace(".", "").replace(",", "."))


def parse_short_date(token: str) -> date:
    dd, mon, yy = token.split("-")
    month = MONTHS[mon.strip().lower()[:3]]
    return date(2000 + int(yy), month, int(dd))


def detect(lines: list[str]) -> bool:
    return any(
        line in ROW_HEADERS or line.startswith(TOTAL_CONSUMOS_PREFIX)
        for line in lines
    )


def parse_row(line: str, with_cupon: bool) -> dict | None:
    m = DATE_PREFIX_RE.match(line)
    if not m:
        return None
    dd, mon, yy, rest = m.groups()
    try:
        item_date = parse_short_date(f"{dd}-{mon}-{yy}")
    except (KeyError, ValueError):
        return None

    amt_m = AMOUNT_RE.search(rest)
    if not amt_m:
        return None
    amount = parse_amount(amt_m.group(1))
    remainder = rest[: amt_m.start()].strip()
    if not remainder:
        return None

    cupon = None
    if with_cupon:
        cm = TRAILING_DIGITS_RE.match(remainder)
        if cm:
            remainder, cupon = cm.group(1).strip(), cm.group(2)

    currency = "USD" if "USD" in remainder.upper() else "ARS"

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


def parse_header(lines: list[str]) -> dict:
    meta = {
        "bank": "BBVA",
        "card_label": None,
        "account_number": None,
        "closing_date": None,
        "due_date": None,
        "prev_closing_date": None,
        "prev_due_date": None,
        "next_closing_date": None,
        "next_due_date": None,
        "saldo_actual_ars": None,
        "saldo_actual_usd": None,
        "year": None,
        "month": None,
    }

    for i, line in enumerate(lines):
        m = re.match(r"^cuenta\s+(\d+)", line, re.IGNORECASE)
        if m and meta["account_number"] is None:
            meta["account_number"] = m.group(1)
            if i > 0:
                label = re.sub(r"\s*(CONSOLIDADO|INDIVIDUAL)\s*$", "", lines[i - 1]).strip()
                meta["card_label"] = label

        if (
            meta["closing_date"] is None
            and "CIERRE ACTUAL" in line
            and "VENCIMIENTO ACTUAL" in line
        ):
            for j in range(i + 1, min(i + 4, len(lines))):
                dates = DATE_TOKEN_RE.findall(lines[j])
                if len(dates) >= 2:
                    meta["closing_date"] = parse_short_date(dates[0]).isoformat()
                    meta["due_date"] = parse_short_date(dates[1]).isoformat()
                    amounts = AMOUNT_TOKEN_RE.findall(lines[j])
                    if len(amounts) >= 1:
                        meta["saldo_actual_ars"] = str(parse_amount(amounts[0]))
                    if len(amounts) >= 2:
                        meta["saldo_actual_usd"] = str(parse_amount(amounts[1]))
                    break

        if (
            meta["prev_closing_date"] is None
            and "CIERRE ANTERIOR" in line
            and "VENCIMIENTO ANTERIOR" in line
            and "PRÓXIMO CIERRE" in line
        ):
            for j in range(i + 1, min(i + 4, len(lines))):
                dates = DATE_TOKEN_RE.findall(lines[j])
                if len(dates) >= 4:
                    meta["prev_closing_date"] = parse_short_date(dates[0]).isoformat()
                    meta["prev_due_date"] = parse_short_date(dates[1]).isoformat()
                    meta["next_closing_date"] = parse_short_date(dates[2]).isoformat()
                    meta["next_due_date"] = parse_short_date(dates[3]).isoformat()
                    break

    if meta["closing_date"]:
        meta["year"], meta["month"] = assign_period(date.fromisoformat(meta["closing_date"]))

    return meta


def parse_lines(
    lines: list[str],
    hints: dict[str, dict] | None = None,
    bank_label: str = "BBVA",
) -> dict:
    """Parsea las líneas ya extraídas del PDF. Mismo shape que producían los
    scripts (`parse_statement` menos `source_file`), más `block_total` por
    titular."""
    if hints is None:
        hints = ALL_CARDHOLDER_HINTS
    meta = parse_header(lines)

    items: list[dict] = []
    excluded_payments: list[dict] = []
    excluded_taxes: list[dict] = []
    block_totals: dict[str, dict] = {}
    mode = None
    current_cardholder = None

    for line in lines:
        if line in ROW_HEADERS:
            continue
        if line.startswith(PAGOS_HEADER):
            mode = "pagos"
            continue
        if line.startswith(IMPUESTOS_HEADER):
            mode = "impuestos"
            continue
        if line.startswith(CONSUMOS_PREFIX) and not line.startswith(TOTAL_CONSUMOS_PREFIX):
            current_cardholder = line[len(CONSUMOS_PREFIX):].strip()
            mode = "consumo"
            continue
        if line.startswith(TOTAL_CONSUMOS_PREFIX):
            # "TOTAL CONSUMOS DE <titular> <pesos> <dólares>" — el total que
            # imprime el banco para el bloque que se acaba de cerrar. Es el
            # dato de control: si la suma de los ítems extraídos no coincide,
            # la lectura falló. Se ACUMULA por titular, no se pisa: un resumen
            # real puede traer dos bloques "Consumos <mismo nombre>" (visto en
            # el de agosto 2026), y los ítems de ambos van al mismo statement.
            # La línea sólo cuenta si veníamos de consumos — la carátula
            # repite estos renglones antes de cualquier encabezado "Consumos".
            if current_cardholder and mode == "consumo":
                amounts = AMOUNT_TOKEN_RE.findall(line)
                prev = block_totals.get(current_cardholder)
                new = {
                    "ars": parse_amount(amounts[0]) if len(amounts) >= 1 else None,
                    "usd": parse_amount(amounts[1]) if len(amounts) >= 2 else None,
                }
                if prev is not None:
                    for k in ("ars", "usd"):
                        if new[k] is not None or prev[k] is not None:
                            new[k] = (new[k] or 0) + (prev[k] or 0)
                block_totals[current_cardholder] = new
            mode = None
            continue
        if line.startswith("SALDO ACTUAL") or line.startswith("Legales y avisos"):
            mode = None
            continue

        if mode == "consumo":
            row = parse_row(line, with_cupon=True)
            if row:
                row["cardholder"] = current_cardholder
                row["category_id"] = None
                items.append(row)
        elif mode == "pagos":
            row = parse_row(line, with_cupon=False)
            if row:
                excluded_payments.append(row)
        elif mode == "impuestos":
            row = parse_row(line, with_cupon=False)
            if row:
                excluded_taxes.append(row)

    statements = []
    for cardholder in sorted({i["cardholder"] for i in items if i["cardholder"]}):
        hint = hints.get(cardholder, {})
        cardholder_items = [i for i in items if i["cardholder"] == cardholder]
        bt = block_totals.get(cardholder)
        block_total = (
            {k: (str(v) if v is not None else None) for k, v in bt.items()} if bt else None
        )
        statements.append({
            "cardholder": cardholder,
            "year": meta["year"],
            "month": meta["month"],
            "closing_date": meta["closing_date"],
            "due_date": meta["due_date"],
            "is_latest_statement": False,
            "card": {
                "bank": bank_label,
                "hint_last_4": hint.get("last_4"),
                "hint_label": hint.get("hint_label"),
                "existing_card_id": None,
                "create_new": None,
                "new_alias": None,
            },
            "items": cardholder_items,
            "block_total": block_total,
        })

    return {
        **meta,
        "account_note": (
            "La 'cuenta' de BBVA consolida 2 tarjetas físicas distintas (titular + adicional). "
            "Cada entrada de 'statements' corresponde a una tarjeta real, no a esta cuenta consolidada."
        ),
        "statements": statements,
        "excluded": {"payments": excluded_payments, "taxes_and_fees": excluded_taxes},
    }
