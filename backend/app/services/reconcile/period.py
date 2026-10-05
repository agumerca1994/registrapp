"""Elegir la tarjeta y el resumen de la app contra los que conciliar.

El primer intento manual del caso de referencia eligió mal el período (usó el
mes del vencimiento y el resumen estaba cargado como 2026-09), así que el
orden de decisión está escrito y testeado:

Tarjeta: regla `statement_card` guardada → `card_id` explícito → si el hogar
tiene una sola tarjeta, ésa → si no, se pregunta (opciones).

Período, en este orden:
1. El resumen cuyo `closing_date` o `due_date` coincide con el del PDF.
2. El que más números de cuota (monto + n/N) comparte con el PDF.
3. El resumen cargado con el mismo (year, month) que el período del PDF.
4. Si no existe ninguno: se crea en el período del PDF (importar un resumen
   nuevo es conciliar contra un resumen vacío).
Empate en 1 o 2 → se pregunta.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.credit_card import CreditCard, CreditCardItem, CreditCardStatement


@dataclass
class CardChoice:
    card: CreditCard | None
    options: list[dict]  # [{card_id, alias, bank, last_4}] si hay que preguntar


@dataclass
class StatementChoice:
    statement: CreditCardStatement | None
    create_period: tuple[int, int] | None  # (year, month) si hay que crearlo
    options: list[dict]  # [{statement_id, year, month, item_count}] si empate


async def pick_card(
    db: AsyncSession,
    tenant_id: int,
    rule_card_id: int | None,
    explicit_card_id: int | None,
) -> CardChoice:
    cards = (
        await db.scalars(select(CreditCard).where(CreditCard.tenant_id == tenant_id))
    ).all()

    for cid in (explicit_card_id, rule_card_id):
        if cid is not None:
            card = next((c for c in cards if c.id == cid), None)
            if card:
                return CardChoice(card=card, options=[])

    if len(cards) == 1:
        return CardChoice(card=cards[0], options=[])

    return CardChoice(
        card=None,
        options=[
            {"card_id": c.id, "alias": c.alias, "bank": c.bank, "last_4": c.last_4_digits}
            for c in cards
        ],
    )


def _cuota_keys(items: list[dict]) -> set[tuple[str, int, int]]:
    keys = set()
    for i in items:
        if i.get("item_type") == "installment" and i.get("installment_number"):
            keys.add((str(Decimal(i["amount"])), i["installment_number"], i["installment_count"]))
    return keys


async def pick_statement(
    db: AsyncSession,
    card: CreditCard,
    *,
    parsed_closing: date | None,
    parsed_due: date | None,
    parsed_year: int | None,
    parsed_month: int | None,
    bank_items: list[dict],
) -> StatementChoice:
    stmts = (
        await db.scalars(
            select(CreditCardStatement)
            .where(CreditCardStatement.card_id == card.id)
            .options(selectinload(CreditCardStatement.items))
        )
    ).all()

    # 1. Fecha de cierre o vencimiento igual a la del PDF.
    by_date = [
        s
        for s in stmts
        if (parsed_closing and s.closing_date == parsed_closing)
        or (parsed_due and s.due_date == parsed_due)
    ]
    if len(by_date) == 1:
        return StatementChoice(statement=by_date[0], create_period=None, options=[])
    if len(by_date) > 1:
        return StatementChoice(statement=None, create_period=None, options=_options(by_date))

    # 2. Coincidencia de números de cuota (monto + n/N).
    bank_keys = _cuota_keys(bank_items)
    if bank_keys:
        scored: list[tuple[int, CreditCardStatement]] = []
        for s in stmts:
            app_keys = {
                (str(i.amount), i.installment_number, i.installment_count)
                for i in s.items
                if i.item_type == "installment" and i.installment_number
            }
            score = len(bank_keys & app_keys)
            if score:
                scored.append((score, s))
        if scored:
            scored.sort(key=lambda t: -t[0])
            top = [s for sc, s in scored if sc == scored[0][0]]
            if len(top) == 1:
                return StatementChoice(statement=top[0], create_period=None, options=[])
            return StatementChoice(statement=None, create_period=None, options=_options(top))

    # 3. El resumen cargado con el período del PDF.
    if parsed_year and parsed_month:
        same_period = next(
            (s for s in stmts if s.year == parsed_year and s.month == parsed_month), None
        )
        if same_period:
            return StatementChoice(statement=same_period, create_period=None, options=[])
        # 4. No existe: conciliar contra un resumen nuevo (todo saldrá faltante).
        return StatementChoice(
            statement=None, create_period=(parsed_year, parsed_month), options=[]
        )

    return StatementChoice(statement=None, create_period=None, options=_options(stmts))


def _options(stmts: list[CreditCardStatement]) -> list[dict]:
    return [
        {
            "statement_id": s.id,
            "year": s.year,
            "month": s.month,
            "closing_date": s.closing_date.isoformat() if s.closing_date else None,
            "due_date": s.due_date.isoformat() if s.due_date else None,
            "item_count": len(s.items),
        }
        for s in sorted(stmts, key=lambda s: (s.year, s.month), reverse=True)
    ]


async def is_latest_statement(db: AsyncSession, stmt: CreditCardStatement) -> bool:
    """¿Es el resumen más nuevo de la tarjeta? Gobierna la propagación de
    cuotas al crear faltantes: en un resumen viejo las cuotas siguientes ya
    pueden estar cargadas y propagar duplicaría el plan."""
    newer = await db.scalar(
        select(CreditCardStatement.id)
        .where(
            CreditCardStatement.card_id == stmt.card_id,
            (CreditCardStatement.year * 100 + CreditCardStatement.month)
            > stmt.year * 100 + stmt.month,
        )
        .limit(1)
    )
    return newer is None
