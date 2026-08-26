"""
Importador puntual de resúmenes de tarjeta BBVA para RegistrApp.

Flujo (ver plan): extract -> revisión manual del JSON -> import --dry-run -> import --commit.

Requiere, solo para los subcomandos que tocan la base (`cards`, `categories`, `import`),
las variables de entorno:
    DATABASE_URL=postgresql+asyncpg://user:pass@host:puerto/db   (apuntando a la DB deseada)
    FIREBASE_PROJECT_ID=cualquier-valor   (requerido por app.core.config.Settings, no se usa acá)

Ejemplos:
    python -m scripts.import_bbva_statements extract ../context/*.pdf
    python -m scripts.import_bbva_statements cards --email tu-email@ejemplo.com
    python -m scripts.import_bbva_statements categories --email tu-email@ejemplo.com
    python -m scripts.import_bbva_statements import scripts/_staging/file.json --email tu-email@ejemplo.com --dry-run
    python -m scripts.import_bbva_statements import scripts/_staging/file.json --email tu-email@ejemplo.com --commit --force-import 0:3,1:1
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from calendar import monthrange
from datetime import date
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

MONTHS = {
    "ene": 1, "feb": 2, "mar": 3, "abr": 4, "may": 5, "jun": 6,
    "jul": 7, "ago": 8, "set": 9, "sep": 9, "oct": 10, "nov": 11, "dic": 12,
}

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

# La "cuenta" consolidada de BBVA agrupa 2 tarjetas físicas distintas (titular +
# adicional) bajo un mismo resumen. Cada "Consumos <titular>" del PDF corresponde
# a una tarjeta real ya cargada en la app, no a la cuenta consolidada.
CARDHOLDER_CARD_HINTS = {
    "Miguel A Mercado": {"last_4": "4919", "hint_label": "Visa Black"},
    "Maria F Diaz": {"last_4": "4901", "hint_label": "Visa Black"},
}


def parse_amount(raw: str) -> Decimal:
    return Decimal(raw.strip().replace(".", "").replace(",", "."))


def parse_short_date(token: str) -> date:
    dd, mon, yy = token.split("-")
    month = MONTHS[mon.strip().lower()[:3]]
    return date(2000 + int(yy), month, int(dd))


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


def extract_lines(pdf_path: Path) -> list[str]:
    import pdfplumber

    lines: list[str] = []
    with pdfplumber.open(str(pdf_path)) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend(text.split("\n"))
    return [ln.strip() for ln in lines if ln.strip()]


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
        d = date.fromisoformat(meta["closing_date"])
        # BBVA cierra algunos ciclos en los primeros días del mes siguiente
        # (p.ej. cierre 02-Jul para lo que sigue siendo, en la nomenclatura habitual,
        # el resumen de "Junio"). Si el cierre cae muy temprano en el mes, el período
        # se asigna al mes anterior — evita que dos resúmenes consecutivos choquen en
        # el mismo (year, month) cuando uno cierra a fin de mes y el siguiente a
        # principios del próximo.
        if d.day <= 5:
            month = d.month - 1 or 12
            year = d.year - 1 if d.month == 1 else d.year
        else:
            year, month = d.year, d.month
        meta["year"], meta["month"] = year, month

    return meta


def parse_statement(pdf_path: Path) -> dict:
    lines = extract_lines(pdf_path)
    meta = parse_header(lines)

    items: list[dict] = []
    excluded_payments: list[dict] = []
    excluded_taxes: list[dict] = []
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
        hint = CARDHOLDER_CARD_HINTS.get(cardholder, {})
        cardholder_items = [i for i in items if i["cardholder"] == cardholder]
        statements.append({
            "cardholder": cardholder,
            "year": meta["year"],
            "month": meta["month"],
            "closing_date": meta["closing_date"],
            "due_date": meta["due_date"],
            "is_latest_statement": False,
            "card": {
                "bank": "BBVA",
                "hint_last_4": hint.get("last_4"),
                "hint_label": hint.get("hint_label"),
                "existing_card_id": None,
                "create_new": None,
                "new_alias": None,
            },
            "items": cardholder_items,
        })

    return {
        "source_file": str(pdf_path),
        **meta,
        "account_note": (
            "La 'cuenta' de BBVA consolida 2 tarjetas físicas distintas (titular + adicional). "
            "Cada entrada de 'statements' corresponde a una tarjeta real, no a esta cuenta consolidada."
        ),
        "statements": statements,
        "excluded": {"payments": excluded_payments, "taxes_and_fees": excluded_taxes},
    }


def cmd_extract(args: argparse.Namespace) -> None:
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for pdf_path in args.pdfs:
        data = parse_statement(pdf_path)
        out_path = args.out_dir / f"{pdf_path.stem}.json"
        out_path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")

        print(f"--- {pdf_path.name} ---")
        print(f"  Período: {data['month']}/{data['year']}  cierre={data['closing_date']}  vto={data['due_date']}")
        if not data["closing_date"]:
            print("  ADVERTENCIA: no se pudo detectar cierre/vencimiento — revisar manualmente")
        if not data["statements"]:
            print("  ADVERTENCIA: no se detectaron ítems de consumo — revisar el PDF/parser")
        for stmt in data["statements"]:
            n_items = len(stmt["items"])
            n_usd = sum(1 for i in stmt["items"] if i["currency"] == "USD")
            n_installment = sum(1 for i in stmt["items"] if i["item_type"] == "installment")
            card = stmt["card"]
            print(f"  [{stmt['cardholder']}] {card['hint_label']} ...{card['hint_last_4']}: "
                  f"{n_items} ítems ({n_usd} USD, {n_installment} cuotas)")
        print(f"  -> {out_path}")
        print()
    print("Revisá y completá cada JSON (category_id, existing_card_id / create_new por tarjeta) antes de importar.")


async def _get_session():
    if "DATABASE_URL" not in os.environ:
        raise SystemExit("Falta la variable de entorno DATABASE_URL")
    os.environ.setdefault("FIREBASE_PROJECT_ID", "unused-for-this-script")

    from app.core.database import AsyncSessionLocal
    return AsyncSessionLocal()


async def _resolve_user(session, email: str):
    from sqlalchemy import select
    from app.models.user import User

    user = await session.scalar(select(User).where(User.email == email))
    if not user:
        raise SystemExit(f"No se encontró un usuario con email {email}")
    return user


def cmd_cards(args: argparse.Namespace) -> None:
    async def run():
        from sqlalchemy import select
        from app.models.credit_card import CreditCard

        session = await _get_session()
        async with session:
            user = await _resolve_user(session, args.email)
            cards = await session.scalars(
                select(CreditCard).where(CreditCard.tenant_id == user.tenant_id)
            )
            print(f"Tarjetas existentes para {args.email} (tenant_id={user.tenant_id}):")
            for c in cards.all():
                print(f"  id={c.id}  bank={c.bank}  alias={c.alias!r}  last_4={c.last_4_digits}")

    asyncio.run(run())


def cmd_categories(args: argparse.Namespace) -> None:
    async def run():
        from sqlalchemy import select
        from app.models.expense import ExpenseCategory

        session = await _get_session()
        async with session:
            user = await _resolve_user(session, args.email)
            cats = await session.scalars(
                select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
            )
            print(f"Categorías existentes para {args.email} (tenant_id={user.tenant_id}):")
            for c in cats.all():
                print(f"  id={c.id}  name={c.name!r}")

    asyncio.run(run())


def _next_month_date(d: date, months_ahead: int) -> date:
    month = d.month + months_ahead
    year = d.year + (month - 1) // 12
    month = (month - 1) % 12 + 1
    day = min(d.day, monthrange(year, month)[1])
    return date(year, month, day)


async def _get_or_create_usd_category(session, tenant_id: int) -> int:
    from sqlalchemy import select
    from app.models.expense import ExpenseCategory

    cat = await session.scalar(
        select(ExpenseCategory).where(
            ExpenseCategory.tenant_id == tenant_id,
            ExpenseCategory.name == "Consumo en dólares",
        )
    )
    if not cat:
        cat = ExpenseCategory(tenant_id=tenant_id, name="Consumo en dólares", color="#22c55e", is_fixed=False)
        session.add(cat)
        await session.flush()
    return cat.id


async def _create_expense_entry(session, card, item_date, amount, description, category_id, tenant_id, user_id, currency):
    from app.models.expense import EXPENSE_SOURCE_IMPORT, ExpenseEntry

    entry = ExpenseEntry(
        tenant_id=tenant_id, user_id=user_id, category_id=category_id,
        amount=amount, description=description, expense_date=item_date,
        payment_method="tarjeta_credito", entity=card.bank, currency=currency,
        source=EXPENSE_SOURCE_IMPORT,
    )
    session.add(entry)
    await session.flush()
    return entry


async def _find_or_create_statement_for_period(session, card, year, month, tenant_id):
    from sqlalchemy import select
    from app.models.credit_card import CreditCardStatement

    stmt = await session.scalar(
        select(CreditCardStatement).where(
            CreditCardStatement.card_id == card.id,
            CreditCardStatement.year == year,
            CreditCardStatement.month == month,
        )
    )
    if not stmt:
        stmt = CreditCardStatement(tenant_id=tenant_id, card_id=card.id, year=year, month=month, status="open")
        session.add(stmt)
        await session.flush()
    return stmt


async def _resolve_card(session, data, tenant_id, user_id):
    from app.models.credit_card import CreditCard

    card_info = data["card"]
    if card_info.get("existing_card_id"):
        card = await session.get(CreditCard, card_info["existing_card_id"])
        if not card or card.tenant_id != tenant_id:
            raise SystemExit(f"existing_card_id {card_info['existing_card_id']} inválido para este tenant")
        return card, False
    if card_info.get("create_new"):
        if not card_info.get("new_alias"):
            raise SystemExit("create_new=true requiere new_alias en el JSON")
        card = CreditCard(
            tenant_id=tenant_id, user_id=user_id,
            bank=card_info.get("bank", "BBVA"),
            alias=card_info["new_alias"],
            last_4_digits=card_info.get("hint_last_4"),
        )
        session.add(card)
        await session.flush()
        return card, True
    raise SystemExit(
        "El JSON no indica card.existing_card_id ni card.create_new=true — "
        "completá la revisión manual primero (correr 'cards --email ...' para ver las tarjetas existentes)"
    )


async def _resolve_statement(session, card, data, tenant_id):
    from app.models.credit_card import CreditCardStatement
    from sqlalchemy import select

    year, month = data["year"], data["month"]
    closing_date = date.fromisoformat(data["closing_date"]) if data.get("closing_date") else None
    due_date = date.fromisoformat(data["due_date"]) if data.get("due_date") else None

    stmt = await session.scalar(
        select(CreditCardStatement).where(
            CreditCardStatement.card_id == card.id,
            CreditCardStatement.year == year,
            CreditCardStatement.month == month,
        )
    )
    created = False
    if not stmt:
        stmt = CreditCardStatement(
            tenant_id=tenant_id, card_id=card.id, year=year, month=month,
            closing_date=closing_date, due_date=due_date, status="open",
        )
        session.add(stmt)
        await session.flush()
        created = True
    else:
        if not stmt.closing_date and closing_date:
            stmt.closing_date = closing_date
        if not stmt.due_date and due_date:
            stmt.due_date = due_date
    return stmt, created


async def _find_amount_duplicates(session, statement_id, amount):
    from sqlalchemy import select
    from app.models.credit_card import CreditCardItem

    result = await session.scalars(
        select(CreditCardItem).where(
            CreditCardItem.statement_id == statement_id,
            CreditCardItem.amount == amount,
        )
    )
    return list(result.all())


async def _import_item(session, *, card, statement, item_json, tenant_id, user_id, propagate_future):
    from app.models.credit_card import CreditCardItem

    amount = parse_amount(item_json["amount"]) if isinstance(item_json["amount"], str) and "," in item_json["amount"] else Decimal(str(item_json["amount"]))
    currency = item_json.get("currency", "ARS")
    description = item_json["description"]
    item_date = date.fromisoformat(item_json["date"])
    item_type = item_json.get("item_type", "single")
    installment_number = item_json.get("installment_number")
    installment_count = item_json.get("installment_count")

    if currency == "USD":
        category_id = await _get_or_create_usd_category(session, tenant_id)
    else:
        category_id = item_json.get("category_id")
        if not category_id:
            raise ValueError(f"Falta category_id para '{description}' ({amount} {currency})")

    label = description
    if item_type == "installment" and installment_number and installment_count:
        label = f"{description} ({installment_number}/{installment_count})"

    entry = await _create_expense_entry(
        session, card, item_date, amount, label, category_id, tenant_id, user_id, currency,
    )
    item = CreditCardItem(
        statement_id=statement.id,
        description=description,
        category_id=category_id,
        item_date=item_date,
        item_type=item_type,
        amount=amount,
        currency=currency,
        installment_count=installment_count,
        installment_number=installment_number if item_type == "installment" else None,
        expense_entry_id=entry.id,
    )
    session.add(item)
    await session.flush()

    created_future = 0
    if (
        propagate_future
        and item_type == "installment"
        and installment_count
        and installment_number
        and installment_number < installment_count
    ):
        remaining = installment_count - installment_number
        for offset in range(1, remaining + 1):
            future_date = _next_month_date(date(statement.year, statement.month, 1), offset)
            future_stmt = await _find_or_create_statement_for_period(
                session, card, future_date.year, future_date.month, tenant_id
            )
            future_item_date = _next_month_date(item_date, offset)
            cuota_n = installment_number + offset
            future_entry = await _create_expense_entry(
                session, card, future_item_date, amount,
                f"{description} ({cuota_n}/{installment_count})",
                category_id, tenant_id, user_id, currency,
            )
            from app.models.credit_card import CreditCardItem as _Item
            future_item = _Item(
                statement_id=future_stmt.id, description=description, category_id=category_id,
                item_date=future_item_date, item_type="installment", amount=amount,
                installment_count=installment_count, installment_number=cuota_n,
                installment_group_id=item.id, expense_entry_id=future_entry.id,
            )
            session.add(future_item)
            created_future += 1

    return item, created_future


async def _process_one_statement(session, stmt_data, *, user, commit, force_import):
    card, card_created = await _resolve_card(session, stmt_data, user.tenant_id, user.id)
    print(f"  Tarjeta [{stmt_data.get('cardholder')}]: {'CREAR NUEVA' if card_created else 'existente'} "
          f"id={card.id} alias={card.alias!r} last_4={card.last_4_digits}")

    statement, stmt_created = await _resolve_statement(session, card, stmt_data, user.tenant_id)
    print(
        f"  Resumen {stmt_data['month']}/{stmt_data['year']}: "
        f"{'CREAR NUEVO' if stmt_created else 'existente'} id={statement.id}"
    )

    n_imported = n_skipped_dup = n_forced = 0
    errors = []
    for idx, item_json in enumerate(stmt_data["items"]):
        amount = parse_amount(item_json["amount"]) if "," in str(item_json["amount"]) else Decimal(str(item_json["amount"]))
        dups = await _find_amount_duplicates(session, statement.id, amount)

        if dups:
            print(f"    [{idx}] POSIBLE DUPLICADO — nuevo: {item_json['date']} {item_json['description']} {amount} {item_json['currency']}")
            for d in dups:
                print(f"          ya existe id={d.id}: {d.item_date} {d.description} {d.amount}")
            if idx not in force_import:
                n_skipped_dup += 1
                print("          -> OMITIDO (pasar su índice en --force-import para importarlo igual)")
                continue
            n_forced += 1
            print("          -> se importa igual (--force-import)")

        if not commit:
            print(f"    [{idx}] A IMPORTAR (dry-run): {item_json['date']} {item_json['description']} {amount} {item_json['currency']}")
            n_imported += 1
            continue

        try:
            item, n_future = await _import_item(
                session, card=card, statement=statement, item_json=item_json,
                tenant_id=user.tenant_id, user_id=user.id,
                propagate_future=stmt_data.get("is_latest_statement", False),
            )
            n_imported += 1
            suffix = f" (+{n_future} cuotas futuras)" if n_future else ""
            print(f"    [{idx}] IMPORTADO id={item.id}{suffix}")
        except ValueError as exc:
            errors.append(f"[{stmt_data.get('cardholder')}][{idx}] {exc}")
            print(f"    [{idx}] ERROR: {exc}")

    print(f"  -> {n_imported} a importar/importados, {n_skipped_dup} omitidos por posible duplicado, "
          f"{n_forced} forzados, {len(errors)} errores.")
    return n_imported, n_skipped_dup, n_forced, errors


def _parse_force_import(raw: str) -> dict[int, set[int]]:
    """Formato: "stmt_idx:item_idx,stmt_idx:item_idx" (stmt_idx = posición en data['statements'])."""
    result: dict[int, set[int]] = {}
    for token in raw.split(","):
        token = token.strip()
        if not token:
            continue
        stmt_idx_s, _, item_idx_s = token.partition(":")
        result.setdefault(int(stmt_idx_s), set()).add(int(item_idx_s))
    return result


def cmd_import(args: argparse.Namespace) -> None:
    force_import_by_stmt = _parse_force_import(args.force_import) if args.force_import else {}
    data = json.loads(args.json_file.read_text(encoding="utf-8"))

    async def run():
        session = await _get_session()
        async with session:
            user = await _resolve_user(session, args.email)

            totals = [0, 0, 0]
            all_errors = []
            for stmt_idx, stmt_data in enumerate(data["statements"]):
                print(f"--- [{stmt_idx}] {stmt_data.get('cardholder')} ---")
                n_imported, n_skipped_dup, n_forced, errors = await _process_one_statement(
                    session, stmt_data, user=user, commit=args.commit,
                    force_import=force_import_by_stmt.get(stmt_idx, set()),
                )
                totals[0] += n_imported
                totals[1] += n_skipped_dup
                totals[2] += n_forced
                all_errors.extend(errors)

            print()
            print(f"Total: {totals[0]} a importar/importados, {totals[1]} omitidos por posible duplicado, "
                  f"{totals[2]} forzados, {len(all_errors)} errores.")

            if args.commit:
                if all_errors:
                    await session.rollback()
                    print("Se hizo ROLLBACK por errores — corregí el JSON y reintentá.")
                else:
                    await session.commit()
                    print("COMMIT realizado.")
            else:
                await session.rollback()
                print("(dry-run: no se escribió nada en la base)")

    asyncio.run(run())


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)

    p_extract = sub.add_parser("extract", help="Extrae datos de PDFs de resumen BBVA a JSON")
    p_extract.add_argument("pdfs", nargs="+", type=Path)
    p_extract.add_argument("--out-dir", type=Path, default=Path(__file__).parent / "_staging")
    p_extract.set_defaults(func=cmd_extract)

    p_cards = sub.add_parser("cards", help="Lista las tarjetas existentes del tenant del usuario")
    p_cards.add_argument("--email", required=True)
    p_cards.set_defaults(func=cmd_cards)

    p_categories = sub.add_parser("categories", help="Lista las categorías de gasto del tenant del usuario")
    p_categories.add_argument("--email", required=True)
    p_categories.set_defaults(func=cmd_categories)

    p_import = sub.add_parser("import", help="Importa un JSON de resumen ya revisado")
    p_import.add_argument("json_file", type=Path)
    p_import.add_argument("--email", required=True)
    mode = p_import.add_mutually_exclusive_group(required=True)
    mode.add_argument("--dry-run", action="store_true")
    mode.add_argument("--commit", action="store_true")
    p_import.add_argument(
        "--force-import", default="",
        help=(
            "Ítems marcados como posible duplicado que igual hay que importar, formato "
            "'stmt_idx:item_idx,...' (stmt_idx = posición en data['statements'], ej. '0:3,1:1')"
        ),
    )
    p_import.set_defaults(func=cmd_import)

    return parser


def main() -> None:
    parser = build_arg_parser()
    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
