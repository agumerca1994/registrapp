"""Orquestador de una conciliación: PDF → sesión con acciones propuestas.

El flujo es el del doc de referencia: leer el PDF (parsers determinísticos),
verificar contra los totales del banco, elegir tarjeta y período, matchear
contra lo cargado y clasificar las diferencias en grupos que el usuario
confirma de a uno. **Nada de esto escribe en los resúmenes** — eso es
`apply.py`, y sólo después de la confirmación.

El PDF se procesa en memoria y no se guarda nunca: en la sesión queda
`parsed` (los renglones ya estructurados, sin domicilio ni números de
cuenta — el parser no los extrae). Eso permite retomar una sesión
`needs_choice` sin volver a subir el archivo.
"""
from __future__ import annotations

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement
from app.models.reconciliation import (
    ACTION_NEEDS_APP,
    ACTION_PROPOSED,
    CaptureEvent,
    ReconciliationAction,
    ReconciliationSession,
    SESSION_NEEDS_AI,
    SESSION_NEEDS_CHOICE,
    SESSION_READY,
    SESSION_UNEXPLAINED,
)
from app.services import category_suggest
from app.services.credit_cards import find_or_create_statement
from app.services.reconcile import matching, period, rules
from app.services.reconcile.matching import AppItem, BankItem
from app.services.statement_parsers import detect_and_parse

# Orden de presentación de los grupos (el reporte y el apply lo siguen).
GROUP_ORDER = [
    "dates",
    "missing",
    "double_count",
    "amount_diff",
    "usd_fix",
    "rounding",
    "surplus",
]


async def record_event(
    db: AsyncSession,
    *,
    tenant_id: int,
    user_id: int | None,
    channel: str,
    input_kind: str,
    outcome: str,
    reason: str | None = None,
    bank_detected: str | None = None,
    pages_total: int | None = None,
    pages_with_movements: int | None = None,
    est_input_tokens: int | None = None,
) -> None:
    db.add(CaptureEvent(
        tenant_id=tenant_id,
        user_id=user_id,
        channel=channel,
        input_kind=input_kind,
        outcome=outcome,
        reason=reason,
        bank_detected=bank_detected,
        pages_total=pages_total,
        pages_with_movements=pages_with_movements,
        est_input_tokens=est_input_tokens,
    ))
    await db.flush()


async def start_session(
    db: AsyncSession,
    *,
    user,
    pdf_bytes: bytes,
    channel: str = "app",
    card_id: int | None = None,
) -> ReconciliationSession:
    """Lee el PDF y arma la sesión. **Sólo flush, nunca commit.**"""
    result = detect_and_parse(pdf_bytes)

    session = ReconciliationSession(
        tenant_id=user.tenant_id,
        user_id=user.id,
        channel=channel,
        status=SESSION_NEEDS_AI,
        reason=None,
    )
    db.add(session)

    if not result.ok:
        session.reason = result.status
        await db.flush()
        await record_event(
            db,
            tenant_id=user.tenant_id,
            user_id=user.id,
            channel=channel,
            input_kind="pdf",
            outcome="needs_ai",
            reason=result.status,
            pages_total=result.pages_total,
            pages_with_movements=len(result.pages_with_movements),
            est_input_tokens=result.est_input_tokens,
        )
        return session

    data = result.data
    session.bank_id = result.bank_id
    session.closing_date = date.fromisoformat(data["closing_date"]) if data.get("closing_date") else None
    session.due_date = date.fromisoformat(data["due_date"]) if data.get("due_date") else None
    session.period_year = data.get("year")
    session.period_month = data.get("month")

    # Todos los bloques del PDF van a una misma tarjeta (regla del caso real:
    # el consolidado entero se carga en una sola tarjeta de la app).
    items: list[dict] = []
    block_totals: dict[str, Decimal] = {}
    cardholders: list[str] = []
    for stmt in data.get("statements", []):
        if stmt.get("cardholder"):
            cardholders.append(stmt["cardholder"])
        items.extend(stmt["items"])
        bt = stmt.get("block_total") or {}
        for cur_key, cur in (("ars", "ARS"), ("usd", "USD")):
            if bt.get(cur_key) is not None:
                block_totals[cur] = block_totals.get(cur, Decimal("0")) + Decimal(bt[cur_key])
    session.cardholder = ", ".join(dict.fromkeys(cardholders)) or None

    session.parsed = {
        "bank": data.get("bank"),
        "card_label": data.get("card_label") or data.get("card_product"),
        "items": items,
        "block_totals": {k: str(v) for k, v in block_totals.items()},
        "excluded": {
            k: len(v) for k, v in (data.get("excluded") or {}).items()
        },
        "saldo_actual_ars": data.get("saldo_actual_ars"),
        "saldo_actual_usd": data.get("saldo_actual_usd"),
    }

    # Control de lectura: lo extraído tiene que sumar lo que el banco imprimió.
    sums: dict[str, Decimal] = {}
    for i in items:
        sums[i["currency"]] = sums.get(i["currency"], Decimal("0")) + Decimal(i["amount"])
    mismatch = any(
        block_totals.get(cur) is not None and sums.get(cur, Decimal("0")) != block_totals[cur]
        for cur in block_totals
    )
    outcome, reason = ("parsed_code", None) if not mismatch else ("needs_ai", "totals_mismatch")
    await record_event(
        db,
        tenant_id=user.tenant_id,
        user_id=user.id,
        channel=channel,
        input_kind="pdf",
        outcome=outcome,
        reason=reason,
        bank_detected=result.bank_id,
        pages_total=result.pages_total,
        pages_with_movements=len(result.pages_with_movements),
        est_input_tokens=result.est_input_tokens,
    )
    if mismatch:
        session.reason = "totals_mismatch"
        await db.flush()
        return session

    await resolve_session(db, session, user, explicit_card_id=card_id)
    return session


async def resolve_session(
    db: AsyncSession,
    session: ReconciliationSession,
    user,
    *,
    explicit_card_id: int | None = None,
    explicit_statement_id: int | None = None,
    save_card_rule: bool = False,
) -> ReconciliationSession:
    """Elige tarjeta y período y rehace el matching y las acciones.

    Se llama al crear la sesión y de nuevo desde `/choose` cuando el usuario
    desempata — por eso borra las acciones propuestas anteriores.
    """
    parsed = session.parsed or {}
    bank = parsed.get("bank")
    card_label = parsed.get("card_label")

    # --- Tarjeta ----------------------------------------------------------
    card: CreditCard | None = None
    if session.card_id and explicit_card_id is None:
        card = await db.get(CreditCard, session.card_id)
    if card is None:
        card_rules = await rules.get_rules(db, session.tenant_id, rules.KIND_STATEMENT_CARD)
        rule_payload = card_rules.get(rules.card_rule_key(bank, card_label))
        rule_card_id = (rule_payload or {}).get("card_id")
        choice = await period.pick_card(db, session.tenant_id, rule_card_id, explicit_card_id)
        if choice.card is None:
            session.status = SESSION_NEEDS_CHOICE
            session.reason = "card_ambiguous"
            session.choices = {"cards": choice.options}
            await db.flush()
            return session
        card = choice.card
        if explicit_card_id is not None and save_card_rule:
            await rules.save_rule(
                db, session.tenant_id, rules.KIND_STATEMENT_CARD,
                rules.card_rule_key(bank, card_label), {"card_id": card.id},
            )
    session.card_id = card.id

    # --- Resumen ----------------------------------------------------------
    stmt: CreditCardStatement | None = None
    if explicit_statement_id is not None:
        stmt = await db.get(CreditCardStatement, explicit_statement_id)
        if stmt is None or stmt.card_id != card.id:
            session.status = SESSION_NEEDS_CHOICE
            session.reason = "period_ambiguous"
            await db.flush()
            return session
    else:
        choice = await period.pick_statement(
            db,
            card,
            parsed_closing=session.closing_date,
            parsed_due=session.due_date,
            parsed_year=session.period_year,
            parsed_month=session.period_month,
            bank_items=parsed.get("items", []),
        )
        if choice.options:
            session.status = SESSION_NEEDS_CHOICE
            session.reason = "period_ambiguous"
            session.choices = {"statements": choice.options}
            await db.flush()
            return session
        if choice.create_period:
            year, month = choice.create_period
            stmt = await find_or_create_statement(card, year, month, session.tenant_id, db)
            # Resumen nuevo nuestro: las fechas del PDF entran directo.
            stmt.closing_date = stmt.closing_date or session.closing_date
            stmt.due_date = stmt.due_date or session.due_date
        else:
            stmt = choice.statement
    session.statement_id = stmt.id
    session.choices = None

    # --- Matching ---------------------------------------------------------
    exclude_rules = await rules.get_rules(db, session.tenant_id, rules.KIND_EXCLUDE)
    bank_items: list[BankItem] = []
    excluded_by_rule: list[dict] = []
    for idx, i in enumerate(parsed.get("items", [])):
        if rules.merchant_key(i["description"]) in exclude_rules:
            excluded_by_rule.append(i)
            continue
        cuota = None
        if i.get("item_type") == "installment" and i.get("installment_number"):
            cuota = (i["installment_number"], i["installment_count"])
        bank_items.append(BankItem(
            idx=idx,
            item_date=date.fromisoformat(i["date"]),
            description=i["description"],
            amount=Decimal(i["amount"]),
            currency=i["currency"],
            cupon=i.get("cupon"),
            cuota=cuota,
        ))
    session.parsed = {**parsed, "excluded_by_rule": [i["description"] for i in excluded_by_rule]}

    app_rows = (
        await db.scalars(
            select(CreditCardItem)
            .where(CreditCardItem.statement_id == stmt.id)
            .options(selectinload(CreditCardItem.shared_expense))
        )
    ).all()
    app_items = [
        AppItem(
            id=r.id,
            item_date=r.item_date,
            description=r.description,
            amount=r.amount,
            currency=r.currency,
            bank_description=r.bank_description,
            bank_coupon=r.bank_coupon,
            cuota=(r.installment_number, r.installment_count)
            if r.item_type == "installment" and r.installment_number
            else None,
            is_root=r.installment_group_id is None,
            shared=r.shared_expense is not None,
            category_id=r.category_id,
        )
        for r in app_rows
    ]

    report = matching.match_statement(bank_items, app_items)

    # --- Acciones ---------------------------------------------------------
    old = await db.scalars(
        select(ReconciliationAction).where(
            ReconciliationAction.session_id == session.id,
            ReconciliationAction.status.in_([ACTION_PROPOSED, ACTION_NEEDS_APP]),
        )
    )
    for a in old.all():
        await db.delete(a)
    await db.flush()

    await _build_actions(db, session, stmt, report)

    session.totals = {
        cur: {k: str(v) for k, v in t.items()} for cur, t in report.totals.items()
    }
    session.status = SESSION_READY if report.closes else SESSION_UNEXPLAINED
    session.reason = None if report.closes else "unexplained_difference"

    # Los matches con cupón del banco se estampan en los ítems de la app al
    # aplicar el primer grupo (metadata, no decisión del usuario).
    session.parsed = {
        **session.parsed,
        "stamps": [
            {
                "item_id": p.app.id,
                "bank_description": p.bank.description,
                "bank_coupon": p.bank.cupon,
            }
            for p in report.pairs
            if p.klass == matching.MATCHED
        ],
    }
    await db.flush()
    return session


async def _build_actions(
    db: AsyncSession,
    session: ReconciliationSession,
    stmt: CreditCardStatement,
    report: matching.MatchReport,
) -> None:
    tenant_id = session.tenant_id

    # Fechas faltantes del resumen: completarlas con las del PDF.
    if (session.closing_date and not stmt.closing_date) or (session.due_date and not stmt.due_date):
        db.add(ReconciliationAction(
            session_id=session.id,
            klass="dates",
            op="update_statement",
            payload={
                "closing_date": session.closing_date.isoformat()
                if session.closing_date and not stmt.closing_date else None,
                "due_date": session.due_date.isoformat()
                if session.due_date and not stmt.due_date else None,
            },
        ))

    # Faltantes: crear, con categoría sugerida (regla del hogar primero).
    merchant_rules = await rules.get_rules(db, tenant_id, rules.KIND_MERCHANT_CATEGORY)
    ars_missing = [b for b in report.missing if b.currency == "ARS"]
    suggestions = await category_suggest.suggest_categories_bulk(
        db, tenant_id, [b.description for b in ars_missing]
    ) if ars_missing else []
    suggestion_by_idx = {b.idx: s for b, s in zip(ars_missing, suggestions)}

    for b in report.missing:
        rule = merchant_rules.get(rules.merchant_key(b.description))
        suggestion = suggestion_by_idx.get(b.idx)
        category_id = None
        category_source = None
        description = b.description
        if b.currency == "ARS":
            if rule:
                category_id = rule.get("category_id")
                description = rule.get("description") or b.description
                category_source = "rule"
            elif suggestion:
                category_id = suggestion.category_id
                category_source = f"suggest:{suggestion.score:.2f}"
        db.add(ReconciliationAction(
            session_id=session.id,
            klass=matching.MISSING,
            op="create_item",
            payload={
                "description": description,
                "bank_description": b.description,
                "bank_coupon": b.cupon,
                "date": b.item_date.isoformat(),
                "amount": str(b.amount),
                "currency": b.currency,
                "item_type": "installment" if b.cuota else "single",
                "installment_number": b.cuota[0] if b.cuota else None,
                "installment_count": b.cuota[1] if b.cuota else None,
                "category_id": category_id,
                "category_source": category_source,
            },
        ))

    # Correcciones sobre ítems existentes.
    for klass, updates_of in (
        (matching.DOUBLE_COUNT, lambda p: {"amount": str(p.bank.amount)}),
        (matching.AMOUNT_DIFF, lambda p: {"amount": str(p.bank.amount)}),
        (matching.ROUNDING, lambda p: {"amount": str(p.bank.amount)}),
        (matching.USD_FIX, lambda p: {"description": p.bank.description, "amount": str(p.bank.amount)}),
    ):
        for p in report.pairs_of(klass):
            db.add(ReconciliationAction(
                session_id=session.id,
                klass=klass,
                op="update_item",
                item_id=p.app.id,
                status=ACTION_NEEDS_APP if p.app.shared else ACTION_PROPOSED,
                payload={
                    "item_id": p.app.id,
                    "updates": updates_of(p),
                    "scope": "item",
                    "bank_description": p.bank.description,
                    "bank_coupon": p.bank.cupon,
                    "app_description": p.app.description,
                    "app_amount": str(p.app.amount),
                    "extra_bank_idx": p.extra_bank_idx,
                },
            ))

    # Sobrantes: borrar (el usuario decide). Compartidos y cuotas hijas van
    # como needs_app — la API no los toca (misma regla que el MCP).
    for a in report.surplus:
        db.add(ReconciliationAction(
            session_id=session.id,
            klass=matching.SURPLUS,
            op="delete_item",
            item_id=a.id,
            status=ACTION_NEEDS_APP if (a.shared or not a.is_root) else ACTION_PROPOSED,
            payload={
                "item_id": a.id,
                "description": a.description,
                "amount": str(a.amount),
                "currency": a.currency,
            },
        ))
    await db.flush()
