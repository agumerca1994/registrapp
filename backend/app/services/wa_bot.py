"""El bot de WhatsApp: una interfaz fina sobre los servicios de la app.

El router (`routers/whatsapp.py`) sólo autentica el webhook y normaliza el
payload de Evolution; todo lo que el bot *hace* está acá, llamando a los
mismos servicios que la pantalla y el MCP (`quick_capture`, `reconcile`) —
la arquitectura elegida: el canal traduce, el motor decide.

Contrato de `handle()`: escribe en la base y **commitea**, y devuelve los
textos de respuesta para que el router los mande DESPUÉS — un mensaje nunca
sale por algo que no quedó guardado (la regla de notificar tras el commit).

La memoria (`wa_messages`, 7 días) es lo que hace conversación a un canal
que no la tiene: *deshacer* y *editar* apuntan a la última entidad creada,
una respuesta "1"/"2" consume la pregunta `pending` más reciente, y citar un
mensaje viejo apunta a su entidad aunque ya no sea la última.
"""
from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.expense import EXPENSE_SOURCE_WHATSAPP, ExpenseCategory, ExpenseEntry
from app.models.reconciliation import ACTION_PROPOSED, ReconciliationAction
from app.models.user import User
from app.models.wa_message import WaMessage
from app.services import quick_capture, reconcile as reconcile_service
from app.services.category_suggest import invalidate as invalidate_suggest
from app.services.currency import get_or_create_usd_category
from app.services.reconcile.engine import record_event
from app.services.whatsapp import _money

logger = logging.getLogger(__name__)

MEMORY_DAYS = 7

MSG_NOT_LINKED = (
    "⚠️ Numero no vinculado.\n"
    "Vincula tu numero en RegistrApp (Configuracion > WhatsApp)."
)
MSG_ERROR = (
    "❌ Ocurrio un error al registrar el gasto.\n"
    "Intenta de nuevo mas tarde."
)
MSG_HELP = (
    "No te entendí 🤔\n\n"
    "Podés mandarme:\n"
    "• Un gasto: *12 lucas verdulería* · *15000 supermercado* · *usd 20 regalo ayer*\n"
    "• El *PDF del resumen* de tu tarjeta, y lo comparo con lo cargado\n"
    "• *deshacer* — borra lo último que cargué\n"
    "• *editar monto 13000* / *editar categoría súper*"
)
MSG_NEEDS_AI_MEDIA = (
    "Por ahora no puedo leer {what} por acá. Analizarlas con IA va a ser "
    "parte del plan Pro (próximamente) — respondé *me interesa* y te avisamos.\n"
    "Mientras tanto podés cargar el gasto como texto: *12 lucas verdulería*."
)

_EDIT_RE = re.compile(r"^editar\s+(monto|categor[ií]a|descripci[oó]n)\s+(.+)$", re.IGNORECASE)
_UNDO_RE = re.compile(r"^(deshacer|deshace|anular)\b", re.IGNORECASE)
_INTEREST_RE = re.compile(r"^me\s+interesa\b", re.IGNORECASE)
_NUMBER_RE = re.compile(r"^\s*([1-9])\s*$")


@dataclass
class InboundMessage:
    phone: str
    wa_id: str | None
    kind: str  # text | pdf | image | audio | other
    text: str = ""
    quoted_wa_id: str | None = None
    raw_message: dict = field(default_factory=dict)
    media_key: dict = field(default_factory=dict)


def parse_evolution_payload(payload: dict) -> InboundMessage | None:
    """Payload de Evolution (messages.upsert) → mensaje normalizado.
    None = no es algo que el bot atienda (propio, de grupo, vacío)."""
    data = payload.get("data") or {}
    key = data.get("key") or {}
    if key.get("fromMe"):
        return None
    remote_jid = key.get("remoteJid", "") or ""
    if "@g.us" in remote_jid:
        return None
    phone = remote_jid.replace("@s.whatsapp.net", "").strip()
    if not phone:
        return None

    message = data.get("message") or {}
    # Algunas versiones envuelven el documento con caption en otro nivel.
    doc = message.get("documentMessage") or (
        (message.get("documentWithCaptionMessage") or {}).get("message") or {}
    ).get("documentMessage")

    kind = "other"
    text = ""
    if doc is not None:
        kind = "pdf" if "pdf" in (doc.get("mimetype") or "").lower() else "other"
    elif "imageMessage" in message:
        kind = "image"
    elif "audioMessage" in message or "pttMessage" in message:
        kind = "audio"
    else:
        text = (
            message.get("conversation")
            or (message.get("extendedTextMessage") or {}).get("text")
            or ""
        ).strip()
        if text:
            kind = "text"

    quoted = (
        (message.get("extendedTextMessage") or {}).get("contextInfo") or {}
    ).get("stanzaId")

    if kind == "other" and not text:
        return None

    return InboundMessage(
        phone=phone,
        wa_id=key.get("id"),
        kind=kind,
        text=text,
        quoted_wa_id=quoted,
        raw_message=message,
        media_key={k: v for k, v in key.items() if k in ("id", "remoteJid", "fromMe")},
    )


# ---------------------------------------------------------------- memoria ---

async def already_seen(db: AsyncSession, user_id: int, wa_id: str | None) -> bool:
    if not wa_id:
        return False
    row = await db.scalar(
        select(WaMessage.id).where(
            WaMessage.user_id == user_id, WaMessage.wa_message_id == wa_id
        ).limit(1)
    )
    return row is not None


def _remember(
    db: AsyncSession, user_id: int, direction: str, kind: str,
    *, wa_id: str | None = None, text: str | None = None,
    ref_type: str | None = None, ref_id: int | None = None,
    pending: dict | None = None,
) -> WaMessage:
    row = WaMessage(
        user_id=user_id, direction=direction, wa_message_id=wa_id, kind=kind,
        text=(text or "")[:500] or None, ref_type=ref_type, ref_id=ref_id,
        pending=pending,
    )
    db.add(row)
    return row


def _cutoff() -> datetime:
    return datetime.now() - timedelta(days=MEMORY_DAYS)


async def _last_ref(
    db: AsyncSession, user_id: int, ref_type: str, quoted_wa_id: str | None = None
) -> WaMessage | None:
    """La entidad a la que apunta un comando: la del mensaje citado si lo hay,
    si no la última creada dentro de la memoria."""
    q = select(WaMessage).where(
        WaMessage.user_id == user_id,
        WaMessage.ref_type == ref_type,
        WaMessage.created_at >= _cutoff(),
    )
    if quoted_wa_id:
        quoted = await db.scalar(
            select(WaMessage).where(
                WaMessage.user_id == user_id,
                WaMessage.wa_message_id == quoted_wa_id,
            )
        )
        if quoted and quoted.ref_type == ref_type:
            return quoted
    return await db.scalar(q.order_by(WaMessage.id.desc()).limit(1))


async def _open_pending(db: AsyncSession, user_id: int) -> WaMessage | None:
    return await db.scalar(
        select(WaMessage).where(
            WaMessage.user_id == user_id,
            WaMessage.pending.is_not(None),
            WaMessage.created_at >= _cutoff(),
        ).order_by(WaMessage.id.desc()).limit(1)
    )


async def purge_old_messages(db: AsyncSession) -> int:
    """Borra la memoria con más de 7 días. Lo llama el job diario."""
    rows = (await db.scalars(
        select(WaMessage).where(WaMessage.created_at < _cutoff())
    )).all()
    for r in rows:
        await db.delete(r)
    await db.commit()
    return len(rows)


# ------------------------------------------------------------------- flujo --

async def handle(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    """Procesa un mensaje entrante. Commitea; devuelve las respuestas."""
    try:
        if inbound.kind == "pdf":
            return await _handle_pdf(db, user, inbound)
        if inbound.kind in ("image", "audio"):
            return await _handle_unsupported_media(db, user, inbound)
        return await _handle_text(db, user, inbound)
    except Exception:
        logger.exception("WA bot error (user %s)", user.id)
        await db.rollback()
        return [MSG_ERROR]


async def _conciliar_link(db: AsyncSession, user, session_id: int) -> str:
    """El link lleva un token de auto-login de un solo uso: se abre donde se
    abra (incluido el navegador interno de WhatsApp) ya con sesión. Ver
    services/auth_links.py por el modelo de confianza."""
    from app.services import auth_links

    token = await auth_links.mint_token(db, user.id)
    return f"{settings.FRONTEND_URL}/conciliar/{session_id}?wat={token}"


# WhatsApp abre los links en su navegador interno, que no comparte sesión con
# la PWA ni con el navegador real — y ahí el login de Google no funciona. La
# pantalla de login avisa, pero avisarlo acá ahorra el viaje fallido.
LINK_HINT = "💡 Si te pide iniciar sesión, abrí el link con el menú → *Abrir en el navegador*."


def _fmt_total(totals: dict | None, cur: str, key: str) -> str:
    raw = ((totals or {}).get(cur) or {}).get(key)
    return _money(f"{Decimal(raw):,.2f}".replace(",", "@").replace(".", ",").replace("@", "."), cur) if raw else "-"


async def _handle_pdf(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    from app.services.whatsapp import download_media_base64

    pdf = await download_media_base64(inbound.media_key, inbound.raw_message)
    if pdf is None:
        _remember(db, user.id, "in", "pdf", wa_id=inbound.wa_id)
        await db.commit()
        return ["No pude descargar el PDF 😕 Probá mandarlo de nuevo."]

    # Un PDF puede ser el resumen de la tarjeta (→ conciliación) o el
    # comprobante de UNA transferencia/pago (→ gasto directo, preguntando la
    # categoría si hace falta). Lo decide el texto: si ningún parser de
    # resúmenes lo reconoce, se prueba como comprobante antes de rendirse.
    from app.services.statement_parsers import REGISTRY
    from app.services.statement_parsers.common import extract_pages_text, pages_to_lines
    from app.services.transfer_receipt import parse_transfer_receipt

    try:
        pages = extract_pages_text(pdf)
        pdf_lines = pages_to_lines(pages)
    except Exception:
        pages, pdf_lines = [], []

    if pdf_lines and not any(m.detect(pdf_lines) for m in REGISTRY):
        receipt = parse_transfer_receipt(pages)
        if receipt is None:
            # WARNING a propósito: llega a app_logs (que sólo guarda WARNING+)
            # y dice por qué no matcheó — sin este rastro, "me ofreció el plan"
            # no se puede distinguir de un deploy que no llegó.
            from app.services.transfer_receipt import diagnose

            logger.warning("WA receipt sin match: %s", diagnose(pages))
        if receipt is not None:
            await record_event(
                db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
                input_kind="pdf", outcome="parsed_code", bank_detected="transferencia",
            )
            draft = quick_capture.QuickDraft(
                amount=receipt.amount,
                currency=receipt.currency,
                expense_date=receipt.receipt_date or datetime.now().date(),
                term=receipt.counterparty or "Transferencia",
                legacy=False,
            )
            return await _capture_draft(
                db, user, inbound, draft,
                payment_method="transferencia" if receipt.kind == "transferencia" else None,
            )

    _remember(db, user.id, "in", "pdf", wa_id=inbound.wa_id)
    session = await reconcile_service.start_session(
        db, user=user, pdf_bytes=pdf, channel="whatsapp"
    )

    if session.status == "needs_ai":
        reply = {
            "no_parser": "Todavía no sé leer los resúmenes de este banco automáticamente.",
            "totals_mismatch": "Leí el resumen pero las sumas no coinciden con los totales del banco, así que no propongo cambios.",
            "encrypted": "El PDF tiene contraseña. Descargalo sin contraseña y volvé a mandarlo.",
            "no_text": "No pude extraer texto del archivo.",
        }.get(session.reason or "", "No pude leer el resumen.")
        reply += (
            "\n\nAnalizarlo con IA va a ser parte del plan Pro (próximamente) — "
            "respondé *me interesa* y te avisamos."
        )
        _remember(db, user.id, "out", "text", text=reply, ref_type="reconcile",
                  ref_id=session.id, pending={"type": "interest", "session_id": session.id})
        await db.commit()
        return [reply]

    if session.status == "needs_choice":
        # Elegir tarjeta o período por chat es incómodo; el link resuelve.
        reply = (
            "Leí el resumen pero necesito que elijas "
            + ("la tarjeta" if session.reason == "card_ambiguous" else "el período")
            + f" en la app:\n{await _conciliar_link(db, user, session.id)}\n{LINK_HINT}"
        )
        _remember(db, user.id, "out", "text", text=reply, ref_type="reconcile", ref_id=session.id)
        await db.commit()
        return [reply]

    # ready / unexplained: el veredicto con números, los grupos y la pregunta.
    groups = await _pending_group_counts(db, session.id)
    parsed_total = _fmt_total(session.totals, "ARS", "bank_total")
    app_total = _fmt_total(session.totals, "ARS", "app_total")
    diff = _fmt_total(session.totals, "ARS", "difference")
    lines = [
        f"📄 Resumen {session.parsed.get('bank') or ''} {session.period_month:02d}/{session.period_year}".rstrip(),
        f"Banco {parsed_total} · RegistrApp {app_total} · diferencia {diff}",
    ]
    if (session.totals or {}).get("USD"):
        lines.append(
            f"En USD: banco {_fmt_total(session.totals,'USD','bank_total')} · "
            f"RegistrApp {_fmt_total(session.totals,'USD','app_total')}"
        )
    if session.status == "unexplained":
        lines.append("⚠️ La diferencia no queda explicada al centavo — mejor revisalo en la app.")
    label_map = {
        "dates": "fechas del resumen", "missing": "faltantes",
        "double_count": "sumados dos veces", "amount_diff": "montos distintos",
        "usd_fix": "USD mal identificados", "rounding": "redondeos", "surplus": "sobrantes",
    }
    if groups:
        detail = " · ".join(f"{n} {label_map.get(k, k)}" for k, n in groups.items())
        lines.append(f"Diferencias: {detail}")
        lines.append("")
        lines.append("1️⃣ Aplicar todo (lo que tenga categoría)\n2️⃣ Nada, lo reviso en la app")
        pending = {"type": "reconcile_apply", "session_id": session.id}
    else:
        lines.append("✅ Todo coincide — no hay nada para corregir.")
        pending = None
    lines.append(f"Verlo completo: {await _conciliar_link(db, user, session.id)}")
    lines.append(LINK_HINT)

    reply = "\n".join(lines)
    _remember(db, user.id, "out", "text", text=reply, ref_type="reconcile",
              ref_id=session.id, pending=pending)
    await db.commit()
    return [reply]


async def _pending_group_counts(db: AsyncSession, session_id: int) -> dict[str, int]:
    rows = (await db.scalars(
        select(ReconciliationAction).where(
            ReconciliationAction.session_id == session_id,
            ReconciliationAction.status == ACTION_PROPOSED,
        )
    )).all()
    counts: dict[str, int] = {}
    for a in rows:
        counts[a.klass] = counts.get(a.klass, 0) + 1
    return {k: counts[k] for k in reconcile_service.GROUP_ORDER if k in counts}


async def _handle_unsupported_media(
    db: AsyncSession, user: User, inbound: InboundMessage
) -> list[str]:
    what = "imágenes" if inbound.kind == "image" else "audios"
    await record_event(
        db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
        input_kind=inbound.kind, outcome="needs_ai", reason=inbound.kind,
    )
    reply = MSG_NEEDS_AI_MEDIA.format(what=what)
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id)
    _remember(db, user.id, "out", "text", text=reply, pending={"type": "interest"})
    await db.commit()
    return [reply]


async def _handle_text(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    text = inbound.text.strip()

    if _UNDO_RE.match(text):
        return await _do_undo(db, user, inbound)
    edit = _EDIT_RE.match(text)
    if edit:
        return await _do_edit(db, user, inbound, edit.group(1).lower(), edit.group(2).strip())
    if _INTEREST_RE.match(text):
        return await _do_interest(db, user, inbound)
    num = _NUMBER_RE.match(text)
    if num:
        handled = await _do_pending_answer(db, user, inbound, int(num.group(1)))
        if handled is not None:
            return handled

    handled = await _do_pending_category_by_name(db, user, inbound)
    if handled is not None:
        return handled

    return await _do_expense(db, user, inbound)


async def _do_pending_category_by_name(
    db: AsyncSession, user: User, inbound: InboundMessage
) -> list[str] | None:
    """La pregunta de categoría también acepta el nombre escrito ("súper").
    Sólo consume el texto si coincide con una categoría existente — cualquier
    otra cosa sigue su camino normal (puede ser un gasto nuevo)."""
    row = await _open_pending(db, user.id)
    if row is None:
        return None
    pending = row.pending or {}
    if pending.get("type") not in ("category_pick", "category_name"):
        return None

    from app.services.search import fold_text

    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )).all()
    cat = next((c for c in cats if fold_text(c.name) == fold_text(inbound.text)), None)
    if cat is None:
        return None

    draft = _draft_from_dict(pending["draft"])
    entry = await quick_capture.create_quick_expense(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft, category_id=cat.id,
        payment_method=(pending["draft"] or {}).get("pm"),
    )
    row.pending = None
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text,
              ref_type="expense", ref_id=entry.id)
    await db.commit()
    return [
        f"✅ {_fmt_amount(draft)} · {entry.description} — {cat.name}\n"
        "Respondé *deshacer* o *editar monto …*"
    ]


async def _do_expense(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    draft = quick_capture.parse_quick_text(inbound.text)
    if draft is None:
        await record_event(
            db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
            input_kind="text", outcome="needs_ai", reason="unparseable_text",
        )
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return [MSG_HELP]

    return await _capture_draft(db, user, inbound, draft)


async def _capture_draft(
    db: AsyncSession,
    user: User,
    inbound: InboundMessage,
    draft: quick_capture.QuickDraft,
    payment_method: str | None = None,
) -> list[str]:
    """La mitad común de capturar un gasto (texto libre o comprobante):
    resolver categoría, preguntar si hace falta, guardar y responder."""
    # En USD la categoría es siempre "Consumo en dólares" (regla del dominio).
    if draft.currency == "USD":
        category_id = await get_or_create_usd_category(user.tenant_id, db)
        pick = quick_capture.CategoryPick(category_id, "Consumo en dólares", "exact", None, [])
    else:
        pick = await quick_capture.resolve_category(
            db, user.tenant_id, draft.term, allow_create=draft.legacy
        )
        if pick.source == "created":
            # Contrato histórico del bot: `monto categoria` crea la categoría.
            import random

            cat = ExpenseCategory(
                tenant_id=user.tenant_id, name=draft.term,
                color=random.choice(quick_capture.CATEGORY_COLORS), is_fixed=False,
            )
            db.add(cat)
            await db.flush()
            pick = quick_capture.CategoryPick(cat.id, cat.name, "created", None, [])

    if pick.category_id is None:
        options = pick.options
        if not options:
            reply = "No encontré una categoría para eso. Decime el nombre de la categoría."
            pending = {"type": "category_name", "draft": _draft_dict(draft, payment_method)}
        else:
            listed = "\n".join(f"{i+1}️⃣ {name}" for i, name in enumerate(options))
            reply = (
                f"¿En qué categoría va *{draft.term}* ({_fmt_amount(draft)})?\n{listed}\n"
                "Respondé el número, o el nombre de otra categoría."
            )
            pending = {"type": "category_pick", "draft": _draft_dict(draft, payment_method), "options": options}
        _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
        _remember(db, user.id, "out", "text", text=reply, pending=pending)
        await db.commit()
        return [reply]

    entry = await quick_capture.create_quick_expense(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft,
        category_id=pick.category_id, description=pick.description,
        payment_method=payment_method,
    )
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None,
              ref_type="expense", ref_id=entry.id)
    await db.commit()

    suffix = " (sugerida)" if pick.source == "suggest" else ""
    when = "" if entry.expense_date == datetime.now().date() else f" · {entry.expense_date.strftime('%d/%m')}"
    return [
        f"✅ {_fmt_amount(draft)} · {entry.description} — {pick.category_name}{suffix}{when}\n"
        "Respondé *deshacer*, o *editar monto/categoría/descripción …*"
    ]


def _draft_dict(draft: quick_capture.QuickDraft, payment_method: str | None = None) -> dict:
    return {
        "amount": str(draft.amount), "currency": draft.currency,
        "date": draft.expense_date.isoformat(), "term": draft.term,
        "pm": payment_method,
    }


def _draft_from_dict(d: dict) -> quick_capture.QuickDraft:
    from datetime import date as _date

    return quick_capture.QuickDraft(
        amount=Decimal(d["amount"]), currency=d["currency"],
        expense_date=_date.fromisoformat(d["date"]), term=d["term"], legacy=False,
    )


def _fmt_amount(draft) -> str:
    formatted = f"{draft.amount:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return _money(formatted, draft.currency)


async def _do_undo(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    ref = await _last_ref(db, user.id, "expense", inbound.quoted_wa_id)
    if ref is None:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["No tengo nada para deshacer en los últimos 7 días."]
    entry = await db.get(ExpenseEntry, ref.ref_id)
    if entry is None or entry.tenant_id != user.tenant_id or entry.source != EXPENSE_SOURCE_WHATSAPP:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Ese gasto ya no está (o no lo creé yo)."]
    desc, amount, currency = entry.description, entry.amount, entry.currency
    await db.delete(entry)
    ref.ref_type = None
    ref.ref_id = None
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    invalidate_suggest(user.tenant_id)
    formatted = f"{amount:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return [f"🗑️ Deshecho: {_money(formatted, currency)} · {desc}"]


async def _do_edit(
    db: AsyncSession, user: User, inbound: InboundMessage, field_name: str, value: str
) -> list[str]:
    ref = await _last_ref(db, user.id, "expense", inbound.quoted_wa_id)
    entry = await db.get(ExpenseEntry, ref.ref_id) if ref else None
    if entry is None or entry.tenant_id != user.tenant_id or entry.source != EXPENSE_SOURCE_WHATSAPP:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["No tengo un gasto reciente para editar."]

    if field_name.startswith("descripci"):
        entry.description = value[:255]
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        formatted = f"{entry.amount:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
        return [f"✏️ Listo: {_money(formatted, entry.currency)} · {entry.description}"]

    if field_name == "monto":
        amount = quick_capture._parse_number(value.replace("$", "").strip())
        if amount is None:
            m = quick_capture._AMOUNT_RE.search(value)
            if m:
                amount = quick_capture._parse_number(m.group(1))
                mult = quick_capture._MULTIPLIER.get((m.group(2) or "").lower())
                if amount is not None and mult:
                    amount = amount * mult
        if amount is None:
            await db.commit()
            return ["No entendí el monto. Probá: *editar monto 13000*"]
        entry.amount = amount
    else:
        cats = (await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
        )).all()
        from app.services.search import fold_text

        cat = next((c for c in cats if fold_text(c.name) == fold_text(value)), None)
        if cat is None:
            names = ", ".join(sorted(c.name for c in cats)[:12])
            await db.commit()
            return [f"No hay una categoría «{value}». Tenés: {names}"]
        entry.category_id = cat.id

    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    invalidate_suggest(user.tenant_id)
    formatted = f"{entry.amount:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return [f"✏️ Listo: {_money(formatted, entry.currency)} · {entry.description}"]


async def _do_interest(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    pending_row = await _open_pending(db, user.id)
    reason = None
    if pending_row and (pending_row.pending or {}).get("type") == "interest":
        pending_row.pending = None
    await record_event(
        db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
        input_kind="text", outcome="interest", reason=reason,
    )
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    return ["¡Anotado! Te avisamos cuando el análisis con IA esté disponible 🙌"]


async def _do_pending_answer(
    db: AsyncSession, user: User, inbound: InboundMessage, number: int
) -> list[str] | None:
    """Respuesta "1".."9" a la última pregunta abierta. None = no había
    pregunta (el número se intenta como gasto, p. ej. "5000 kiosco")."""
    row = await _open_pending(db, user.id)
    if row is None:
        return None
    pending = row.pending or {}
    ptype = pending.get("type")

    if ptype == "category_pick":
        options = pending.get("options") or []
        if not (1 <= number <= len(options)):
            return [f"Respondé un número del 1 al {len(options)}, o el nombre de la categoría."]
        name = options[number - 1]
        cats = (await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
        )).all()
        from app.services.search import fold_text

        cat = next((c for c in cats if fold_text(c.name) == fold_text(name)), None)
        if cat is None:
            return ["Esa categoría ya no existe — probá de nuevo."]
        draft = _draft_from_dict(pending["draft"])
        entry = await quick_capture.create_quick_expense(
            db, tenant_id=user.tenant_id, user_id=user.id, draft=draft, category_id=cat.id,
            payment_method=(pending["draft"] or {}).get("pm"),
        )
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text,
                  ref_type="expense", ref_id=entry.id)
        await db.commit()
        return [
            f"✅ {_fmt_amount(draft)} · {entry.description} — {cat.name}\n"
            "Respondé *deshacer* o *editar monto …*"
        ]

    if ptype == "reconcile_apply":
        session_id = pending.get("session_id")
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        if number == 2:
            await db.commit()
            return [f"Dale — cuando quieras: {await _conciliar_link(db, user, session_id)}"]
        if number != 1:
            await db.commit()
            return ["Respondé *1* para aplicar o *2* para verlo en la app."]
        return await _apply_all_groups(db, user, session_id)

    return None


async def _apply_all_groups(db: AsyncSession, user: User, session_id: int) -> list[str]:
    from app.models.reconciliation import ReconciliationSession

    session = await db.get(ReconciliationSession, session_id)
    if session is None or session.tenant_id != user.tenant_id:
        await db.commit()
        return ["No encontré esa conciliación."]

    label_map = {
        "dates": "fechas completadas", "missing": "cargados",
        "double_count": "montos sumados corregidos", "amount_diff": "montos corregidos",
        "usd_fix": "USD corregidos", "rounding": "redondeos corregidos",
        "surplus": "sobrantes borrados",
    }
    applied_by_klass: dict[str, int] = {}
    skipped_total = 0
    for klass in reconcile_service.GROUP_ORDER:
        counts = await _pending_group_counts(db, session.id)
        if klass not in counts:
            continue
        result = await reconcile_service.apply_group(db, session, user, klass)
        if result["applied"]:
            applied_by_klass[klass] = result["applied"]
        skipped_total += len(result["skipped"])
    await db.commit()

    # El mensaje de cierre del doc: qué se hizo, qué queda, y si terminó.
    applied_total = sum(applied_by_klass.values())
    if applied_total:
        detail = " · ".join(f"{n} {label_map.get(k, k)}" for k, n in applied_by_klass.items())
        lines = [f"✅ Listo: {detail}."]
    else:
        lines = ["No había nada aplicable todavía."]
    if session.status == "closed":
        lines.append("🏁 *Conciliación finalizada*: el resumen quedó igual al del banco.")
        lines.append(f"Detalle: {await _conciliar_link(db, user, session_id)}")
    elif skipped_total:
        lines.append(
            f"Quedaron {skipped_total} sin aplicar (les falta elegir categoría): "
            f"{await _conciliar_link(db, user, session_id)}"
        )
    else:
        remaining = await _pending_group_counts(db, session.id)
        if remaining:
            det = " · ".join(f"{n} {k}" for k, n in remaining.items())
            lines.append(f"Pendiente: {det} — {await _conciliar_link(db, user, session_id)}")
        else:
            lines.append(f"Detalle: {await _conciliar_link(db, user, session_id)}")
    await db.commit()
    return ["\n".join(lines)]
