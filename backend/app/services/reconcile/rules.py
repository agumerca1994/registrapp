"""Reglas de captura por hogar (`capture_rules`).

Cada hogar carga distinto, así que lo aprendido se guarda como reglas que el
matching aplica antes de preguntar. Tres tipos:

- `statement_card`: (banco + producto del resumen) → tarjeta de la app. El
  mapeo es del documento entero, no por titular: el caso real carga todos los
  bloques del PDF consolidado en una sola tarjeta.
- `merchant_category`: comercio normalizado → categoría (y descripción
  opcional). Es una **sugerencia** y siempre se muestra antes de aplicarse —
  el mismo comercio puede ir a categorías distintas según el contexto.
- `exclude`: comercios/cargos del banco que este hogar no registra. Se
  informan como excluidos, nunca como faltantes.

La clave (`match`) se normaliza con los tokens de `category_suggest.normalize`
ordenados: así "MERPAGO*EBANXSA C.02/06" y "Merpago*Ebanxsa" caen en la misma
regla sin importar tildes, mayúsculas ni marcadores de cuota.
"""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.reconciliation import CaptureRule
from app.services.category_suggest import normalize
from app.services.search import fold_text

KIND_STATEMENT_CARD = "statement_card"
KIND_MERCHANT_CATEGORY = "merchant_category"
KIND_EXCLUDE = "exclude"


def card_rule_key(bank: str | None, card_label: str | None) -> str:
    return f"{fold_text(bank or '')}|{fold_text(card_label or '')}"


def merchant_key(description: str) -> str:
    tokens = normalize(description)
    if not tokens:
        return fold_text(description)[:255]
    return " ".join(sorted(tokens))[:255]


async def get_rules(db: AsyncSession, tenant_id: int, kind: str) -> dict[str, dict]:
    rows = await db.scalars(
        select(CaptureRule).where(CaptureRule.tenant_id == tenant_id, CaptureRule.kind == kind)
    )
    return {r.match: (r.payload or {}) for r in rows.all()}


async def save_rule(
    db: AsyncSession, tenant_id: int, kind: str, match: str, payload: dict
) -> None:
    """Upsert por (tenant, kind, match). Sólo flush — el commit es del caller."""
    existing = await db.scalar(
        select(CaptureRule).where(
            CaptureRule.tenant_id == tenant_id,
            CaptureRule.kind == kind,
            CaptureRule.match == match,
        )
    )
    if existing:
        existing.payload = payload
    else:
        db.add(CaptureRule(tenant_id=tenant_id, kind=kind, match=match, payload=payload))
    await db.flush()
