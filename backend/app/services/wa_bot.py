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
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.expense import EXPENSE_SOURCE_WHATSAPP, ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource
from app.models.reconciliation import ACTION_PROPOSED, ReconciliationAction
from app.models.tenant import TENANT_KIND_BUSINESS, Tenant
from app.models.user import User
from app.models.wa_message import WaMessage
from app.services import ai_capture, expenses as expenses_service, income_capture, quick_capture, reconcile as reconcile_service
from app.services.business import capture as business_capture
from app.services.category_suggest import invalidate as invalidate_suggest
from app.services.clock import ar_today
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
    "• Un ingreso: *cobré 850 lucas sueldo* · *me transfirieron 30 lucas alquiler* · *cobré usd 500 freelance*\n"
    "• El *PDF del resumen* de tu tarjeta, y dejo tus datos al día\n"
    "• El *PDF de un comprobante* de pago o transferencia\n"
    "• *deshacer* — borra lo último que cargué\n"
    "• *editar monto / categoría / descripción …*"
)


def _help_text() -> str:
    """Con la IA prendida, el bot también lee fotos y capturas: la ayuda lo dice."""
    if not ai_capture.enabled():
        return MSG_HELP
    return MSG_HELP.replace(
        "• El *PDF de un comprobante* de pago o transferencia",
        "• Un *comprobante* de pago o transferencia: foto, captura o PDF",
    )


# Una imagen casi siempre es un comprobante compartido como captura: muchas
# apps (Mercado Pago, los bancos) comparten la imagen por default. El PDF sí
# se lee en código, así que lo primero que dice el mensaje es cómo mandarlo —
# un aviso que sólo ofrece el plan Pro deja al usuario sin salida (caso real:
# una transferencia enviada como captura terminó en "pasate de plan").
MSG_NEEDS_AI_IMAGE = (
    "📷 Me llegó una *imagen*, y por ahora sólo puedo leer comprobantes en *PDF*.\n\n"
    "En la app de tu banco o billetera buscá *Compartir comprobante* → *PDF* "
    "(o *Descargar PDF*) y mandámelo de nuevo. También podés escribirlo: "
    "*15000 transferencia juan*.\n\n"
    "Leer imágenes con IA va a ser parte del plan Pro (próximamente) — "
    "respondé *me interesa* y te avisamos."
)
MSG_NEEDS_AI_AUDIO = (
    "🎙️ Por ahora no puedo escuchar audios. Escribime el gasto como te salga: "
    "*12 lucas verdulería*.\n\n"
    "Entender audios con IA va a ser parte del plan Pro (próximamente) — "
    "respondé *me interesa* y te avisamos."
)

# Lo que escribe un NEGOCIO: ventas, cierres, producción, conteos, compras con
# cantidad. Lo lee `business/capture.py` y lo ejecuta `business/bot.py`, ANTES
# que el gasto genérico — cuyo monto es el primer número del texto, así que
# "vendí 20 porciones" quedaba como un gasto de $20 y "compré 12 coca a 18
# lucas" como uno de $12. Esta expresión reconoce lo que *parece* de negocio
# aunque no se haya podido leer: eso recibe la ayuda del negocio y nunca cae
# al gasto. En un hogar el bot no cambia.
_MONEY_WORD = r"(?!lucas?\b|k\b|palos?\b|mil\b|pesos\b|usd\b|u\$[sd]\b|d[oó]lar(?:es)?\b|verdes\b)"
_BUSINESS_TEXT_RE = re.compile(
    r"^(vend[ií]|vendimos|ventas?|cierre|cerr[eé]|cerramos|hice|hicimos|produj[eé]|produjimos|quedan?|stock)\b"
    # "compré 12 coca …": una cantidad, no un monto ("compré 12 lucas de verdura" sigue siendo gasto)
    rf"|^compr[eé]\s+\d+\s+{_MONEY_WORD}[a-záéíóúñ]"
    # "12 coca 18000" / "3 empanadas 4 lucas": cantidad chica + producto + precio
    rf"|^\d{{1,3}}\s+{_MONEY_WORD}[a-záéíóúñ]+.*?(?:\d{{3,}}|\d+\s*(?:lucas?|k|palos?)\b)",
    re.IGNORECASE,
)
# Un empleado de un negocio carga ventas, el cierre y el stock; los gastos,
# las compras y los resúmenes son de los dueños: el bot no se los toma.
MSG_EMPLOYEE_ONLY = (
    "Como empleado podés cargar por acá las ventas, el cierre del día y el stock: "
    "*vendí 3 empanadas 4500 efectivo* · *cierre 200 lucas efectivo, 150 mp* · "
    "*hice 30 empanadas* · *quedan 5 coca*.\n"
    "Los gastos, las compras y los resúmenes los carga el dueño o un socio."
)


def _is_employee(user) -> bool:
    role = getattr(user, "role", None)
    return getattr(role, "value", role) == "employee"


MSG_BUSINESS_HELP = (
    "No te entendí 🤔\n\n"
    "Para el negocio podés mandarme:\n"
    "• Una venta: *vendí 3 empanadas y 1 coca 6500 efectivo*\n"
    "• El cierre del día: *cierre 200 lucas efectivo, 150 mp*\n"
    "• Producción y conteos: *hice 30 empanadas* · *quedan 5 coca*\n"
    "• Cuánto hay: *stock coca*\n"
    "• Una compra o un pago: *compré 12 coca a 18 lucas* · *pagué 80 lucas a juan*\n"
    "• Un gasto: *45 lucas alquiler*\n"
    "• *deshacer* — borra lo último que cargué"
)

_EDIT_RE = re.compile(r"^editar\s+(monto|categor[ií]a|descripci[oó]n|fuente)\s+(.+)$", re.IGNORECASE)
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
        if kind == "pdf":
            text = (doc.get("caption") or "").strip()
    elif "imageMessage" in message:
        kind = "image"
        # El texto que acompaña la foto ("almuerzo con clientes") le sirve a
        # la lectura con IA para elegir la categoría.
        text = (message["imageMessage"].get("caption") or "").strip()
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
    db: AsyncSession, user_id: int, ref_type: str | tuple[str, ...], quoted_wa_id: str | None = None
) -> WaMessage | None:
    """La entidad a la que apunta un comando: la del mensaje citado si lo hay,
    si no la última creada dentro de la memoria (de cualquiera de los tipos)."""
    types = (ref_type,) if isinstance(ref_type, str) else tuple(ref_type)
    q = select(WaMessage).where(
        WaMessage.user_id == user_id,
        WaMessage.ref_type.in_(types),
        WaMessage.created_at >= _cutoff(),
    )
    if quoted_wa_id:
        quoted = await db.scalar(
            select(WaMessage).where(
                WaMessage.user_id == user_id,
                WaMessage.wa_message_id == quoted_wa_id,
            )
        )
        if quoted and quoted.ref_type in types:
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
        if _is_employee(user) and inbound.kind != "text":
            # Un PDF es un resumen o un comprobante de pago: cosa de los dueños.
            _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id)
            _remember(db, user.id, "out", "text", text=MSG_EMPLOYEE_ONLY)
            await db.commit()
            return [MSG_EMPLOYEE_ONLY]
        if inbound.kind == "pdf":
            return await _handle_pdf(db, user, inbound)
        if inbound.kind == "image" and ai_capture.enabled():
            return await _handle_image(db, user, inbound)
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


MSG_PDF_PASSWORD = (
    "🔒 El PDF tiene contraseña. Mandame la contraseña en un mensaje y lo abro "
    "(en los resúmenes del banco suele ser tu DNI, sin puntos). No la guardo."
)
PDF_PASSWORD_TRIES = 3
PDF_PASSWORD_MINUTES = 30


def _strip_thumbnails(node):
    """El mensaje crudo viaja en `pending` para volver a bajar el PDF cuando
    llegue la contraseña; la miniatura (base64) no hace falta y pesa."""
    if isinstance(node, dict):
        return {k: _strip_thumbnails(v) for k, v in node.items() if k != "jpegThumbnail"}
    return node


async def _handle_pdf(
    db: AsyncSession, user: User, inbound: InboundMessage, pdf: bytes | None = None
) -> list[str]:
    from app.services import pdf_unlock
    from app.services.whatsapp import download_media_base64

    if pdf is None:
        pdf = await download_media_base64(inbound.media_key, inbound.raw_message)
    if pdf is None:
        _remember(db, user.id, "in", "pdf", wa_id=inbound.wa_id)
        await db.commit()
        return ["No pude descargar el PDF 😕 Probá mandarlo de nuevo."]

    if pdf_unlock.needs_password(pdf):
        # Ni los parsers ni la IA leen un PDF protegido (la API lo rechaza con
        # un 400). Se pide la contraseña y la respuesta lo vuelve a bajar: el
        # PDF no se guarda, sólo cómo pedírselo de nuevo a Evolution.
        _remember(db, user.id, "in", "pdf", wa_id=inbound.wa_id)
        _remember(db, user.id, "out", "text", text=MSG_PDF_PASSWORD, pending={
            "type": "pdf_password", "tries": 0,
            "media_key": inbound.media_key,
            "raw_message": _strip_thumbnails(inbound.raw_message),
        })
        await db.commit()
        return [MSG_PDF_PASSWORD]

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

    is_statement = bool(pdf_lines) and any(m.detect(pdf_lines) for m in REGISTRY)
    if pdf_lines and not is_statement:
        receipt = parse_transfer_receipt(pages)
        if receipt is None:
            # WARNING a propósito: llega a app_logs (que sólo guarda WARNING+)
            # y dice por qué no matcheó — sin este rastro, "me ofreció el plan"
            # no se puede distinguir de un deploy que no llegó.
            from app.services.transfer_receipt import diagnose

            logger.warning("WA receipt sin match: %s", diagnose(pages))
        if receipt is not None and receipt.direction == "in":
            # Plata que entró: guardarla como gasto descuadraba el mes dos
            # veces (un ingreso que falta y un egreso que sobra). En un hogar
            # es un ingreso; en un negocio, sus ingresos son las ventas.
            await record_event(
                db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
                input_kind="pdf", outcome="parsed_code", bank_detected="transferencia_recibida",
            )
            if not await _is_business(db, user):
                return await _capture_incoming(
                    db, user, inbound, receipt.amount, receipt.currency,
                    receipt.receipt_date, receipt.counterparty,
                )
            who = f" de {receipt.counterparty}" if receipt.counterparty else ""
            reply = (
                f"📥 Es el comprobante de una transferencia que *recibiste* "
                f"({_fmt_amount(receipt)}{who}). No lo cargo como gasto: "
                "acá sólo registro lo que pagaste."
            )
            _remember(db, user.id, "in", "pdf", wa_id=inbound.wa_id)
            _remember(db, user.id, "out", "text", text=reply)
            await db.commit()
            return [reply]
        if receipt is not None:
            await record_event(
                db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
                input_kind="pdf", outcome="parsed_code", bank_detected="transferencia",
            )
            draft = quick_capture.QuickDraft(
                amount=receipt.amount,
                currency=receipt.currency,
                expense_date=receipt.receipt_date or ar_today(),
                term=receipt.counterparty or "Transferencia",
                legacy=False,
            )
            return await _capture_draft(
                db, user, inbound, draft,
                payment_method="transferencia" if receipt.kind == "transferencia" else None,
            )

    # Ni resumen conocido ni comprobante que el código lea (o un PDF escaneado,
    # sin texto): lo lee la IA. Si resulta ser un resumen, o la IA no pudo,
    # sigue a la conciliación, que explica el motivo como siempre.
    if not is_statement and ai_capture.enabled():
        inbound = await _claim_inbound(db, user, inbound)
        handled = await _read_with_ai(db, user, inbound, pdf)
        if handled is not None:
            return handled

    # La sesión puede llamar a la IA (categorías de los faltantes), que tarda:
    # el mensaje se registra antes, así un reintento del webhook no arma otra.
    inbound = await _claim_inbound(db, user, inbound)
    session = await reconcile_service.start_session(
        db, user=user, pdf_bytes=pdf, channel="whatsapp"
    )

    if session.status == "needs_ai":
        reply = {
            "no_parser": "Todavía no sé leer los resúmenes de este banco automáticamente.",
            "totals_mismatch": "Leí el resumen pero las sumas no coinciden con los totales del banco, así que no propongo cambios.",
            "encrypted": "El PDF tiene contraseña. Descargalo sin contraseña y volvé a mandarlo.",
            "no_text": "No pude extraer texto del archivo.",
            "no_items": "Reconocí el resumen pero no encontré ningún consumo adentro, así que no propongo cambios.",
        }.get(session.reason or "", "No pude leer el resumen.")
        if session.reason != "encrypted":
            # A un PDF protegido no lo arregla ningún plan: le falta la contraseña.
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


async def _capture_incoming(
    db: AsyncSession, user: User, inbound: InboundMessage,
    amount: Decimal, currency: str, when, counterparty: str | None,
) -> list[str]:
    """Una transferencia que entró (comprobante en PDF o captura) → ingreso.
    El término es quien la mandó: así la regla que deja la respuesta ("de Juan
    Pérez" → Alquiler) hace que la próxima de esa persona no pregunte."""
    draft = quick_capture.QuickDraft(
        amount=amount, currency=currency, expense_date=when or ar_today(),
        term=(counterparty or "").strip(), legacy=False,
    )
    notes = f"Transferencia de {counterparty}" if counterparty else "Transferencia recibida"
    return await _capture_income(db, user, inbound, draft, notes=notes, refund=True)


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


MSG_AI_UNREADABLE = (
    "🤔 No encontré un pago en lo que me mandaste.\n"
    "Si es un comprobante, probá con una foto más nítida o el *PDF*, "
    "o escribilo: *15000 transferencia juan*."
)
MSG_AI_STATEMENT_IMAGE = (
    "📄 Parece el resumen de una tarjeta. Mandámelo en *PDF* (el que descargás "
    "del home banking) y dejo tus datos al día."
)
MSG_AI_CREDIT_CARD = (
    "💳 {what} se pagó con *tarjeta de crédito*, así que no lo cargo ahora: "
    "entra cuando me mandes el resumen de la tarjeta (si lo cargara acá, "
    "contaría dos veces). Si lo querés ya, cargalo en la app como gasto con tarjeta."
)
MSG_AI_LIMIT = (
    "Llegaste al máximo de comprobantes leídos por hoy 🙏 "
    "Mañana sigo; mientras tanto podés escribirlo: *15000 farmacia*."
)


async def _claim_inbound(db: AsyncSession, user: User, inbound: InboundMessage) -> InboundMessage:
    """Guarda el mensaje entrante y commitea ANTES de la llamada a la IA, que
    tarda segundos: si Evolution reintenta el webhook mientras tanto,
    `already_seen` lo frena y el gasto no se carga dos veces. Devuelve el
    mensaje sin `wa_id`, para que lo que sigue no vuelva a registrarlo. Uno
    ya registrado (sin `wa_id`) pasa de largo."""
    if inbound.wa_id is None:
        return inbound
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
    await db.commit()
    return replace(inbound, wa_id=None)


async def _handle_image(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    from app.services.whatsapp import download_media_base64

    data = await download_media_base64(inbound.media_key, inbound.raw_message)
    if data is None:
        _remember(db, user.id, "in", "image", wa_id=inbound.wa_id)
        await db.commit()
        return ["No pude descargar la imagen 😕 Probá mandarla de nuevo."]
    inbound = await _claim_inbound(db, user, inbound)
    return await _read_with_ai(db, user, inbound, data) or [MSG_AI_UNREADABLE]


async def _read_with_ai(
    db: AsyncSession, user: User, inbound: InboundMessage, data: bytes
) -> list[str] | None:
    """Una foto o un PDF → la lectura de `ai_capture` → el gasto, por el mismo
    `_capture_draft` que el texto libre. None = un PDF que no es para cargar
    acá (un resumen, o no se pudo leer): el que llama sigue a la conciliación."""
    from app.services import rate_limit
    from app.services.search import fold_text

    is_pdf = inbound.kind == "pdf"

    async def reply_with(text: str) -> list[str]:
        _remember(db, user.id, "out", "text", text=text)
        await db.commit()
        return [text]

    if not rate_limit.check(f"wa_ai:{user.tenant_id}", settings.WA_AI_DAILY_LIMIT, 86400):
        logger.warning("IA: hogar %s llegó al límite diario de lecturas", user.tenant_id)
        return None if is_pdf else await reply_with(MSG_AI_LIMIT)

    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )).all()
    reading = await ai_capture.read_receipt(
        data, categories=sorted(c.name for c in cats), today=ar_today(), caption=inbound.text,
    )
    if reading is None:
        await record_event(
            db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
            input_kind=inbound.kind, outcome="ai_failed", reason=inbound.kind,
        )
        return None if is_pdf else await reply_with(MSG_AI_UNREADABLE)

    await record_event(
        db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
        input_kind=inbound.kind, outcome="ai_ok", bank_detected=reading.kind[:30],
        est_input_tokens=reading.input_tokens,
    )

    if reading.kind == ai_capture.KIND_STATEMENT:
        return None if is_pdf else await reply_with(MSG_AI_STATEMENT_IMAGE)
    if reading.kind in (ai_capture.KIND_INCOMING, ai_capture.KIND_PAYSLIP) and reading.amount \
            and reading.amount <= quick_capture.MAX_AMOUNT and not await _is_business(db, user):
        if reading.kind == ai_capture.KIND_PAYSLIP:
            draft = quick_capture.QuickDraft(
                amount=reading.amount, currency=reading.currency,
                expense_date=reading.receipt_date or ar_today(),
                term=reading.merchant or "Sueldo", legacy=False,
            )
            return await _capture_income(db, user, inbound, draft, notes=reading.merchant or None)
        return await _capture_incoming(
            db, user, inbound, reading.amount, reading.currency, reading.receipt_date, reading.merchant,
        )
    if reading.kind == ai_capture.KIND_INCOMING:
        amount = f" ({_fmt_amount(reading)})" if reading.amount else ""
        who = f" de {reading.merchant}" if reading.merchant else ""
        return await reply_with(
            f"📥 Es una transferencia que *recibiste*{amount}{who}. No la cargo como "
            "gasto: acá sólo registro lo que pagaste."
        )
    if (
        reading.kind != ai_capture.KIND_EXPENSE
        or reading.amount is None
        or reading.amount > quick_capture.MAX_AMOUNT
    ):
        return None if is_pdf else await reply_with(MSG_AI_UNREADABLE)
    if reading.payment_method == "tarjeta_credito":
        # Un consumo con tarjeta entra con el resumen (conciliación). Cargarlo
        # como gasto simple lo duplica el día que llega el resumen.
        what = f"{_fmt_amount(reading)} en {reading.merchant}" if reading.merchant else _fmt_amount(reading)
        return await reply_with(MSG_AI_CREDIT_CARD.format(what=what[0].upper() + what[1:]))

    draft = quick_capture.QuickDraft(
        amount=reading.amount,
        currency=reading.currency,
        expense_date=reading.receipt_date or ar_today(),
        term=reading.merchant or reading.category or "Comprobante",
        legacy=False,
    )
    suggested = next(
        (c for c in cats if reading.category and fold_text(c.name) == fold_text(reading.category)),
        None,
    )
    method = reading.payment_method if reading.payment_method in ("efectivo", "debito", "transferencia") else None
    return await _capture_draft(db, user, inbound, draft, payment_method=method, suggested=suggested)


async def _handle_unsupported_media(
    db: AsyncSession, user: User, inbound: InboundMessage
) -> list[str]:
    await record_event(
        db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
        input_kind=inbound.kind, outcome="needs_ai", reason=inbound.kind,
    )
    reply = MSG_NEEDS_AI_IMAGE if inbound.kind == "image" else MSG_NEEDS_AI_AUDIO
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id)
    _remember(db, user.id, "out", "text", text=reply, pending={"type": "interest"})
    await db.commit()
    return [reply]


async def _is_business(db: AsyncSession, user) -> bool:
    # Por consulta y no `user.tenant`: la relación no está cargada (lazy load
    # en async = MissingGreenlet) y en los tests el usuario es un SimpleNamespace.
    kind = await db.scalar(select(Tenant.kind).where(Tenant.id == user.tenant_id))
    return kind == TENANT_KIND_BUSINESS


async def _do_pdf_password(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """La respuesta a "el PDF tiene contraseña". Va antes que todo lo demás
    porque un DNI es un número y se leería como respuesta a otra pregunta o
    como un gasto. None = no había esa pregunta, o el mensaje es otra cosa (un
    texto con espacios no es una contraseña: la pregunta se descarta y el
    mensaje sigue su camino). La contraseña nunca se guarda en la memoria."""
    from app.services import pdf_unlock
    from app.services.whatsapp import download_media_base64

    row = await _open_pending(db, user.id)
    pending = (row.pending if row else None) or {}
    if pending.get("type") != "pdf_password":
        return None
    if row.created_at < datetime.now() - timedelta(minutes=PDF_PASSWORD_MINUTES) or not text:
        row.pending = None
        return None
    if text.lower() in ("cancelar", "no", "dejalo"):
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id)
        await db.commit()
        return ["Listo, dejé ese PDF."]
    if any(c.isspace() for c in text):
        row.pending = None
        return None

    pdf = await download_media_base64(pending.get("media_key") or {}, pending.get("raw_message"))
    if pdf is None:
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id)
        await db.commit()
        return ["No pude volver a bajar el PDF 😕 Mandalo de nuevo."]
    unlocked = pdf_unlock.unlock(pdf, text)
    if unlocked is None:
        tries = int(pending.get("tries") or 0) + 1
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id)
        if tries >= PDF_PASSWORD_TRIES:
            row.pending = None
            await db.commit()
            return ["Esa contraseña tampoco lo abre. Mandá el PDF de nuevo cuando la tengas."]
        # La pregunta abierta es la del último mensaje: se vuelve a hacer.
        row.pending = None
        reply = "Esa contraseña no abre el PDF. Probá de nuevo, o mandá *cancelar*."
        _remember(db, user.id, "out", "text", text=reply, pending={**pending, "tries": tries})
        await db.commit()
        return [reply]

    row.pending = None
    # El PDF sigue como si hubiera llegado sin contraseña. Sin el texto: la
    # contraseña no puede terminar en la memoria ni como comentario para la IA.
    as_pdf = replace(
        inbound, kind="pdf", text="",
        media_key=pending.get("media_key") or {}, raw_message=pending.get("raw_message") or {},
    )
    return await _handle_pdf(db, user, as_pdf, pdf=unlocked)


async def _handle_text(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    text = inbound.text.strip()

    handled = await _do_pdf_password(db, user, inbound, text)
    if handled is not None:
        return handled

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

    # El negocio, antes que la categoría y la descripción pendientes y que el
    # gasto genérico: "vendí 3 empanadas" no es la descripción del último gasto.
    handled = await _do_business(db, user, inbound, text)
    if handled is not None:
        return handled

    handled = await _do_pending_income_by_name(db, user, inbound)
    if handled is not None:
        return handled

    handled = await _do_pending_category_by_name(db, user, inbound)
    if handled is not None:
        return handled

    if _is_employee(user):
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        _remember(db, user.id, "out", "text", text=MSG_EMPLOYEE_ONLY)
        await db.commit()
        return [MSG_EMPLOYEE_ONLY]

    handled = await _do_income(db, user, inbound)
    if handled is not None:
        return handled

    handled = await _do_pending_description(db, user, inbound)
    if handled is not None:
        return handled

    return await _do_expense(db, user, inbound)


async def _do_business(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """Ventas, cierres, compras, stock y pagos de un negocio (business/bot.py).
    None = no es eso (o no es un negocio), y el mensaje sigue su camino."""
    from app.services.business import bot as business_bot

    intent = business_capture.parse_business_text(text)
    if intent is None and not _BUSINESS_TEXT_RE.search(text):
        # Un monto suelto puede ser la respuesta a "¿cuánto cobraste?".
        return await business_bot.answer_text(db, user, inbound)
    if not await _is_business(db, user):
        return None
    if intent is None:
        # Parece del negocio pero no se pudo leer: la ayuda, nunca un gasto.
        await record_event(
            db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
            input_kind="text", outcome="needs_ai", reason="unparseable_text",
        )
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        _remember(db, user.id, "out", "text", text=MSG_BUSINESS_HELP)
        await db.commit()
        return [MSG_BUSINESS_HELP]
    return await business_bot.handle_intent(db, user, inbound, intent)


# --------------------------------------------------------------- ingresos ---
# "cobré 850 lucas sueldo", una transferencia recibida (PDF o captura) o un
# recibo de sueldo leído por la IA → un IncomeEntry, por `income_capture`.
# Sólo en un hogar: un negocio no tiene ingresos a mano, sus ventas arman el
# ingreso de cada día (y `tenants.set_kind` cuenta los ingresos como del hogar).

_CANCEL_WORDS = {"no", "cancelar", "cancela", "dejalo", "dejala", "nada"}


async def _do_income(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str] | None:
    draft = income_capture.parse_income_text(inbound.text)
    if draft is None or await _is_business(db, user):
        return None
    return await _capture_income(db, user, inbound, draft)


async def _capture_income(
    db: AsyncSession,
    user: User,
    inbound: InboundMessage,
    draft: quick_capture.QuickDraft,
    *,
    notes: str | None = None,
    refund: bool = False,
) -> list[str]:
    """Resolver la fuente, preguntar si hace falta, guardar y responder.
    `refund` = plata que entró por una transferencia: puede ser alguien
    devolviendo su parte de un gasto compartido, que la app a propósito no
    registra (la tenencia y los gastos ya son netos), así que la pregunta
    ofrece no cargarla."""
    sources = await income_capture.writable_sources(db, user.tenant_id)
    source = await income_capture.resolve_source(db, user.tenant_id, draft.term, sources)
    if source is not None:
        return await _save_income(db, user, inbound, draft, source, notes)

    options = [s.name for s in sources][: income_capture.MAX_OPTIONS]
    new_name = draft.term if draft.term and income_capture.match_by_name(sources, draft.term) is None else None
    choices = _income_choices(options, new_name, refund)
    who = f" de *{draft.term}*" if draft.term else ""
    if choices:
        listed = "\n".join(f"{i + 1}️⃣ {label}" for i, (_k, label) in enumerate(choices))
        reply = (
            f"💰 ¿De qué fuente es el ingreso{who} ({_fmt_amount(draft)})?\n{listed}\n"
            "Respondé el número, o el nombre de la fuente (si no existe, la creo)."
        )
    else:
        reply = (
            f"💰 ¿De qué es el ingreso de {_fmt_amount(draft)}? Escribime el nombre "
            "de la fuente (sueldo, alquiler, un cliente…) y la creo."
        )
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
    _remember(db, user.id, "out", "text", text=reply, pending={
        "type": "income_pick", "draft": _draft_dict(draft), "options": options,
        "new": new_name, "refund": refund, "notes": notes,
    })
    await db.commit()
    return [reply]


def _income_choices(options: list[str], new_name: str | None, refund: bool) -> list[tuple[str, str]]:
    """Las opciones numeradas, en el orden en que se muestran y se contestan."""
    choices = [("source", name) for name in options]
    if new_name:
        choices.append(("new", f"Nueva fuente «{new_name}»"))
    if refund:
        choices.append(("refund", "No es un ingreso (me devolvieron plata de un gasto)"))
    return choices


async def _answer_income_pick(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, number: int
) -> list[str]:
    pending = row.pending or {}
    choices = _income_choices(pending.get("options") or [], pending.get("new"), bool(pending.get("refund")))
    if not choices:
        return ["Escribime el nombre de la fuente del ingreso (sueldo, alquiler, un cliente…)."]
    if not (1 <= number <= len(choices)):
        return [f"Respondé un número del 1 al {len(choices)}, o el nombre de la fuente."]
    kind, label = choices[number - 1]
    if kind == "refund":
        return await _cancel_income(db, user, inbound, row, "👍 No lo cargo: un reintegro no es un ingreso.")
    sources = await income_capture.writable_sources(db, user.tenant_id)
    if kind == "new":
        name = pending["new"]
        source = income_capture.match_by_name(sources, name) or await income_capture.create_source(
            db, user.tenant_id, name
        )
    else:
        source = income_capture.match_by_name(sources, label)
        if source is None:
            return ["Esa fuente ya no existe — respondé con el nombre de otra."]
    return await _income_from_pending(db, user, inbound, row, source)


async def _do_pending_income_by_name(
    db: AsyncSession, user: User, inbound: InboundMessage
) -> list[str] | None:
    """La pregunta de fuente también acepta el nombre escrito, y uno que no
    existe crea la fuente (la pregunta lo avisa). Un texto con números es otra
    cosa — un gasto o un ingreso nuevo — y sigue su camino."""
    row = await _open_pending(db, user.id)
    if row is None or (row.pending or {}).get("type") != "income_pick":
        return None
    from app.services.search import fold_text

    text = inbound.text.strip()
    if fold_text(text) in _CANCEL_WORDS:
        return await _cancel_income(db, user, inbound, row, "👍 Listo, no lo cargo.")
    if not text or any(c.isdigit() for c in text) or len(text) > 60:
        return None
    sources = await income_capture.writable_sources(db, user.tenant_id)
    source = income_capture.match_by_name(sources, text) or await income_capture.create_source(
        db, user.tenant_id, text
    )
    return await _income_from_pending(db, user, inbound, row, source)


async def _cancel_income(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, reply: str
) -> list[str]:
    row.pending = None
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    return [reply]


async def _income_from_pending(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, source: IncomeSource
) -> list[str]:
    pending = row.pending or {}
    draft = _draft_from_dict(pending["draft"])
    # Contestar la pregunta ES la regla término→fuente: la próxima transferencia
    # de la misma persona, o el próximo "cobré … sueldo de octubre", no pregunta.
    await income_capture.learn(db, user.tenant_id, draft.term, source.id)
    row.pending = None
    return await _save_income(db, user, inbound, draft, source, pending.get("notes"))


async def _save_income(
    db: AsyncSession,
    user: User,
    inbound: InboundMessage,
    draft: quick_capture.QuickDraft,
    source: IncomeSource,
    notes: str | None,
) -> list[str]:
    from app.services.search import fold_text

    if notes is None and draft.term and fold_text(draft.term) != fold_text(source.name):
        notes = draft.term
    entry = await income_capture.create_income(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft, source=source, notes=notes,
    )
    dupes = await income_capture.same_month(db, entry)
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None,
              ref_type="income", ref_id=entry.id)
    await db.commit()

    when = "" if entry.period_date == ar_today() else f" · {entry.period_date.strftime('%d/%m')}"
    lines = [f"💰 Ingreso: {_fmt_amount(draft)} · {source.name}{when}"]
    if dupes:
        listed = ", ".join(_fmt_amount(d) for d in dupes[:3])
        lines.append(
            f"⚠️ Ya había {'otro ingreso' if len(dupes) == 1 else f'{len(dupes)} ingresos'} "
            f"de «{source.name}» en {entry.period_date.strftime('%m/%Y')} ({listed}). "
            "Si es el mismo, respondé *deshacer*."
        )
    else:
        lines.append("Respondé *deshacer*, o *editar monto / fuente / descripción …*")
    return ["\n".join(lines)]


_NO_WORDS = {"no", "n", "nop", "no gracias", "listo", "ok", "asi esta", "dejalo", "dejala"}


async def _do_pending_description(
    db: AsyncSession, user: User, inbound: InboundMessage
) -> list[str] | None:
    """La respuesta a "¿le agregás una descripción?". Prioridades: un "no" la
    descarta; algo que parsea como gasto ES un gasto nuevo (la oferta se
    descarta sola); cualquier otro texto es la descripción."""
    row = await _open_pending(db, user.id)
    if row is None or (row.pending or {}).get("type") != "description_offer":
        return None

    from app.services.search import fold_text

    if fold_text(inbound.text) in _NO_WORDS:
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["👍 Quedó así."]

    # Un número pelado no es una descripción (es alguien contestando una
    # pregunta que ya no existe) — que siga su camino y la oferta siga viva.
    if _NUMBER_RE.match(inbound.text):
        return None

    if quick_capture.parse_quick_text(inbound.text) is not None:
        row.pending = None  # vino otro gasto: la oferta caduca sola
        await db.flush()
        return None

    entry = await db.get(ExpenseEntry, (row.pending or {}).get("entry_id"))
    row.pending = None
    if entry is None or entry.tenant_id != user.tenant_id:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Ese gasto ya no está — no cambié nada."]
    entry.description = inbound.text.strip()[:255]
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    formatted = f"{entry.amount:,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return [f"✏️ Listo: {_money(formatted, entry.currency)} · {entry.description}"]


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

    return await _create_from_pending(db, user, inbound, row, cat)


async def _create_from_pending(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, cat: ExpenseCategory
) -> list[str]:
    """La respuesta a la pregunta de categoría: crea el gasto que la esperaba,
    con lo que traía colgado (en un negocio, el stock de una compra y el
    proveedor o empleado)."""
    raw = (row.pending or {}).get("draft") or {}
    draft = _draft_from_dict(raw)
    extra = raw.get("x")
    entry = await quick_capture.create_quick_expense(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft, category_id=cat.id,
        payment_method=raw.get("pm"), payee_id=(extra or {}).get("payee_id"),
    )
    suffix = await _finish_expense(db, user, entry, extra)
    await _learn_merchant_rule(db, user.tenant_id, draft.term, cat.id)
    row.pending = None
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text,
              ref_type="expense", ref_id=entry.id)
    reply = _offer_description(
        db, user, entry, f"✅ {_fmt_amount(draft)} · {entry.description} — {cat.name}{suffix}"
    )
    await db.commit()
    return [reply]


async def _finish_expense(db: AsyncSession, user: User, entry: ExpenseEntry, extra: dict | None) -> str:
    """Lo que cuelga de un gasto del negocio: lo que entró al stock con una
    compra. Devuelve la línea que lo cuenta ("📦 Coca-Cola: hay 20")."""
    lines = (extra or {}).get("stock") or []
    if not lines:
        return ""
    from app.models.business import Product
    from app.schemas.business import StockLineIn
    from app.services.business import stock as stock_service

    await stock_service.add_purchase_lines(
        db, tenant_id=user.tenant_id, user_id=user.id, entry=entry,
        lines=[StockLineIn(product_id=ln["pid"], qty=Decimal(ln["qty"])) for ln in lines],
    )
    ids = [ln["pid"] for ln in lines]
    levels = await stock_service.on_hand(db, user.tenant_id, ids)
    names = {p.id: p.name for p in (await db.scalars(select(Product).where(Product.id.in_(ids)))).all()}
    return "\n📦 " + " · ".join(
        f"{names.get(pid, 'Producto')}: hay {business_capture.fmt_qty(levels.get(pid, 0))}"
        for pid in dict.fromkeys(ids)
    )


async def _do_expense(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    draft = quick_capture.parse_quick_text(inbound.text)
    if draft is None:
        await record_event(
            db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
            input_kind="text", outcome="needs_ai", reason="unparseable_text",
        )
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return [MSG_BUSINESS_HELP if await _is_business(db, user) else _help_text()]

    return await _capture_draft(db, user, inbound, draft)


async def _capture_draft(
    db: AsyncSession,
    user: User,
    inbound: InboundMessage,
    draft: quick_capture.QuickDraft,
    payment_method: str | None = None,
    *,
    category: ExpenseCategory | None = None,
    extra: dict | None = None,
    suggested: ExpenseCategory | None = None,
) -> list[str]:
    """La mitad común de capturar un gasto (texto libre, comprobante, o una
    compra o un pago de un negocio): resolver categoría, preguntar si hace
    falta, guardar y responder. `category` la fija quien llama (la de un
    proveedor, "Mercadería" en una compra); `extra` es lo que cuelga del gasto
    en un negocio (`payee_id`, y `stock`: lo que entró con la compra), y viaja
    con la pregunta de categoría si hay que hacerla. `suggested` es la que
    propuso la lectura con IA: entra sólo si el hogar no tiene regla ni
    historial para ese comercio, y se muestra como sugerida."""
    if category is not None:
        pick = quick_capture.CategoryPick(category.id, category.name, "exact", None, [])
    # En USD la categoría es siempre "Consumo en dólares" (regla del dominio).
    elif draft.currency == "USD":
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
        elif pick.category_id is None and suggested is not None:
            pick = quick_capture.CategoryPick(suggested.id, suggested.name, "suggest", None, [])

    if pick.category_id is None:
        options = pick.options
        if not options:
            reply = "No encontré una categoría para eso. Decime el nombre de la categoría."
            pending = {"type": "category_name", "draft": _draft_dict(draft, payment_method, extra)}
        else:
            listed = "\n".join(f"{i+1}️⃣ {name}" for i, name in enumerate(options))
            reply = (
                f"¿En qué categoría va *{draft.term}* ({_fmt_amount(draft)})?\n{listed}\n"
                "Respondé el número, o el nombre de otra categoría."
            )
            pending = {"type": "category_pick", "draft": _draft_dict(draft, payment_method, extra), "options": options}
        _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
        _remember(db, user.id, "out", "text", text=reply, pending=pending)
        await db.commit()
        return [reply]

    entry = await quick_capture.create_quick_expense(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft,
        category_id=pick.category_id, description=pick.description,
        payment_method=payment_method, payee_id=(extra or {}).get("payee_id"),
    )
    stock_line = await _finish_expense(db, user, entry, extra)
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None,
              ref_type="expense", ref_id=entry.id)
    await db.commit()

    suffix = " (sugerida)" if pick.source in ("suggest", "rule") else ""
    when = "" if entry.expense_date == ar_today() else f" · {entry.expense_date.strftime('%d/%m')}"
    base = f"✅ {_fmt_amount(draft)} · {entry.description} — {pick.category_name}{suffix}{when}{stock_line}"
    if pick.source in ("suggest", "rule"):
        reply = _offer_description(db, user, entry, base)
        await db.commit()
        return [reply]
    return [base + "\nRespondé *deshacer*, o *editar monto/categoría/descripción …*"]


async def _learn_merchant_rule(
    db: AsyncSession, tenant_id: int, term: str, category_id: int
) -> None:
    """Contestar la pregunta de categoría ES la regla comercio→categoría.

    La sugerencia por historial se rompe apenas el usuario reescribe la
    descripción (caso real: "Maremtisas067" → "mantel para el quincho" y el
    mismo comprobante volvió a preguntar). La regla es durable y, como todo
    lo de `capture_rules`, sólo produce una sugerencia visible y editable —
    nunca se aplica sin mostrarse. Sin descripción en el payload a propósito:
    la del primer gasto no tiene por qué valer para el próximo."""
    from app.services.reconcile import rules as capture_rules

    await capture_rules.save_rule(
        db, tenant_id, capture_rules.KIND_MERCHANT_CATEGORY,
        capture_rules.merchant_key(term), {"category_id": category_id},
    )


def _offer_description(db: AsyncSession, user: User, entry, base_line: str) -> str:
    """Después de guardar, ofrecer una descripción opcional. Sólo donde la
    descripción actual es el nombre del comercio o el término crudo (categoría
    elegida a mano o sugerida) — cuando el usuario ya escribió lo que quería,
    repreguntar es ruido."""
    reply = base_line + "\n¿Le agregás una descripción? Escribila, o respondé *no*."
    _remember(db, user.id, "out", "text", text=reply,
              pending={"type": "description_offer", "entry_id": entry.id})
    return reply


def _draft_dict(
    draft: quick_capture.QuickDraft, payment_method: str | None = None, extra: dict | None = None
) -> dict:
    d = {
        "amount": str(draft.amount), "currency": draft.currency,
        "date": draft.expense_date.isoformat(), "term": draft.term,
        "pm": payment_method,
    }
    if extra:
        d["x"] = extra
    return d


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
    from app.services.business import bot as business_bot

    ref = await _last_ref(db, user.id, ("expense", "income", *business_bot.BUSINESS_REFS), inbound.quoted_wa_id)
    if ref is None:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["No tengo nada para deshacer en los últimos 7 días."]
    if ref.ref_type == "income":
        return await _undo_income(db, user, inbound, ref)
    if ref.ref_type != "expense":
        return await business_bot.undo(db, user, inbound, ref)
    entry = await db.get(ExpenseEntry, ref.ref_id)
    if entry is None or entry.tenant_id != user.tenant_id or entry.source != EXPENSE_SOURCE_WHATSAPP:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Ese gasto ya no está (o no lo creé yo)."]
    desc, amount, currency = entry.description, entry.amount, entry.currency
    # Por el servicio y no con `db.delete`: lo que cuelga del gasto (hoy un
    # split o la hipoteca, mañana el stock de una compra) se suelta igual que
    # cuando se borra desde la app.
    await expenses_service.delete_expense(db, entry, user.tenant_id)
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
    # El monto se corrige en lo último que se cargó: gasto, ingreso o venta.
    # La descripción, en un gasto o un ingreso (sus notas); la categoría es
    # sólo de los gastos y la fuente sólo de los ingresos.
    types = {
        "monto": ("expense", "income", "sale"),
        "fuente": ("income",),
    }.get(field_name, ("expense", "income") if field_name.startswith("descripci") else ("expense",))
    ref = await _last_ref(db, user.id, types, inbound.quoted_wa_id)
    if ref is not None and ref.ref_type == "income":
        return await _edit_income(db, user, inbound, ref, field_name, value)
    if field_name == "fuente":
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["No tengo un ingreso reciente para editar."]
    if ref is not None and ref.ref_type == "sale":
        from app.services.business import bot as business_bot

        return await business_bot.edit_sale_amount(db, user, inbound, ref, value)
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
        amount = _parse_edit_amount(value)
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


def _parse_edit_amount(value: str) -> Decimal | None:
    amount = quick_capture._parse_number(value.replace("$", "").strip())
    if amount is None:
        m = quick_capture._AMOUNT_RE.search(value)
        if m:
            amount = quick_capture._parse_number(m.group(1))
            mult = quick_capture._MULTIPLIER.get((m.group(2) or "").lower())
            if amount is not None and mult:
                amount = amount * mult
    return amount


async def _load_income(db: AsyncSession, user: User, ref: WaMessage) -> IncomeEntry | None:
    entry = await db.get(IncomeEntry, ref.ref_id)
    return entry if entry is not None and entry.tenant_id == user.tenant_id else None


async def _undo_income(db: AsyncSession, user: User, inbound: InboundMessage, ref: WaMessage) -> list[str]:
    entry = await _load_income(db, user, ref)
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    if entry is None:
        await db.commit()
        return ["Ese ingreso ya no está."]
    name = await db.scalar(select(IncomeSource.name).where(IncomeSource.id == entry.source_id))
    what = f"{_fmt_amount(entry)} · {name}"
    await db.delete(entry)
    ref.ref_type = None
    ref.ref_id = None
    await db.commit()
    return [f"🗑️ Deshecho: ingreso {what}"]


async def _edit_income(
    db: AsyncSession, user: User, inbound: InboundMessage, ref: WaMessage, field_name: str, value: str
) -> list[str]:
    entry = await _load_income(db, user, ref)
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    if entry is None:
        await db.commit()
        return ["Ese ingreso ya no está."]
    # Con detalle cargado en la app, el neto y la fuente dependen de él:
    # tocarlos desde acá descuadraría la cuenta sin decirlo.
    has_detail = entry.bruto is not None or entry.deducciones is not None
    if has_detail and field_name in ("monto", "fuente"):
        await db.commit()
        return ["Ese ingreso tiene el detalle cargado en la app: corregilo ahí, así la cuenta sigue cerrando."]

    sources = await income_capture.writable_sources(db, user.tenant_id)
    if field_name == "monto":
        amount = _parse_edit_amount(value)
        if amount is None:
            await db.commit()
            return ["No entendí el monto. Probá: *editar monto 850000*"]
        entry.amount = amount
    elif field_name == "fuente":
        source = income_capture.match_by_name(sources, value)
        if source is None:
            names = ", ".join(s.name for s in sources[:12]) or "ninguna"
            await db.commit()
            return [f"No hay una fuente «{value}». Tenés: {names}"]
        entry.source_id = source.id
    else:
        entry.notes = value[:500]
    await db.commit()
    name = await db.scalar(select(IncomeSource.name).where(IncomeSource.id == entry.source_id))
    notes = f" · {entry.notes}" if entry.notes else ""
    return [f"✏️ Listo: ingreso {_fmt_amount(entry)} · {name}{notes}"]


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

    if ptype and ptype.startswith("biz_"):
        from app.services.business import bot as business_bot

        return await business_bot.answer_number(db, user, inbound, row, number)

    if ptype == "income_pick":
        return await _answer_income_pick(db, user, inbound, row, number)

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
        return await _create_from_pending(db, user, inbound, row, cat)

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
        return ["No encontré ese resumen."]

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
        lines.append("🏁 *Resumen al día*: tus datos quedaron iguales a los del banco.")
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
