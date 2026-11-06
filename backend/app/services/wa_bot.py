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

import asyncio
import logging
import re
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from decimal import Decimal

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.expense import EXPENSE_SOURCE_WHATSAPP, ExpenseCategory, ExpenseEntry
from app.models.income import IncomeEntry, IncomeSource, IncomeSourceField
from app.models.reconciliation import ACTION_PROPOSED, ReconciliationAction
from app.models.tenant import TENANT_KIND_BUSINESS, Tenant
from app.models.user import User
from app.models.wa_message import WaMessage
from app.services import ai_capture, bot_cases, expenses as expenses_service, income_capture, quick_capture, reconcile as reconcile_service, transcribe
from app.services.business import capture as business_capture
from app.services.category_suggest import invalidate as invalidate_suggest
from app.services.clock import ar_today
from app.services.currency import get_or_create_usd_category
from app.services.reconcile.engine import record_event
from app.services.whatsapp import _money

logger = logging.getLogger(__name__)

MEMORY_DAYS = 7

MSG_NOT_LINKED = (
    "Este número no está vinculado a tood.\n"
    "Vinculalo desde la app, en Configuración > WhatsApp."
)
# A quien todavía no tiene cuenta (services/wa_signup.py). El link crea la
# cuenta y deja el número vinculado; lo que haya mandado se carga ahí.
MSG_SIGNUP_SAVED = (
    "Hola, soy tood. Llevo las cuentas de la casa: gastos, tarjetas e ingresos, cargados por acá.\n\n"
    "Todavía no tenés cuenta. Creala en un minuto con este link y lo que me mandaste queda cargado:\n{link}"
)
MSG_SIGNUP = (
    "Hola, soy tood. Llevo las cuentas de la casa: gastos, tarjetas e ingresos, cargados por acá.\n\n"
    "Todavía no tenés cuenta. Creala en un minuto con este link:\n{link}\n\n"
    "Después escribime un gasto así: *12 lucas verdulería*"
)
MSG_SIGNUP_MEDIA = (
    "Hola, soy tood. Llevo las cuentas de la casa: gastos, tarjetas e ingresos, cargados por acá.\n\n"
    "Todavía no tenés cuenta. Creala en un minuto con este link y después mandame eso de nuevo:\n{link}"
)
# Los pasos con los nombres de la pantalla de alta (frontend/app/onboarding).
_SIGNUP_BUSINESS_STEPS = (
    "1. Entrá con este link: {link}\n"
    "2. Iniciá sesión con tu cuenta de Google.\n"
    "3. En *Para qué es la cuenta* elegí *Mi negocio*, poné el nombre y tocá *Crear negocio*."
)
MSG_SIGNUP_BUSINESS_SAVED = (
    "Hola, soy tood. Llevo las cuentas de casas y negocios, cargadas por acá.\n\n"
    "Para anotar ventas necesitás una cuenta de negocio, y lo que me mandaste queda cargado ahí:\n"
    + _SIGNUP_BUSINESS_STEPS
)
MSG_SIGNUP_BUSINESS = (
    "Hola, soy tood. Llevo las cuentas de casas y negocios, cargadas por acá.\n\n"
    "Para anotar ventas necesitás una cuenta de negocio:\n"
    + _SIGNUP_BUSINESS_STEPS
    + "\n\nDespués anotá las ventas así: *vendí 3 empanadas 4500 efectivo*"
)
# Mensajes siguientes, con el link ya mandado (no se rota: ver wa_signup).
MSG_SIGNUP_AGAIN_BUSINESS = "Lo guardé también. Creá la cuenta con el link de arriba y en *Para qué es la cuenta* elegí *Mi negocio*, así queda cargado."
MSG_SIGNUP_AGAIN_SAVED = "Lo guardé también. Cuando crees la cuenta con el link de arriba, queda cargado."
MSG_SIGNUP_AGAIN = "Para seguir, creá tu cuenta con el link de arriba."
MSG_SIGNUP_LINKED = "Listo, tu WhatsApp quedó vinculado a tood."
MSG_SIGNUP_REPLAY = "Listo, tu WhatsApp quedó vinculado a tood. Cargo lo que me mandaste:"
MSG_SIGNUP_SKIPPED_BUSINESS = (
    "Las ventas que me mandaste no las cargué: tu cuenta es de hogar, y las ventas se anotan en una cuenta de negocio."
)
MSG_ERROR = "No pude procesar ese mensaje. Probá de nuevo en un rato."
# Una cuenta en pausa no carga nada por chat (services/account_closure.py).
MSG_PAUSED = (
    "Tu cuenta de tood está en pausa, así que no cargué nada.\n"
    "Para volver a usarla, entrá a la app y tocá Reactivar."
)
MSG_CAN_DO = (
    "Contame como se lo dirías a alguien, por ejemplo:\n"
    "• *gasté 12 lucas en la verdulería*\n"
    "• *20 lucas de nafta con la visa*\n"
    "• *60 lucas en 3 cuotas heladera con la bbva*\n"
    "• *30 lucas de asado a medias con Juan*\n"
    "• *cobré el sueldo, 850 lucas*\n\n"
    "También podés mandarme el *PDF del resumen* de tu tarjeta o el *PDF de un comprobante*.\n"
    "Si algo queda mal, decime *deshacer*, *categoría súper* o *editar monto 13000*."
)
MSG_HELP = "No te entendí. " + MSG_CAN_DO


# Después de responder, la t reacciona con un sticker animado (frontend/public/brand/tood/stickers/). Uno por
# mensaje, elegido por la respuesta y no por quién la escribió: así cualquier camino nuevo del bot que siga la
# convención de los textos (✅ guardado, "No pude…", opciones 1./2.) recibe el suyo sin tocar nada acá.
#   error   → algo no se pudo hacer (prioridad: es lo que más importa que se note)
#   duda    → no entendió, o pregunta con opciones
#   ingreso → se cargó un ingreso
#   cargado → se cargó un gasto, una venta, un cierre, la producción o se aplicó un resumen
# Deshacer, editar o consultar no llevan sticker: no son una carga nueva.
STICKERS = ("error", "duda", "ingreso", "cargado")
_UNDERSTOOD_NOT = ("No te entendí",)


def sticker_for(replies: list[str]) -> str | None:
    texts = [r for r in replies if r]
    if any(r == MSG_ERROR or r.startswith("No pude") for r in texts):
        return "error"
    if any(r.startswith(_UNDERSTOOD_NOT) or "\n1. " in r or r.startswith("1. ") for r in texts):
        return "duda"
    if any(r.startswith("✅ Ingreso") for r in texts):
        return "ingreso"
    if any(r.startswith("✅") for r in texts):
        return "cargado"
    return None


async def handle_and_send(db: AsyncSession, user: User, inbound: InboundMessage) -> int:
    """Procesa un mensaje y manda las respuestas, después del commit que hace
    `handle` (un mensaje nunca anuncia algo que no quedó guardado). Lo usan el
    webhook y el alta desde el bot, que reprocesa lo que se mandó sin cuenta."""
    from app.services.whatsapp import send_wa_msg, send_wa_sticker

    mark = await memory_mark(db, user.id)
    replies = await handle(db, user, inbound)
    sent_ids = [await send_wa_msg(inbound.phone, reply) for reply in replies]
    await link_replies(db, user.id, mark, sent_ids, replies)
    # La t reacciona a lo que pasó (ver STICKERS). Después del texto, y si falla, no importa.
    kind = sticker_for(replies) if settings.WA_STICKERS_ENABLED else None
    if kind:
        await send_wa_sticker(inbound.phone, sticker_url(kind))
    return len(replies)


async def reply_unlinked(db: AsyncSession, inbound: InboundMessage) -> str | None:
    """La respuesta a un número sin cuenta (o None: ya se le contestó mucho).
    Commitea antes de devolver: el link sólo sale si el token quedó guardado."""
    from app.services import rate_limit, wa_signup

    # Un número que escribe sin parar no puede hacer que el bot le conteste
    # sin parar: el número del bot es lo que Evolution arriesga.
    if not rate_limit.check(f"wa_unlinked:{inbound.phone}", 6, 3600):
        return None
    raw, kind = await wa_signup.record(db, inbound.phone, inbound.text if inbound.kind == "text" else "")
    await db.commit()
    if raw is None:
        if kind == wa_signup.BUSINESS:
            return MSG_SIGNUP_AGAIN_BUSINESS
        return MSG_SIGNUP_AGAIN_SAVED if kind == wa_signup.HOME else MSG_SIGNUP_AGAIN
    link = wa_signup.signup_link(raw)
    if kind == wa_signup.BUSINESS:
        return MSG_SIGNUP_BUSINESS_SAVED.format(link=link)
    if kind == wa_signup.BUSINESS_HINT:
        return MSG_SIGNUP_BUSINESS.format(link=link)
    if kind == wa_signup.HOME:
        return MSG_SIGNUP_SAVED.format(link=link)
    if inbound.kind in ("pdf", "image"):
        return MSG_SIGNUP_MEDIA.format(link=link)
    return MSG_SIGNUP.format(link=link)


def sticker_url(kind: str) -> str:
    return f"{settings.FRONTEND_URL.rstrip('/')}/brand/tood/stickers/sticker-{kind}.webp"


def _help_text() -> str:
    """Con la IA prendida, el bot también lee fotos y capturas: la ayuda lo dice."""
    return _with_media_hint(MSG_HELP)


def _with_media_hint(text: str) -> str:
    if not ai_capture.enabled():
        return text
    return text.replace("el *PDF de un comprobante*", "un *comprobante* (foto, captura o PDF)")


# Una imagen casi siempre es un comprobante compartido como captura: muchas
# apps (Mercado Pago, los bancos) comparten la imagen por default. El PDF sí
# se lee en código, así que lo primero que dice el mensaje es cómo mandarlo —
# un aviso que sólo ofrece el plan Pro deja al usuario sin salida (caso real:
# una transferencia enviada como captura terminó en "pasate de plan").
MSG_NEEDS_AI_IMAGE = (
    "Me llegó una imagen, y por ahora sólo leo comprobantes en *PDF*.\n\n"
    "En la app de tu banco o billetera buscá *Compartir comprobante* y elegí *PDF* "
    "(o *Descargar PDF*), y mandámelo. También podés escribirlo: "
    "*15000 transferencia juan*.\n\n"
    "Leer imágenes va a ser parte del plan Pro. Si te sirve, respondé *me interesa*."
)
MSG_NEEDS_AI_AUDIO = (
    "Todavía no puedo escuchar audios. Escribime el gasto como te salga: "
    "*12 lucas verdulería*.\n\n"
    "Entender audios va a ser parte del plan Pro. Si te sirve, respondé *me interesa*."
)
MSG_AUDIO_TOO_LONG = "Ese audio es muy largo: escucho hasta {minutes} minutos. Mandame uno más corto o escribilo."
MSG_AUDIO_LIMIT = "Por hoy llegaste al límite de audios. Escribime el gasto y lo cargo igual: *12 lucas verdulería*."
MSG_AUDIO_DOWN = "No pude escuchar el audio ahora. Escribime el gasto y lo cargo igual: *12 lucas verdulería*."
MSG_AUDIO_EMPTY = "No pude entender el audio. ¿Me lo repetís o me lo escribís?"
MSG_INTEREST = "Anotado, gracias. Me sirve para saber qué hacer primero."

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
    "No te entendí. Para el negocio podés mandarme:\n"
    "• Una venta: *vendí 3 empanadas y 1 coca 6500 efectivo*\n"
    "• El cierre del día: *cierre 200 lucas efectivo, 150 mp*\n"
    "• Producción y conteos: *hice 30 empanadas* · *quedan 5 coca*\n"
    "• Cuánto hay: *stock coca*\n"
    "• Una compra o un pago: *compré 12 coca a 18 lucas* · *pagué 80 lucas a juan*\n"
    "• Un gasto: *45 lucas alquiler*\n"
    "• *deshacer* borra lo último que cargué"
)

_EDIT_RE = re.compile(
    r"^(?:editar|edit[aá]|cambiar|cambi[aá]|corregir|correg[ií])\s+(?:la\s+|el\s+)?(monto|categor[ií]a|descripci[oó]n|fuente|fecha)"
    r"\s+(?:a\s+|por\s+|es\s+)?(.+)$",
    re.IGNORECASE,
)
# El atajo que se ofrece después de cada gasto: "categoría súper".
_CATEGORY_RE = re.compile(r"^(categor[ií]a|fuente|descripci[oó]n)\s*[:,]?\s+(.+)$", re.IGNORECASE)
# Las dos cosas en un mensaje, como salen de un audio: "Categoría Servicios, Descripción, Gas".
_TWO_FIELDS_RE = re.compile(
    r"^(categor[ií]a|descripci[oó]n)\s*[:,]?\s+(.+?)[\s,;.]+(categor[ií]a|descripci[oó]n)\s*[:,]?\s+(.+)$",
    re.IGNORECASE,
)
# "Me equivoqué, eran 35.000": corrige lo último que se cargó, no es un gasto nuevo.
_FIX_RE = re.compile(
    r"^(?P<sorry>(?:(?:no|perd[oó]n|me\s+equivoqu[eé]|est[aá]\s+mal)[\s,.:;-]+)*)"
    r"(?:(?P<verb>eran|era|son|fueron|fue)\s+(?:de\s+)?)?(?P<value>.+)$",
    re.IGNORECASE,
)
_AMOUNT_ONLY_RE = re.compile(r"^\$?\s*\d[\d.,]*\s*(?:lucas?|mil|k|palos?)?\s*(?:pesos)?$", re.IGNORECASE)
_DESCRIPTION_LEAD_RE = re.compile(r"^(?:fue|fueron|era|eran)\s+(?=\S)", re.IGNORECASE)
FIX_WINDOW = timedelta(minutes=30)
_UNDO_RE = re.compile(r"^(deshacer|deshace|anular)\b", re.IGNORECASE)
_INTEREST_RE = re.compile(r"^me\s+interesa\b", re.IGNORECASE)
_NUMBER_RE = re.compile(r"^\s*([1-9])\s*$")
# Mientras un gasto espera una respuesta, *deshacer* o "no" es no cargarlo. Si
# siguiera de largo borraría lo anterior, que no tiene nada que ver.
_DRAFT_PENDING = {"category_pick", "category_name", "income_pick", "card_pick", "share_confirm",
                  "share_contact", "own_transfer", "term_ask"}
_NEW_CATEGORY_RE = re.compile(
    r"^(?:(?:quiero|pod[eé]s|podr[ií]as)\s+)?(?:crea|cre[aá]|crear|agreg[aá]|agregar|sum[aá]|sumar|hac[eé]|hacer|armar?)(?:me)?\s+"
    r"(?:una\s+|la\s+)?(?:categor[ií]a)(?:\s+nueva)?"
    r"(?:\s+(?:que\s+se\s+llame|llamada|con\s+el\s+nombre(?:\s+de)?|de\s+nombre))?\s*:?\s+[«\"']?(.+?)[»\"']?$",
    re.IGNORECASE,
)
_ASK_RECATEGORIZE_RE = re.compile(
    r"^(?:puedo|se\s+puede|pod[eé]s|podr[ií]as|quiero)\s+(?:cambiar|corregir|editar|cambiarle|cambiarlo)\b.*categor[ií]a\b[?\s]*$",
    re.IGNORECASE,
)
_ACTUALLY_RE = re.compile(r"^(?:no,?\s+)?(?:este\s+|esto\s+|eso\s+|era\s+)?(?:es\s+|era\s+)?(?:un\s+|una\s+|de\s+)?(.{3,40}?)[.!]?$", re.IGNORECASE)
_IS_INCOME_RE = re.compile(r"^(?:no\s+(?:es|era)\s+un\s+gasto|(?:es|era)\s+un\s+ingreso|me\s+entr[oó]\s+a\s+m[ií])\b", re.IGNORECASE)
_SMALL_TALK = {
    "hola": "¡Hola! Contame qué querés anotar.", "buenas": "¡Buenas! Contame qué querés anotar.",
    "buen dia": "¡Buen día! Contame qué querés anotar.", "buenos dias": "¡Buen día! Contame qué querés anotar.",
    "buenas tardes": "¡Buenas! Contame qué querés anotar.", "buenas noches": "¡Buenas! Contame qué querés anotar.",
    "gracias": "De nada.", "muchas gracias": "De nada.", "genial gracias": "De nada.", "dale gracias": "De nada.",
    "ok": "Dale.", "oka": "Dale.", "okey": "Dale.", "dale": "Dale.", "joya": "Dale.", "genial": "Dale.",
    "perfecto": "Dale.", "buenisimo": "Dale.", "barbaro": "Dale.", "bien": "Dale.",
}
_ASK_HELP = {"ayuda", "help", "menu", "que podes hacer", "que sabes hacer", "como funciona", "como funcionas", "como te uso"}
MSG_OUT_OF_SCOPE = "Por ahora acá sólo anoto: gastos, ingresos, tarjetas y compartidos. Lo demás lo ves en la app: {url}"
# Cuánto después de cargar algo "es un reintegro" habla de eso y no de otra cosa.
_CORRECTION_MINUTES = 15


@dataclass
class InboundMessage:
    phone: str
    wa_id: str | None
    kind: str  # text | pdf | image | audio | other
    text: str = ""
    quoted_wa_id: str | None = None
    raw_message: dict = field(default_factory=dict)
    media_key: dict = field(default_factory=dict)
    media_seconds: int | None = None


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
    media_seconds = None
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
        media_seconds = (message.get("audioMessage") or message.get("pttMessage") or {}).get("seconds")
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
        media_seconds=media_seconds,
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


_WAT_RE = re.compile(r"wat=[\w-]+")


def _remember(
    db: AsyncSession, user_id: int, direction: str, kind: str,
    *, wa_id: str | None = None, text: str | None = None,
    ref_type: str | None = None, ref_id: int | None = None,
    pending: dict | None = None,
) -> WaMessage:
    # El link de auto-login no se guarda: es una credencial, aunque dure 15 minutos.
    text = _WAT_RE.sub("wat=•••", text) if text else text
    row = WaMessage(
        user_id=user_id, direction=direction, wa_message_id=wa_id, kind=kind,
        text=(text or "")[:500] or None, ref_type=ref_type, ref_id=ref_id,
        pending=pending,
    )
    db.add(row)
    return row


def _cutoff() -> datetime:
    return datetime.now() - timedelta(days=MEMORY_DAYS)


# Las respuestas del bot que confirman algo se guardan con `ref_type`
# "r:<tipo>": citarlas apunta a esa entidad, pero nunca cuentan como "lo
# último que se cargó" (si no, *deshacer* encontraría la respuesta en vez del
# mensaje original y el siguiente *deshacer* daría con un gasto ya borrado).
_REPLY_PREFIX = "r:"


async def memory_mark(db: AsyncSession, user_id: int) -> int:
    """La última fila de memoria antes de procesar un mensaje: lo que
    `handle()` cree después tiene un id mayor."""
    return await db.scalar(
        select(func.max(WaMessage.id)).where(WaMessage.user_id == user_id)
    ) or 0


async def link_replies(
    db: AsyncSession, user_id: int, mark: int, sent_ids: list[str | None], replies: list[str] | None = None,
) -> None:
    """Ata las respuestas enviadas a la entidad que creó o tocó este mensaje,
    para que citar "✅ … — Supermercado" y escribir *editar categoría …* (o
    sólo el nombre de la categoría) corrija ESE gasto y no el último. También
    guarda lo que se contestó: sin eso, mirar la semana no decía qué le había
    llegado a la persona. Nunca levanta: perder el vínculo es perder un atajo,
    no el gasto."""
    texts = list(replies or [])
    ids = [i for i in sent_ids if i]
    try:
        already = set((await db.scalars(
            select(WaMessage.text).where(
                WaMessage.user_id == user_id, WaMessage.id > mark,
                WaMessage.direction == "out", WaMessage.text.is_not(None),
            )
        )).all())
        unsaved = [t for t in texts if _WAT_RE.sub("wat=•••", t)[:500] not in already]

        def keep_unsaved() -> None:
            # Con el prefijo, como las demás: una fila común cerraría la pregunta abierta.
            for text in unsaved:
                _remember(db, user_id, "out", "text", text=text, ref_type=f"{_REPLY_PREFIX}text")

        if not ids:
            keep_unsaved()
            await db.commit()
            return
        ref = await db.scalar(
            select(WaMessage).where(
                WaMessage.user_id == user_id,
                WaMessage.id > mark,
                WaMessage.ref_type.is_not(None),
            ).order_by(WaMessage.id.desc()).limit(1)
        )
        if ref is None or ref.ref_type.startswith(_REPLY_PREFIX):
            keep_unsaved()
            await db.commit()
            return
        for i, wa_id in enumerate(ids):
            text = texts[i] if i < len(texts) and texts[i] in unsaved else None
            _remember(db, user_id, "out", "text", wa_id=wa_id[:64], text=text,
                      ref_type=f"{_REPLY_PREFIX}{ref.ref_type}"[:20], ref_id=ref.ref_id)
        await db.commit()
    except Exception:
        logger.exception("WA: no pude vincular las respuestas (user %s)", user_id)
        await db.rollback()


async def _quoted_ref(db: AsyncSession, user_id: int, quoted_wa_id: str | None) -> WaMessage | None:
    """La fila de la entidad del mensaje citado: el propio mensaje del
    usuario, o — si citó una respuesta del bot — el mensaje original que esa
    respuesta confirma."""
    if not quoted_wa_id:
        return None
    quoted = await db.scalar(
        select(WaMessage).where(
            WaMessage.user_id == user_id,
            WaMessage.wa_message_id == quoted_wa_id,
        )
    )
    if quoted is not None and not quoted.ref_type and quoted.direction == "in":
        # Un mensaje que no creó nada por sí mismo: una captura registrada
        # antes de la IA (`_claim_inbound`) o un gasto que esperó la pregunta
        # de categoría. Lo creado quedó en el mensaje entrante siguiente.
        nxt = await db.scalar(
            select(WaMessage).where(
                WaMessage.user_id == user_id,
                WaMessage.direction == "in",
                WaMessage.id > quoted.id,
            ).order_by(WaMessage.id).limit(1)
        )
        return nxt if nxt is not None and nxt.ref_type else quoted
    if quoted is None or not quoted.ref_type or not quoted.ref_type.startswith(_REPLY_PREFIX):
        return quoted
    original = await db.scalar(
        select(WaMessage).where(
            WaMessage.user_id == user_id,
            WaMessage.ref_type == quoted.ref_type[len(_REPLY_PREFIX):],
            WaMessage.ref_id == quoted.ref_id,
        ).order_by(WaMessage.id.desc()).limit(1)
    )
    # Ya deshecho: la fila original perdió su ref. Se devuelve la respuesta
    # tal cual, y el que llama encuentra que la entidad ya no está.
    return original or quoted


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
    quoted = await _quoted_ref(db, user_id, quoted_wa_id)
    if quoted and quoted.ref_type in types:
        return quoted
    if quoted and (quoted.ref_type or "").startswith(_REPLY_PREFIX):
        # Citó la confirmación de algo que ya se deshizo: corregir otra cosa
        # en su lugar sería peor que decir que no está.
        return None
    return await db.scalar(q.order_by(WaMessage.id.desc()).limit(1))


async def _open_pending(db: AsyncSession, user_id: int) -> WaMessage | None:
    # Las filas de `link_replies` (respuestas ya enviadas, para poder citarlas)
    # no son un mensaje nuevo: si contaran, quedarían después de la pregunta y
    # la cerrarían. Pasaba con "¿Le agregás una descripción?", que sale junto
    # con un gasto recién cargado: la descripción no se tomaba nunca.
    return await db.scalar(
        select(WaMessage).where(
            WaMessage.user_id == user_id,
            WaMessage.pending.is_not(None),
            WaMessage.created_at >= _cutoff(),
            or_(WaMessage.ref_type.is_(None), ~WaMessage.ref_type.startswith(_REPLY_PREFIX)),
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
        if _is_employee(user) and inbound.kind not in ("text", "audio"):
            # Un PDF es un resumen o un comprobante de pago: cosa de los dueños.
            # Un audio termina siendo texto, con los mismos límites que el escrito.
            _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id)
            _remember(db, user.id, "out", "text", text=MSG_EMPLOYEE_ONLY)
            await db.commit()
            return [MSG_EMPLOYEE_ONLY]
        if inbound.kind == "pdf":
            return await _handle_pdf(db, user, inbound)
        if inbound.kind == "image" and ai_capture.enabled():
            return await _handle_image(db, user, inbound)
        if inbound.kind == "audio" and transcribe.enabled():
            return await _handle_audio(db, user, inbound)
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
# El link inicia la sesión solo durante 15 minutos (`auth_links`): el aviso
# es para quien lo abre más tarde.
LINK_HINT = "Si lo abrís más tarde y te pide iniciar sesión, usá *Abrir en el navegador* desde el menú."


def _fmt_total(totals: dict | None, cur: str, key: str) -> str:
    raw = ((totals or {}).get(cur) or {}).get(key)
    return _money(Decimal(raw), cur) if raw else "-"


# Lo que dice cada grupo de la conciliación, en singular y plural: antes de
# corregir (lo que se encontró) y después (lo que se hizo).
_GROUP_FOUND = {
    "dates": ("fecha del resumen para completar", "fechas del resumen para completar"),
    "missing": ("consumo que falta", "consumos que faltan"),
    "double_count": ("consumo cargado dos veces", "consumos cargados dos veces"),
    "amount_diff": ("monto distinto", "montos distintos"),
    "usd_fix": ("consumo en dólares mal marcado", "consumos en dólares mal marcados"),
    "rounding": ("diferencia de centavos", "diferencias de centavos"),
    "surplus": ("consumo que no está en el resumen", "consumos que no están en el resumen"),
}
_GROUP_DONE = {
    "dates": ("fecha completada", "fechas completadas"),
    "missing": ("consumo cargado", "consumos cargados"),
    "double_count": ("doble carga corregida", "dobles cargas corregidas"),
    "amount_diff": ("monto corregido", "montos corregidos"),
    "usd_fix": ("consumo en dólares corregido", "consumos en dólares corregidos"),
    "rounding": ("redondeo corregido", "redondeos corregidos"),
    "surplus": ("consumo de más borrado", "consumos de más borrados"),
}


def _groups_text(counts: dict[str, int], labels: dict[str, tuple[str, str]]) -> str:
    return " · ".join(
        f"{n} {labels.get(k, (k, k))[0 if n == 1 else 1]}" for k, n in counts.items()
    )


MSG_PDF_PASSWORD = (
    "El PDF tiene contraseña. Mandámela en un mensaje y lo abro "
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
        return ["No pude bajar el PDF. Mandalo de nuevo."]

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
    hints = quick_capture.caption_hints(inbound.text)
    if pdf_lines and not is_statement:
        receipt = parse_transfer_receipt(pages)
        if receipt is None:
            # WARNING a propósito: llega a app_logs (que sólo guarda WARNING+)
            # y dice por qué no matcheó — sin este rastro, "me ofreció el plan"
            # no se puede distinguir de un deploy que no llegó.
            from app.services.transfer_receipt import diagnose

            logger.warning("WA receipt sin match: %s", diagnose(pages))
        if receipt is not None and (receipt.direction == "in" or hints.kind == "income"):
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
                    hints.when or receipt.receipt_date, receipt.counterparty, note=hints.note,
                )
            who = f" de {receipt.counterparty}" if receipt.counterparty else ""
            reply = (
                f"Es el comprobante de una transferencia que *recibiste* "
                f"({_fmt_amount(receipt)}{who}). No lo cargo: en el negocio, "
                "lo que entra sale de las ventas."
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
                expense_date=hints.when or receipt.receipt_date or ar_today(),
                term=receipt.counterparty or "Transferencia",
                legacy=False,
                description=hints.note,
            )
            method = "transferencia" if receipt.kind == "transferencia" else None
            if await _is_own_name(db, user, receipt.counterparty):
                # Con un comentario ya dijo qué es: se carga, pero su nombre no es el comercio.
                if hints.kind != "expense" and not inbound.text.strip():
                    return await _ask_own_transfer(db, user, inbound, draft, method)
                draft.term = "Transferencia"
            return await _capture_draft(db, user, inbound, draft, payment_method=method)

    # Ni resumen conocido ni comprobante que el código lea (o un PDF escaneado,
    # sin texto): lo lee la IA. Si resulta ser un resumen, o la IA no pudo,
    # sigue a la conciliación, que explica el motivo como siempre.
    if not is_statement and ai_capture.enabled():
        inbound = await _claim_inbound(db, user, inbound)
        handled = await _read_with_ai(db, user, inbound, pdf, doc_text="\n".join(pages))
        if handled is not None:
            return handled

    # La sesión puede llamar a la IA (categorías de los faltantes), que tarda:
    # el mensaje se registra antes, así un reintento del webhook no arma otra.
    inbound = await _claim_inbound(db, user, inbound)
    session = await reconcile_service.start_session(
        db, user=user, pdf_bytes=pdf, channel="whatsapp"
    )
    ai_read = False
    if session.status == "needs_ai" and session.reason in _AI_STATEMENT_REASONS:
        retried = await _statement_with_ai(db, user, session, pdf, "\n".join(pages))
        if retried is not None:
            session, ai_read = retried, True

    if session.status == "needs_ai":
        reply = {
            "no_parser": "No conozco los resúmenes de este banco todavía.",
            "totals_mismatch": "Leí el resumen pero las sumas no me dan con los totales del banco, así que prefiero no tocar nada.",
            "encrypted": "El PDF tiene contraseña. Descargalo sin contraseña y volvé a mandarlo.",
            "no_text": "No pude extraer texto del archivo.",
            "no_items": "Reconocí el resumen pero no encontré ningún consumo adentro, así que prefiero no tocar nada.",
        }.get(session.reason or "", "No pude leer el resumen.")
        if ai_read or ai_capture.enabled():
            if session.reason != "encrypted":
                reply += "\nProbé leerlo con IA y tampoco me cerró. Los consumos los podés cargar en la app, o contármelos de a uno."
            _remember(db, user.id, "out", "text", text=reply, ref_type="reconcile", ref_id=session.id)
            await db.commit()
            return [reply]
        if session.reason != "encrypted":
            # A un PDF protegido no lo arregla ningún plan: le falta la contraseña.
            reply += (
                "\n\nLeerlo con IA va a ser parte del plan Pro. Si te sirve, respondé *me interesa*."
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
        f"Leí tu resumen {session.parsed.get('bank') or ''} de {session.period_month:02d}/{session.period_year}.".replace("  ", " "),
        f"El banco dice {parsed_total} y acá tenés {app_total} (diferencia: {diff}).",
    ]
    if ai_read:
        lines.insert(1, "Este banco no lo conocía, así que lo leí con IA. Los totales cierran con los del PDF.")
    if (session.totals or {}).get("USD"):
        lines.append(
            f"En dólares, el banco dice {_fmt_total(session.totals,'USD','bank_total')} "
            f"y acá tenés {_fmt_total(session.totals,'USD','app_total')}."
        )
    if session.status == "unexplained":
        lines.append("⚠️ La diferencia no se explica al centavo. Mejor revisalo en la app.")
    if groups:
        lines.append(f"Encontré: {_groups_text(groups, _GROUP_FOUND)}")
        lines.append("")
        lines.append("1. Corregir todo\n2. Nada, lo reviso en la app")
        pending = {"type": "reconcile_apply", "session_id": session.id}
    else:
        lines.append("✅ Está todo igual que en el banco.")
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
    amount: Decimal, currency: str, when, counterparty: str | None, note: str | None = None,
) -> list[str]:
    """Una transferencia que entró (comprobante en PDF o captura) → ingreso.
    El término es quien la mandó: así la regla que deja la respuesta ("de Juan
    Pérez" → Alquiler) hace que la próxima de esa persona no pregunte."""
    draft = quick_capture.QuickDraft(
        amount=amount, currency=currency, expense_date=when or ar_today(),
        term=(counterparty or "").strip(), legacy=False,
    )
    notes = note or (f"Transferencia de {counterparty}" if counterparty else "Transferencia recibida")
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
    "No encontré un pago en lo que me mandaste.\n"
    "Si es un comprobante, probá con una foto más nítida o con el *PDF*, "
    "o escribilo: *15000 transferencia juan*."
)
MSG_AI_STATEMENT_IMAGE = (
    "Parece el resumen de una tarjeta. Mandámelo en *PDF* (el que bajás "
    "del home banking) y dejo tus datos al día."
)
MSG_AI_LIMIT = (
    "Por hoy llegué al máximo de comprobantes que puedo leer. "
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
        return ["No pude bajar la imagen. Mandala de nuevo."]
    inbound = await _claim_inbound(db, user, inbound)
    return await _read_with_ai(db, user, inbound, data) or [MSG_AI_UNREADABLE]


async def _read_with_ai(
    db: AsyncSession, user: User, inbound: InboundMessage, data: bytes, doc_text: str | None = None,
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
        income_fields=await _income_field_names(db, user),
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
    if doc_text:
        await bot_cases.record(db, bot_cases.KIND_DOC_AI, doc_text, {"read_as": reading.kind})

    # Lo que la persona escribió junto al archivo le gana a lo que se leyó:
    # "registrá este ingreso con fecha 1/11" es un pedido, no un comentario.
    hints = quick_capture.caption_hints(inbound.text)
    if hints.kind == "income" and reading.kind == ai_capture.KIND_EXPENSE:
        reading.kind = ai_capture.KIND_INCOMING
    if hints.when:
        reading.receipt_date = hints.when

    if reading.kind == ai_capture.KIND_STATEMENT:
        return None if is_pdf else await reply_with(MSG_AI_STATEMENT_IMAGE)
    if reading.kind == ai_capture.KIND_BILL and reading.amount and reading.amount <= quick_capture.MAX_AMOUNT:
        return await _handle_bill(db, user, inbound, reading, cats)
    if reading.kind in (ai_capture.KIND_INCOMING, ai_capture.KIND_PAYSLIP) and reading.amount \
            and reading.amount <= quick_capture.MAX_AMOUNT and not await _is_business(db, user):
        if reading.kind == ai_capture.KIND_PAYSLIP:
            draft = quick_capture.QuickDraft(
                amount=reading.amount, currency=reading.currency,
                expense_date=reading.receipt_date or ar_today(),
                term=reading.merchant or "Sueldo", legacy=False,
            )
            return await _capture_income(
                db, user, inbound, draft, notes=reading.merchant or None, lines=reading.lines,
            )
        return await _capture_incoming(
            db, user, inbound, reading.amount, reading.currency, reading.receipt_date, reading.merchant,
            note=hints.note,
        )
    if reading.kind == ai_capture.KIND_INCOMING:
        who = f" de {reading.merchant}" if reading.merchant else ""
        if await _is_business(db, user):
            amount = f" ({_fmt_amount(reading)})" if reading.amount else ""
            return await reply_with(
                f"Es una transferencia que *recibiste*{amount}{who}. No la cargo: "
                "en el negocio, lo que entra sale de las ventas."
            )
        # En un hogar llega acá sólo sin un monto que se pueda usar.
        return await reply_with(
            f"Es una transferencia que *recibiste*{who}, pero no pude leer bien el monto. "
            "Escribilo así: *cobré 30 lucas alquiler*."
        )
    if (
        reading.kind != ai_capture.KIND_EXPENSE
        or reading.amount is None
        or reading.amount > quick_capture.MAX_AMOUNT
    ):
        return None if is_pdf else await reply_with(MSG_AI_UNREADABLE)
    draft = quick_capture.QuickDraft(
        amount=reading.amount,
        currency=reading.currency,
        expense_date=reading.receipt_date or ar_today(),
        term=reading.merchant or reading.category or "Comprobante",
        legacy=False,
        description=hints.note,
        # Un consumo con tarjeta va a la tarjeta: como gasto simple se duplicaba
        # el día que llega el resumen. Cargado ahí, el resumen lo encuentra.
        wants_card=reading.payment_method == "tarjeta_credito",
    )
    suggested = next(
        (c for c in cats if reading.category and fold_text(c.name) == fold_text(reading.category)),
        None,
    )
    method = reading.payment_method if reading.payment_method in ("efectivo", "debito", "transferencia") else None
    if hints.kind != "expense" and await _is_own_name(db, user, reading.merchant):
        return await _ask_own_transfer(db, user, inbound, draft, method)
    return await _capture_draft(db, user, inbound, draft, payment_method=method, suggested=suggested)


async def _handle_bill(
    db: AsyncSession, user: User, inbound: InboundMessage, reading, cats
) -> list[str]:
    """Una factura de un servicio no se carga sola: con débito automático la
    plata sale por la tarjeta, y el ítem que la persona carga ahí la
    duplicaría. Si el comercio ya se cargó en una tarjeta, se ofrece ponerla
    en el resumen que sigue; si no, se pregunta cómo se paga. Lo que no se
    resuelve con un número va a la app con el formulario ya lleno."""
    from app.models.credit_card import CreditCard, CreditCardStatement
    from app.services import bill_capture
    from app.services.currency import estimate_due_date_py
    from app.services.search import fold_text

    today = ar_today()
    merchant = reading.merchant or ""
    head = f"Es la factura de *{merchant or 'un servicio'}* por {_fmt_amount(reading)}"
    if reading.due_date:
        head += f", vence el {reading.due_date:%d/%m}"
    if reading.auto_debit:
        head += ", con débito automático"
    head += "."
    suggested = next(
        (c for c in cats if reading.category and fold_text(c.name) == fold_text(reading.category)),
        None,
    )
    target = await bill_capture.card_target(
        db, user.tenant_id, merchant, reading.amount, reading.due_date or reading.receipt_date or today,
    )

    if target is not None and target.already_loaded:
        reply = f"{head}\nYa está cargada en la tarjeta *{target.card_label}*, así que no la cargo de nuevo."
        _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id)
        _remember(db, user.id, "out", "text", text=reply)
        await db.commit()
        return [reply]

    if target is not None:
        stmt = await db.scalar(select(CreditCardStatement).where(
            CreditCardStatement.card_id == target.card_id,
            CreditCardStatement.year == target.year,
            CreditCardStatement.month == target.month,
        ))
        card = await db.get(CreditCard, target.card_id)
        # El vencimiento que imprimió la factura le gana al estimado del
        # resumen (el día de `due_day` es una aproximación; el mes no está en
        # duda). Nunca pisa uno real, y sólo si cae en el mismo mes que el
        # estimado: otro mes es otra cosa (una factura que no es de esa tarjeta).
        estimate = estimate_due_date_py(target.year, target.month, card.due_day)
        bill_due = (
            reading.due_date
            if reading.due_date and (reading.due_date.year, reading.due_date.month) == (estimate.year, estimate.month)
            else None
        )
        due = stmt.due_date if stmt and stmt.due_date else bill_due or estimate
        period = bill_capture.period_label(target.year, target.month, today)
        reply = (
            f"{head}\nVenís cargando *{target.description}* en la tarjeta *{target.card_label}*.\n"
            f"1. Cargarla en el resumen de {period} (vence el {due:%d/%m})\n"
            "2. Ya está en la tarjeta, no la cargo\n"
            "3. Revisarla en la app"
        )
        pending = {
            "type": "bill_card", "card_id": target.card_id, "year": target.year, "month": target.month,
            "date": target.item_date.isoformat(), "desc": target.description,
            "cat": target.category_id, "amount": str(reading.amount), "currency": reading.currency,
            "label": target.card_label,
            "due": bill_due.isoformat() if bill_due and not (stmt and stmt.due_date) else None,
        }
    else:
        draft = quick_capture.QuickDraft(
            amount=reading.amount, currency=reading.currency,
            expense_date=reading.receipt_date or today,
            term=merchant or reading.category or "Factura", legacy=False,
        )
        reply = (
            f"{head}\n¿Cómo la pagás?\n"
            "1. Ya la pagué con débito o transferencia: cargarla como gasto\n"
            "2. Se debita de una tarjeta: cargarla en la app\n"
            "3. Todavía no la pagué: no la cargo"
        )
        pending = {"type": "bill_pick", "draft": _draft_dict(draft), "cat": suggested.id if suggested else None}

    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id)
    _remember(db, user.id, "out", "text", text=reply, pending=pending)
    await db.commit()
    return [reply]


async def _expense_form_link(db: AsyncSession, user, prefill: dict) -> str:
    """Link a "Nuevo egreso" con el formulario ya lleno (`/expenses?nuevo=1&…`)
    y auto-login: lo que el chat no resuelve se termina ahí."""
    from urllib.parse import urlencode

    from app.services import auth_links

    token = await auth_links.mint_token(db, user.id)
    query = urlencode({"nuevo": "1", **{k: v for k, v in prefill.items() if v not in (None, "")}, "wat": token})
    return f"{settings.FRONTEND_URL}/expenses?{query}"


async def _answer_bill(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, number: int
) -> list[str]:
    from app.models.credit_card import CreditCard
    from app.schemas.credit_card import CreditCardItemCreate
    from app.services import auth_links, bill_capture
    from app.services.credit_cards import create_item_in_statement, find_or_create_statement

    pending = row.pending or {}
    if not (1 <= number <= 3):
        return ["Respondé *1*, *2* o *3*."]
    row.pending = None

    async def reply(text: str, **ref) -> list[str]:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text, **ref)
        await db.commit()
        return [text]

    if pending["type"] == "bill_pick":
        draft = _draft_from_dict(pending["draft"])
        if number == 1:
            cat = await db.get(ExpenseCategory, pending["cat"]) if pending.get("cat") else None
            if cat is not None and cat.tenant_id != user.tenant_id:
                cat = None
            return await _capture_draft(db, user, inbound, draft, suggested=cat)
        if number == 3:
            return await reply("Listo, no la cargo. Cuando la pagues, mandame el comprobante.")
        link = await _expense_form_link(db, user, {
            "monto": str(draft.amount), "moneda": draft.currency, "desc": draft.term,
            "fecha": draft.expense_date.isoformat(), "cat": pending.get("cat"), "pago": "tarjeta",
        })
        return await reply(f"Elegí la tarjeta y el resumen acá, ya está todo lo demás: {link}\n{LINK_HINT}")

    # bill_card
    if number == 2:
        return await reply("Listo, no la cargo.")
    if number == 3:
        link = await _expense_form_link(db, user, {
            "monto": pending["amount"], "moneda": pending["currency"], "desc": pending["desc"],
            "fecha": pending["date"], "cat": pending.get("cat"), "pago": "tarjeta",
            "tarjeta": pending["card_id"], "periodo": f"{pending['year']}-{pending['month']:02d}",
        })
        return await reply(f"Revisala acá, ya está todo cargado: {link}\n{LINK_HINT}")

    card = await db.get(CreditCard, pending["card_id"])
    if card is None or card.tenant_id != user.tenant_id:
        return await reply("Esa tarjeta ya no está. Cargala desde la app.")
    from datetime import date as _date

    stmt = await find_or_create_statement(card, pending["year"], pending["month"], user.tenant_id, db)
    item = await create_item_in_statement(stmt, card, CreditCardItemCreate(
        description=pending["desc"], category_id=pending.get("cat"),
        item_date=_date.fromisoformat(pending["date"]), item_type="single",
        amount=Decimal(pending["amount"]), currency=pending["currency"],
    ), user, db)
    item.capture_source = "whatsapp"
    due_line = ""
    if pending.get("due") and stmt.due_date is None:
        stmt.due_date = _date.fromisoformat(pending["due"])
        due_line = f"\nEl resumen vence el {stmt.due_date:%d/%m}, como dice la factura."
    await db.flush()
    token = await auth_links.mint_token(db, user.id)
    link = f"{settings.FRONTEND_URL}/tarjetas/{card.id}/{stmt.id}?item={item.id}&wat={token}"
    period = bill_capture.period_label(stmt.year, stmt.month, ar_today())
    return await reply(
        f"✅ {_money(item.amount, item.currency)} · {item.description} · resumen de {period} de *{pending['label']}*"
        f"{due_line}\nSi algo está mal: *deshacer*, o corregilo acá: {link}",
        ref_type="card_item", ref_id=item.id,
    )


async def _handle_audio(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    """Un audio es un mensaje de texto que hay que escuchar primero. Tarda unos
    segundos, así que la t con auriculares avisa enseguida que llegó.

    El registro lleva el prefijo de las respuestas por lo mismo que ellas: una
    fila común cerraría la pregunta abierta, y contestarla es un uso normal de un
    audio. Los rechazos tampoco guardan nada, así esa pregunta sigue en pie."""
    from app.services import rate_limit
    from app.services.whatsapp import download_media_base64, send_wa_sticker

    _remember(db, user.id, "in", "audio", wa_id=inbound.wa_id, ref_type=f"{_REPLY_PREFIX}audio")
    await db.commit()

    async def give_up(reason: str, reply: str) -> list[str]:
        await record_event(
            db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
            input_kind="audio", outcome="audio_failed", reason=reason,
        )
        await db.commit()
        return [reply]

    if (inbound.media_seconds or 0) > settings.WA_AUDIO_MAX_SECONDS:
        return await give_up("too_long", MSG_AUDIO_TOO_LONG.format(minutes=settings.WA_AUDIO_MAX_SECONDS // 60))
    if not rate_limit.check(f"wa_audio:{user.tenant_id}", settings.WA_AUDIO_DAILY_LIMIT, 86400):
        return await give_up("limit", MSG_AUDIO_LIMIT)
    # En paralelo: la transcripción no tiene por qué esperar al sticker. Se espera
    # antes de contestar, para que nunca llegue después de la respuesta.
    listening = asyncio.create_task(
        send_wa_sticker(inbound.phone, sticker_url("escuchando")) if settings.WA_STICKERS_ENABLED else asyncio.sleep(0)
    )
    await asyncio.sleep(0)
    data = await download_media_base64(inbound.media_key, inbound.raw_message)
    text = await transcribe.transcribe(data) if data is not None else None
    await listening
    if data is None:
        return await give_up("download", "No pude bajar el audio. Mandalo de nuevo.")
    if text is None:
        return await give_up("service", MSG_AUDIO_DOWN)
    if not text:
        return await give_up("empty", MSG_AUDIO_EMPTY)

    await record_event(
        db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
        input_kind="audio", outcome="audio_ok",
    )
    await db.commit()
    replies = await _handle_text(db, user, replace(inbound, kind="text", text=text, wa_id=None))
    return [_with_audio_undo(r) for r in replies]


_SMALL_AMOUNT_RE = re.compile(r"^✅ \$(\d{1,2}) ")


def _with_audio_undo(reply: str) -> str:
    """Con un audio, cómo deshacer se dice siempre y no sólo en las primeras cargas
    (`_show_hints`): un monto mal oído no da error, y sólo se ve en esta respuesta."""
    if not reply.startswith("✅"):
        return reply
    if "deshacer" not in reply:
        reply = f"{reply}\nSi escuché mal, respondé *deshacer*."
    # "35 en regalos": nadie gasta $35, lo más probable es que se haya perdido el "mil".
    small = _SMALL_AMOUNT_RE.match(reply)
    if small:
        reply = f"{reply}\n⚠️ Si eran ${small.group(1)}.000, decime *eran {small.group(1)} mil*."
    return reply


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
        return ["No pude volver a bajar el PDF. Mandalo de nuevo."]
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

    handled = await _do_cancel_draft(db, user, inbound, text)
    if handled is not None:
        return handled

    if _UNDO_RE.match(text):
        return await _do_undo(db, user, inbound)
    two = _TWO_FIELDS_RE.match(text)
    if two and two.group(1)[0].lower() != two.group(3)[0].lower():
        first = await _do_edit(db, user, inbound, two.group(1).lower(), two.group(2).strip())
        return first + await _do_edit(db, user, replace(inbound, wa_id=None), two.group(3).lower(), two.group(4).strip())
    edit = _EDIT_RE.match(text)
    if edit:
        return await _do_edit(db, user, inbound, edit.group(1).lower(), edit.group(2).strip())
    short = _CATEGORY_RE.match(text)
    if short:
        return await _do_edit(db, user, inbound, short.group(1).lower(), short.group(2).strip())
    handled = await _do_quoted_category(db, user, inbound, text)
    if handled is not None:
        return handled
    handled = await _do_quick_fix(db, user, inbound, text)
    if handled is not None:
        return handled
    if _INTEREST_RE.match(text):
        return await _do_interest(db, user, inbound)
    num = _NUMBER_RE.match(text)
    if num:
        handled = await _do_pending_answer(db, user, inbound, int(num.group(1)))
        if handled is not None:
            return handled

    handled = await _do_pending_words(db, user, inbound, text)
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

    handled = await _do_small_talk(db, user, inbound, text)
    if handled is not None:
        return handled

    if _is_employee(user):
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        _remember(db, user.id, "out", "text", text=MSG_EMPLOYEE_ONLY)
        await db.commit()
        return [MSG_EMPLOYEE_ONLY]

    handled = await _do_correction(db, user, inbound, text)
    if handled is not None:
        return handled

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
        handled, inbound = await _interpret(db, user, inbound)
        if handled is not None:
            return handled
        await bot_cases.record(db, bot_cases.KIND_TEXT_UNRESOLVED, inbound.text)
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

_CANCEL_WORDS = {"no", "cancelar", "cancela", "dejalo", "dejala", "nada", "esta mal"}


async def _do_income(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str] | None:
    draft = income_capture.parse_income_text(inbound.text)
    if draft is None or await _is_business(db, user):
        return None
    return await _capture_income(db, user, inbound, draft)


async def _income_field_names(db: AsyncSession, user: User) -> dict[str, list[str]]:
    """{fuente: [campos activos]} del hogar, para que la IA pueda señalar en qué
    campo va cada concepto de un recibo de sueldo. Vacío en un negocio."""
    if await _is_business(db, user):
        return {}
    rows = (await db.execute(
        select(IncomeSource.name, IncomeSourceField.name)
        .join(IncomeSourceField, IncomeSourceField.source_id == IncomeSource.id)
        .where(
            IncomeSource.tenant_id == user.tenant_id,
            IncomeSource.is_active.is_(True),
            IncomeSource.system_key.is_(None),
            IncomeSourceField.is_active.is_(True),
        )
        .order_by(IncomeSource.id, IncomeSourceField.position, IncomeSourceField.id)
    )).all()
    out: dict[str, list[str]] = {}
    for source_name, field_name in rows:
        out.setdefault(source_name, []).append(field_name)
    return out


async def _capture_income(
    db: AsyncSession,
    user: User,
    inbound: InboundMessage,
    draft: quick_capture.QuickDraft,
    *,
    notes: str | None = None,
    refund: bool = False,
    lines: list[ai_capture.PayslipLine] | None = None,
) -> list[str]:
    """Resolver la fuente, preguntar si hace falta, guardar y responder.
    `refund` = plata que entró por una transferencia: puede ser alguien
    devolviendo su parte de un gasto compartido, que la app a propósito no
    registra (la tenencia y los gastos ya son netos), así que la pregunta
    ofrece no cargarla."""
    sources = await income_capture.writable_sources(db, user.tenant_id)
    source = await income_capture.resolve_source(db, user.tenant_id, draft.term, sources)
    # "fuente otros": la nombró a propósito, así que no hay nada que preguntar.
    if source is None and draft.category_name and _looks_like_name(draft.category_name):
        source = await income_capture.create_source(db, user.tenant_id, draft.category_name)
    if source is not None:
        return await _save_income(db, user, inbound, draft, source, notes, lines)

    options = [s.name for s in sources][: income_capture.MAX_OPTIONS]
    new_name = draft.term if draft.term and income_capture.match_by_name(sources, draft.term) is None else None
    choices = _income_choices(options, new_name, refund)
    who = f" de *{draft.term}*" if draft.term else ""
    if choices:
        listed = "\n".join(f"{i + 1}. {label}" for i, (_k, label) in enumerate(choices))
        reply = (
            f"Entraron {_fmt_amount(draft)}{who}. ¿De qué fuente es?\n{listed}\n"
            "Decime el número o el nombre. Si es otra, la creo."
        )
    else:
        reply = (
            f"Entraron {_fmt_amount(draft)}. ¿De qué son? Decime de dónde "
            "(sueldo, alquiler, un cliente…) y la creo."
        )
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
    _remember(db, user.id, "out", "text", text=reply, pending={
        "type": "income_pick", "draft": _draft_dict(draft), "options": options,
        "new": new_name, "refund": refund, "notes": notes,
        # El detalle del recibo viaja con la pregunta: se carga en los campos
        # de la fuente que se elija al contestar.
        "lines": [line.to_dict() for line in lines or []],
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
        return await _cancel_income(db, user, inbound, row, "No lo cargo: un reintegro no es un ingreso.")
    sources = await income_capture.writable_sources(db, user.tenant_id)
    if kind == "new":
        name = pending["new"]
        source = income_capture.match_by_name(sources, name) or await income_capture.create_source(
            db, user.tenant_id, name
        )
    else:
        source = income_capture.match_by_name(sources, label)
        if source is None:
            return ["Esa fuente ya no existe. Respondé con el nombre de otra."]
    return await _income_from_pending(db, user, inbound, row, source)


async def _do_pending_income_by_name(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage | None = None,
) -> list[str] | None:
    """La pregunta de fuente también acepta el nombre escrito, y uno que no
    existe crea la fuente (la pregunta lo avisa). Un texto con números es otra
    cosa — un gasto o un ingreso nuevo — y sigue su camino."""
    row = row or await _open_pending(db, user.id)
    if row is None or (row.pending or {}).get("type") != "income_pick":
        return None
    from app.services.search import fold_text

    text = inbound.text.strip()
    if fold_text(text) in _CANCEL_WORDS:
        return await _cancel_income(db, user, inbound, row, "Listo, no lo cargo.")
    if not _looks_like_name(text):
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
    lines = [ai_capture.PayslipLine.from_dict(d) for d in pending.get("lines") or []]
    return await _save_income(db, user, inbound, draft, source, pending.get("notes"), lines)


async def _save_income(
    db: AsyncSession,
    user: User,
    inbound: InboundMessage,
    draft: quick_capture.QuickDraft,
    source: IncomeSource,
    notes: str | None,
    payslip_lines: list[ai_capture.PayslipLine] | None = None,
) -> list[str]:
    from app.services.search import fold_text

    if notes is None:
        notes = draft.description
    if notes is None and draft.term and fold_text(draft.term) != fold_text(source.name):
        notes = draft.term
    entry = await income_capture.create_income(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft, source=source, notes=notes,
    )
    filled: list[str] = []
    has_fields = False
    if payslip_lines:
        filled, has_fields = await income_capture.apply_payslip_lines(db, entry, payslip_lines)
    dupes = await income_capture.same_month(db, entry)
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None,
              ref_type="income", ref_id=entry.id)
    await db.commit()

    when = "" if entry.period_date == ar_today() else f", del {entry.period_date.strftime('%d/%m')}"
    lines = [f"✅ Ingreso de {_fmt_amount(draft)} en {source.name}{when}."]
    if filled:
        lines.append(f"Del recibo completé {_join_names(filled)}.")
    elif has_fields:
        lines.append(f"No encontré en el recibo los campos de «{source.name}»: el detalle lo completás en la app.")
    if dupes:
        listed = ", ".join(_fmt_amount(d) for d in dupes[:3])
        lines.append(
            f"⚠️ Ya había {'otro ingreso' if len(dupes) == 1 else f'{len(dupes)} ingresos'} "
            f"de «{source.name}» en {entry.period_date.strftime('%m/%Y')} ({listed}). "
            "Si es el mismo, respondé *deshacer*."
        )
    elif await _show_hints(db, user.id):
        # Con detalle, la fuente y el monto se corrigen en la app (`_edit_income`).
        lines.append("Si algo quedó mal, decime *deshacer*." if filled else "Si algo quedó mal, decime *deshacer* o *fuente* y el nombre.")
    return ["\n".join(lines)]


_NO_WORDS = {"no", "n", "nop", "no gracias", "listo", "ok", "asi esta", "dejalo", "dejala", "nada", "asi"}


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
        return ["Quedó así."]

    # Un número pelado no es una descripción (es alguien contestando una
    # pregunta que ya no existe) — que siga su camino y la oferta siga viva.
    if _NUMBER_RE.match(inbound.text):
        return None

    if quick_capture.parse_quick_text(inbound.text) is not None:
        row.pending = None  # vino otro gasto: la oferta caduca sola
        await db.flush()
        return None

    entry = await db.get(ExpenseEntry, (row.pending or {}).get("entry_id"))
    # El nombre exacto de otra categoría no es una descripción: es quien vio
    # "(sugerida)" y la quiere cambiar. Guardarlo como descripción dejaba la
    # categoría equivocada y la persona sin entender por qué.
    if entry is not None and entry.tenant_id == user.tenant_id:
        cats = (await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
        )).all()
        cat = next((c for c in cats if fold_text(c.name) == fold_text(inbound.text)), None)
        if cat is not None and cat.id != entry.category_id:
            ref = await db.scalar(
                select(WaMessage).where(
                    WaMessage.user_id == user.id, WaMessage.ref_type == "expense",
                    WaMessage.ref_id == entry.id,
                ).order_by(WaMessage.id.desc()).limit(1)
            )
            if ref is not None:
                row.pending = None
                replies = await _recategorize(db, user, inbound, ref, entry, cat.name)
                # Cambiar la categoría no contesta qué fue: lo siguiente sigue siendo la descripción.
                _remember(db, user.id, "out", "text", pending={"type": "description_offer", "entry_id": entry.id})
                await db.commit()
                return replies

    row.pending = None
    if entry is None or entry.tenant_id != user.tenant_id:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Ese gasto ya no está, no cambié nada."]
    term = entry.description
    entry.description = _DESCRIPTION_LEAD_RE.sub("", inbound.text.strip())[:255]
    await _learn_description(db, user.tenant_id, term, entry)
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    return [f"✏️ Listo: {_money(entry.amount, entry.currency)} en {entry.description}."]


async def _learn_description(db: AsyncSession, tenant_id: int, term: str | None, entry: ExpenseEntry) -> None:
    """La misma descripción dos veces para el mismo comercio se vuelve la de ese
    comercio: en una semana se escribieron unas 15 a mano, y varias repetidas. Una
    sola vez no alcanza: la del primer gasto no tiene por qué valer para el próximo."""
    from app.services.reconcile import rules as capture_rules
    from app.services.search import fold_text

    if not term or entry.currency == "USD":
        return
    key = capture_rules.merchant_key(term)
    rules = await capture_rules.get_rules(db, tenant_id, capture_rules.KIND_MERCHANT_CATEGORY)
    payload = dict(rules.get(key) or {})
    if fold_text(payload.get("last_description") or "") == fold_text(entry.description):
        payload["description"] = entry.description
        payload.setdefault("category_id", entry.category_id)
    payload["last_description"] = entry.description
    await capture_rules.save_rule(db, tenant_id, capture_rules.KIND_MERCHANT_CATEGORY, key, payload)


async def _do_pending_category_by_name(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage | None = None,
) -> list[str] | None:
    """La pregunta de categoría acepta el nombre escrito ("súper"), entero o una
    parte si es de una sola. Un nombre que no existe la crea: la pregunta lo
    promete, y antes caía a la ayuda (caso real: "Limpieza", tres veces). Lo que
    no parece un nombre (trae números o es una frase) sigue su camino: puede ser
    un gasto nuevo."""
    row = row or await _open_pending(db, user.id)
    if row is None:
        return None
    pending = row.pending or {}
    if pending.get("type") not in ("category_pick", "category_name"):
        return None

    from app.services.search import fold_text

    text = (inbound.text or "").strip()
    asked_new = _NEW_CATEGORY_RE.match(text)
    name = asked_new.group(1).strip() if asked_new else text
    # Antes de buscar: "está mal, te digo que recibí un reintegro de 780" contiene
    # el nombre de una categoría, y se cargaba ahí el gasto que estaba corrigiendo.
    if not asked_new and not _looks_like_name(name):
        return None
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )).all()
    cat, candidates = _match_name(cats, name)
    if cat is None and candidates and not asked_new:
        listed = "\n".join(f"{i + 1}. {c}" for i, c in enumerate(candidates))
        reply = f"¿Cuál de estas?\n{listed}"
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        _remember(db, user.id, "out", "text", text=reply, pending={**pending, "type": "category_pick", "options": candidates})
        await db.commit()
        return [reply]
    created = False
    if cat is None:
        if not _looks_like_name(name):
            return None
        cat = await _create_category(db, user.tenant_id, name)
        created = True
    return await _create_from_pending(db, user, inbound, row, cat, created=created)


def _looks_like_name(text: str) -> bool:
    """Un nombre de categoría o de fuente, no una frase ni un monto."""
    from app.services.search import fold_text

    text = (text or "").strip()
    return (
        bool(text) and len(text) <= 40 and len(text.split()) <= 4
        and not any(ch.isdigit() or ch == "?" for ch in text)
        and fold_text(text) not in _SMALL_TALK and fold_text(text) not in _ASK_HELP
    )


async def _create_category(db: AsyncSession, tenant_id: int, name: str) -> ExpenseCategory:
    import random

    name = name.strip()
    existing = await expenses_service.find_category_by_name(db, tenant_id, name)
    if existing:
        return existing
    cat = ExpenseCategory(
        tenant_id=tenant_id, name=name[0].upper() + name[1:],
        color=random.choice(quick_capture.CATEGORY_COLORS), is_fixed=False,
    )
    db.add(cat)
    await db.flush()
    return cat


async def _create_from_pending(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, cat: ExpenseCategory,
    created: bool = False,
) -> list[str]:
    """La respuesta a la pregunta de categoría: crea el gasto que la esperaba,
    con lo que traía colgado (en un negocio, el stock de una compra y el
    proveedor o empleado)."""
    raw = (row.pending or {}).get("draft") or {}
    draft = _draft_from_dict(raw)
    extra = raw.get("x")
    await _learn_merchant_rule(db, user.tenant_id, draft.term, cat.id)
    row.pending = None
    if draft.share_with or draft.wants_card:
        return await _route_payment(db, user, inbound, draft, cat, raw.get("pm"), created=created)
    entry = await quick_capture.create_quick_expense(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft, category_id=cat.id,
        description=draft.description, payment_method=raw.get("pm"), payee_id=(extra or {}).get("payee_id"),
    )
    suffix = await _finish_expense(db, user, entry, extra)
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text,
              ref_type="expense", ref_id=entry.id)
    line = _saved_line(draft, entry.description, _new_label(cat.name, created)) + suffix
    # La categoría la acaba de elegir la persona: no se le ofrece cambiarla.
    if draft.description:
        await db.commit()
        return [line]
    reply = _offer_description(db, user, entry, line, category_hint=False)
    await db.commit()
    return [reply]


def _new_label(name: str, created: bool) -> str:
    return f"{name} (categoría nueva)" if created else name


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
    # Lo que no se entendió, y lo que se entendió con dudas (dos números parecidos,
    # o una frase larga donde iba un comercio): un monto mal leído no da error.
    question = await _open_pending(db, user.id)
    if draft is None or draft.uncertain:
        handled, inbound = await _interpret(db, user, inbound)
        if handled is not None:
            return handled
    if draft is None:
        bare = quick_capture.parse_amount_text(inbound.text)
        if bare is not None and not bare.term and bare.amount >= 100:
            reply = f"¿{_fmt_amount(bare)} en qué?"
            _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
            _remember(db, user.id, "out", "text", text=reply, pending={"type": "term_ask", "draft": _draft_dict(bare)})
            await db.commit()
            return [reply]
        await bot_cases.record(db, bot_cases.KIND_TEXT_UNRESOLVED, inbound.text)
        await record_event(
            db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp",
            input_kind="text", outcome="needs_ai", reason="unparseable_text",
        )
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        # Si había una pregunta abierta, se repite y sigue abierta: la ayuda general
        # no la contesta, y la fila que se acaba de guardar la habría cerrado.
        if question is not None and (question.pending or {}).get("type") in _DRAFT_PENDING and question.text:
            _remember(db, user.id, "out", "text", text=question.text, pending=question.pending)
            await db.commit()
            return [f"No te entendí. Te pregunto de nuevo:\n\n{question.text}"]
        await db.commit()
        return [MSG_BUSINESS_HELP if await _is_business(db, user) else _help_text()]

    return await _capture_draft(db, user, inbound, draft, payment_method=draft.payment_method)


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
    created = False
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )).all()
    if category is None and draft.currency != "USD":
        # La nombró a propósito ("categoría súper"): la que sea, y si no existe se crea.
        if draft.category_name:
            category, _candidates = _match_name(cats, draft.category_name)
            if category is None and _looks_like_name(draft.category_name):
                category = await _create_category(db, user.tenant_id, draft.category_name)
                created = True
        # Lo que escribió junto a la foto puede ser la categoría y no una descripción.
        elif draft.description:
            category = _match_exact(cats, draft.description)
            if category is not None:
                draft.description = None
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
            reply = f"¿En qué categoría pongo {_fmt_amount(draft)} en *{draft.term}*? Decime el nombre y la creo."
            pending = {"type": "category_name", "draft": _draft_dict(draft, payment_method, extra)}
        else:
            listed = "\n".join(f"{i+1}. {name}" for i, name in enumerate(options))
            reply = (
                f"¿En qué categoría pongo {_fmt_amount(draft)} en *{draft.term}*?\n{listed}\n"
                "Decime el número o el nombre. Si es otra, la creo."
            )
            pending = {"type": "category_pick", "draft": _draft_dict(draft, payment_method, extra), "options": options}
        _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
        _remember(db, user.id, "out", "text", text=reply, pending=pending)
        await db.commit()
        return [reply]

    if draft.share_with or draft.wants_card:
        cat = next((c for c in cats if c.id == pick.category_id), None) or await db.get(ExpenseCategory, pick.category_id)
        return await _route_payment(db, user, inbound, draft, cat, payment_method, created=created)

    description = draft.description or pick.description
    entry = await quick_capture.create_quick_expense(
        db, tenant_id=user.tenant_id, user_id=user.id, draft=draft,
        category_id=pick.category_id, description=description,
        payment_method=payment_method, payee_id=(extra or {}).get("payee_id"),
    )
    stock_line = await _finish_expense(db, user, entry, extra)
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None,
              ref_type="expense", ref_id=entry.id)
    await db.commit()

    suffix = " (sugerida)" if pick.source in ("suggest", "rule") else ""
    when = "" if entry.expense_date == ar_today() else f", del {entry.expense_date.strftime('%d/%m')}"
    base = _saved_line(draft, entry.description, _new_label(pick.category_name, created)) + f"{suffix}{when}{stock_line}"
    if await _has_twin(db, entry):
        # El mismo comprobante mandado otra vez (caso real: una captura de
        # $36.000 llegó cuatro veces y eran cuatro gastos). Se avisa, no se
        # frena: dos cargas iguales el mismo día también existen.
        base += "\n⚠️ Ya había uno igual, mismo monto y fecha. Si es el mismo, decime *deshacer*."
    # Ya tiene lo que la persona quiso decir: volver a preguntar es ruido.
    if pick.source in ("suggest", "rule") and not description:
        reply = _offer_description(db, user, entry, base)
        await db.commit()
        return [reply]
    if await _show_hints(db, user.id):
        return [base + "\nSi algo quedó mal, decime *deshacer* o *categoría* y el nombre."]
    return [base]


def _saved_line(draft, description: str | None, category: str) -> str:
    """"✅ $12.000 en la verdulería, lo puse en Comida", sin repetir la descripción cuando
    es la misma categoría: "✅ $12.000 en Verdulería"."""
    from app.services.search import fold_text

    if description and fold_text(description) != fold_text(category):
        return f"✅ {_fmt_amount(draft)} en {description}, lo puse en {category}"
    return f"✅ {_fmt_amount(draft)} en {category}"


# Cuántas cargas de la semana muestran cómo corregir. Después, la persona ya
# sabe: repetirlo en cada gasto es la cola de instrucciones que hace sentir
# que habla con un bot. La memoria dura 7 días, así que quien vuelve después
# de una semana lo ve de nuevo.
HINT_CAPTURES = 3


async def _show_hints(db: AsyncSession, user_id: int) -> bool:
    n = await db.scalar(
        select(func.count(WaMessage.id)).where(
            WaMessage.user_id == user_id,
            WaMessage.direction == "in",
            WaMessage.ref_type.in_(("expense", "income", "sale")),
            WaMessage.created_at >= _cutoff(),
        )
    )
    return (n or 0) <= HINT_CAPTURES


async def _has_twin(db: AsyncSession, entry: ExpenseEntry) -> bool:
    twin = await db.scalar(
        select(ExpenseEntry.id).where(
            ExpenseEntry.tenant_id == entry.tenant_id,
            ExpenseEntry.amount == entry.amount,
            ExpenseEntry.currency == entry.currency,
            ExpenseEntry.expense_date == entry.expense_date,
            ExpenseEntry.id != entry.id,
        ).limit(1)
    )
    return twin is not None


async def _learn_merchant_rule(
    db: AsyncSession, tenant_id: int, term: str, category_id: int
) -> None:
    """Contestar la pregunta de categoría ES la regla comercio→categoría.

    La sugerencia por historial se rompe apenas el usuario reescribe la
    descripción (caso real: "Maremtisas067" → "mantel para el quincho" y el
    mismo comprobante volvió a preguntar). La regla es durable y, como todo
    lo de `capture_rules`, sólo produce una sugerencia visible y editable —
    nunca se aplica sin mostrarse. Sin descripción en el payload a propósito:
    la del primer gasto no tiene por qué valer para el próximo (la aprende
    `_learn_description`, recién cuando se repite, y esto la conserva)."""
    from app.services.reconcile import rules as capture_rules

    if not term:
        return
    key = capture_rules.merchant_key(term)
    rules = await capture_rules.get_rules(db, tenant_id, capture_rules.KIND_MERCHANT_CATEGORY)
    await capture_rules.save_rule(
        db, tenant_id, capture_rules.KIND_MERCHANT_CATEGORY, key,
        {**(rules.get(key) or {}), "category_id": category_id},
    )


def _offer_description(
    db: AsyncSession, user: User, entry, base_line: str, *, category_hint: bool = True
) -> str:
    """Después de guardar, ofrecer una descripción opcional. Sólo donde la
    descripción actual es el nombre del comercio o el término crudo (categoría
    elegida a mano o sugerida) — cuando el usuario ya escribió lo que quería,
    repreguntar es ruido. `category_hint` = la categoría la puso el bot, así
    que se dice cómo cambiarla."""
    reply = base_line + "\nSi querés, contame qué fue."
    if category_hint:
        reply += " Y si la categoría no va, decime *categoría* y el nombre."
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
    # Lo que dijo además del monto viaja con la pregunta.
    for key, value in (
        ("desc", draft.description), ("card", draft.wants_card or None), ("hint", draft.card_hint),
        ("n", draft.installments), ("per", draft.per_installment or None), ("share", draft.share_with or None),
    ):
        if value:
            d[key] = value
    return d


def _draft_from_dict(d: dict) -> quick_capture.QuickDraft:
    from datetime import date as _date

    return quick_capture.QuickDraft(
        amount=Decimal(d["amount"]), currency=d["currency"],
        expense_date=_date.fromisoformat(d["date"]), term=d["term"], legacy=False,
        description=d.get("desc"), wants_card=bool(d.get("card")), card_hint=d.get("hint"),
        installments=d.get("n"), per_installment=bool(d.get("per")), share_with=d.get("share") or [],
    )


def _join_names(names: list[str]) -> str:
    """"Bruto, Jubilación y Obra social"."""
    if len(names) == 1:
        return names[0]
    return f"{', '.join(names[:-1])} y {names[-1]}"


def _fmt_amount(draft) -> str:
    return _money(draft.amount, draft.currency)


async def _do_undo(db: AsyncSession, user: User, inbound: InboundMessage) -> list[str]:
    from app.services.business import bot as business_bot

    ref = await _last_ref(db, user.id, ("expense", "income", "card_item", "shared", *business_bot.BUSINESS_REFS), inbound.quoted_wa_id)
    if ref is None:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["No tengo nada para deshacer en los últimos 7 días."]
    if ref.ref_type == "income":
        return await _undo_income(db, user, inbound, ref)
    # Deshecho enseguida: lo cargó mal, aunque no haya dado ningún error. Es la
    # señal de que algo se entendió mal, la que un "no te entendí" no da nunca.
    if ref.created_at and datetime.now() - ref.created_at < timedelta(minutes=5):
        original = await _original_text(db, user.id, ref)
        if original:
            await bot_cases.record(db, bot_cases.KIND_UNDONE, original, {"was": ref.ref_type})
    if ref.ref_type == "card_item":
        return await _undo_card_item(db, user, inbound, ref)
    if ref.ref_type == "shared":
        return await _undo_shared(db, user, inbound, ref)
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
    return [f"🗑️ Listo, saqué {_money(amount, currency)} de {desc}."]


async def _undo_card_item(db: AsyncSession, user: User, inbound: InboundMessage, ref: WaMessage) -> list[str]:
    """Una factura que el bot puso en un resumen. Sólo si sigue siendo la que
    cargó: un ítem que después se compartió se borra desde la app."""
    from app.models.credit_card import CreditCardItem, CreditCardStatement
    from app.models.shared_expense import SharedExpense
    from app.services.credit_cards import delete_item_tree

    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    item = await db.get(CreditCardItem, ref.ref_id)
    stmt = await db.get(CreditCardStatement, item.statement_id) if item else None
    if item is None or stmt is None or stmt.tenant_id != user.tenant_id:
        await db.commit()
        return ["Ese gasto ya no está."]
    if await db.scalar(select(SharedExpense.id).where(SharedExpense.credit_card_item_id == item.id)):
        await db.commit()
        return ["Ese gasto ya se compartió: borralo desde la app."]
    desc, amount, currency = item.description, item.amount, item.currency
    await delete_item_tree(item, db)
    ref.ref_type = None
    ref.ref_id = None
    await db.commit()
    return [f"🗑️ Listo, saqué {_money(amount, currency)} de {desc}."]


async def _do_edit(
    db: AsyncSession, user: User, inbound: InboundMessage, field_name: str, value: str
) -> list[str]:
    # El monto se corrige en lo último que se cargó: gasto, ingreso o venta.
    # La descripción y la categoría, en un gasto o un ingreso — la
    # "categoría" de un ingreso es su fuente: quien acaba de cargar un sueldo
    # y escribe *categoría …* habla de ese ingreso, no del último gasto.
    field_name = field_name.lower()
    types = {
        "monto": ("expense", "income", "sale", "card_item", "shared"),
        "fuente": ("income",),
    }.get(field_name, ("expense", "income", "card_item", "shared"))
    ref = await _last_ref(db, user.id, types, inbound.quoted_wa_id)
    if ref is not None and ref.ref_type == "shared":
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Ese gasto ya es compartido: corregilo desde Compartidos en la app, así les llega a todos igual."]
    if ref is not None and ref.ref_type == "card_item":
        # Una factura que quedó en un resumen: se corrige donde vive, no acá
        # (y sin esto, *editar* caía en el gasto anterior).
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Eso quedó en el resumen de la tarjeta: corregilo desde la app, o *deshacer* y cargalo de nuevo."]
    if ref is not None and ref.ref_type == "income":
        if field_name.startswith("categor"):
            field_name = "fuente"
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
        return [f"✏️ Listo: {_money(entry.amount, entry.currency)} en {entry.description}."]

    if field_name == "fecha":
        when = _parse_edit_date(value)
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        if when is None:
            await db.commit()
            return ["No entendí la fecha. Probá: *cambiar fecha 1/11*"]
        entry.expense_date = when
        await db.commit()
        return [f"✏️ Listo: {_money(entry.amount, entry.currency)} en {entry.description}, del {when:%d/%m}."]

    if field_name == "monto":
        amount = _parse_edit_amount(value)
        if amount is None:
            await db.commit()
            return ["No entendí el monto. Probá: *editar monto 13000*"]
        entry.amount = amount
    else:
        return await _recategorize(db, user, inbound, ref, entry, value)

    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    invalidate_suggest(user.tenant_id)
    return [f"✏️ Listo: {_money(entry.amount, entry.currency)} en {entry.description}."]


def _parse_edit_date(value: str):
    when, _rest = quick_capture.extract_date(value, ar_today())
    return when


def _match_exact(cats, value: str):
    from app.services.search import fold_text

    folded = fold_text(value or "").strip()
    return next((c for c in cats if fold_text(c.name).strip() == folded), None) if folded else None


def _match_name(cats, value: str):
    """El nombre escrito → una categoría (o una fuente de ingreso): exacto, o
    una sola que lo contenga ("super" → "Supermercado"). Con varias candidatas
    devuelve sus nombres para preguntar; elegir una sería adivinar."""
    from app.services.search import fold_text

    folded = fold_text(value).strip()
    if not folded:
        return None, []
    exact = next((c for c in cats if fold_text(c.name).strip() == folded), None)
    if exact:
        return exact, []
    partial = [
        c for c in cats
        if folded in fold_text(c.name) or (len(fold_text(c.name)) >= 4 and fold_text(c.name) in folded)
    ]
    if len(partial) == 1:
        return partial[0], []
    return None, sorted(c.name for c in partial)[:6]


async def _recategorize(
    db: AsyncSession, user: User, inbound: InboundMessage, ref: WaMessage,
    entry: ExpenseEntry, value: str,
) -> list[str]:
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )).all()
    cat, candidates = _match_name(cats, value)
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    if cat is None:
        await db.commit()
        if candidates:
            return [f"¿Cuál de estas? {', '.join(candidates)}\nMandá *categoría* y el nombre completo."]
        names = ", ".join(sorted(c.name for c in cats)[:12])
        return [f"No tengo una categoría «{value}». Las que hay: {names}\nSi querés una nueva, decime *crear categoría {value}*."]

    before = next((c.name for c in cats if c.id == entry.category_id), None)
    entry.category_id = cat.id
    # Corregir la categoría corrige también lo aprendido: si no, el próximo
    # gasto del mismo comercio vuelve a caer en la equivocada.
    if entry.currency != "USD":
        terms = {entry.description}
        original = await _original_text(db, user.id, ref)
        parsed = quick_capture.parse_quick_text(original) if original else None
        if parsed is not None:
            terms.add(parsed.term)
        for term in filter(None, terms):
            await _learn_merchant_rule(db, user.tenant_id, term, cat.id)
    await db.commit()
    invalidate_suggest(user.tenant_id)
    was = f" (antes: {before})" if before and before != cat.name else ""
    return [f"✏️ Listo: {_fmt_amount(entry)} en {entry.description}, a {cat.name}{was}."]


async def _original_text(db: AsyncSession, user_id: int, ref: WaMessage) -> str | None:
    """El texto con el que se pidió el gasto. Si se contestó una pregunta de
    categoría, la fila con la referencia es la respuesta ("2"): el texto
    original es el último mensaje entrante con texto antes de ella."""
    if not ref.text:
        return None  # un comprobante: no hay texto que aprender
    if quick_capture.parse_quick_text(ref.text) is not None:
        return ref.text
    return await db.scalar(
        select(WaMessage.text).where(
            WaMessage.user_id == user_id,
            WaMessage.direction == "in",
            WaMessage.id < ref.id,
        ).order_by(WaMessage.id.desc()).limit(1)
    )


async def _income_terms(db: AsyncSession, user_id: int, ref: WaMessage, entry: IncomeEntry) -> set[str]:
    """Los términos con los que se resolvió la fuente de un ingreso: el del
    texto original ("cobré … diseño web") y, en una transferencia, quien la
    mandó (que quedó en las notas)."""
    terms: set[str] = set()
    notes = entry.notes or ""
    if notes.startswith("Transferencia de "):
        terms.add(notes[len("Transferencia de "):])
    original = ref.text
    if original and income_capture.parse_income_text(original) is None:
        # La fila es la respuesta a la pregunta de fuente: el pedido es el anterior.
        original = await db.scalar(
            select(WaMessage.text).where(
                WaMessage.user_id == user_id, WaMessage.direction == "in", WaMessage.id < ref.id,
            ).order_by(WaMessage.id.desc()).limit(1)
        )
    parsed = income_capture.parse_income_text(original) if original else None
    if parsed is not None and parsed.term:
        terms.add(parsed.term)
    return terms


async def _do_quoted_category(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """Responder citando un gasto (o la confirmación del bot) con sólo el
    nombre de una categoría la cambia. Sin cita, o si el texto no es una
    categoría, None y el mensaje sigue su camino."""
    if not inbound.quoted_wa_id or any(c.isdigit() for c in text):
        return None
    ref = await _quoted_ref(db, user.id, inbound.quoted_wa_id)
    if ref is not None and ref.ref_type == "income":
        sources = await income_capture.writable_sources(db, user.tenant_id)
        source, _ = _match_name(sources, text)
        if source is None:
            return None
        return await _edit_income(db, user, inbound, ref, "fuente", source.name)
    if ref is None or ref.ref_type != "expense":
        return None
    cats = (await db.scalars(
        select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
    )).all()
    cat, _ = _match_name(cats, text)
    if cat is None:
        return None
    entry = await db.get(ExpenseEntry, ref.ref_id)
    if entry is None or entry.tenant_id != user.tenant_id or entry.source != EXPENSE_SOURCE_WHATSAPP:
        return None
    return await _recategorize(db, user, inbound, ref, entry, cat.name)


def _parse_edit_amount(value: str) -> Decimal | None:
    amount = quick_capture._parse_number(value.replace("$", "").strip())
    if amount is None:
        m = quick_capture._AMOUNT_RE.search(value)
        if m:
            amount = quick_capture._parse_number(m.group(2))
            mult = quick_capture._MULTIPLIER.get((m.group(3) or "").lower())
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
    what = f"{_fmt_amount(entry)} en {name}"
    await db.delete(entry)
    ref.ref_type = None
    ref.ref_id = None
    await db.commit()
    return [f"🗑️ Listo, saqué el ingreso de {what}."]


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

    if field_name == "fecha":
        when = _parse_edit_date(value)
        if when is None:
            await db.commit()
            return ["No entendí la fecha. Probá: *cambiar fecha 1/11*"]
        entry.period_date = when
        await db.commit()
        return [f"✏️ Listo: ingreso de {_fmt_amount(entry)}, del {when:%d/%m}."]

    sources = await income_capture.writable_sources(db, user.tenant_id)
    if field_name == "monto":
        amount = _parse_edit_amount(value)
        if amount is None:
            await db.commit()
            return ["No entendí el monto. Probá: *editar monto 850000*"]
        entry.amount = amount
    elif field_name == "fuente":
        source, candidates = _match_name(sources, value)
        if source is None:
            await db.commit()
            if candidates:
                return [f"¿Cuál de estas? {', '.join(candidates)}\nMandá *fuente* y el nombre completo."]
            names = ", ".join(s.name for s in sources[:12]) or "ninguna"
            return [f"No hay una fuente «{value}». Tenés: {names}"]
        before = await db.scalar(select(IncomeSource.name).where(IncomeSource.id == entry.source_id))
        entry.source_id = source.id
        # Igual que con las categorías: lo aprendido se corrige con el error.
        for term in await _income_terms(db, user.id, ref, entry):
            await income_capture.learn(db, user.tenant_id, term, source.id)
        await db.commit()
        was = f" (antes: {before})" if before and before != source.name else ""
        return [f"✏️ Listo: ingreso de {_fmt_amount(entry)}, a {source.name}{was}."]
    else:
        entry.notes = value[:500]
    await db.commit()
    name = await db.scalar(select(IncomeSource.name).where(IncomeSource.id == entry.source_id))
    notes = f" ({entry.notes})" if entry.notes else ""
    return [f"✏️ Listo: ingreso de {_fmt_amount(entry)} en {name}{notes}."]


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
    return [MSG_INTEREST]


# ------------------------------------------------------ cómo se pagó algo ---
# "con la visa", "en 3 cuotas", "a medias con Juan". Lo que no alcanza se pregunta,
# y todo termina en los servicios de siempre: la tarjeta en `create_item_in_statement`,
# el compartido en `create_shared`, igual que desde la app.

async def _route_payment(
    db: AsyncSession, user: User, inbound: InboundMessage, draft: quick_capture.QuickDraft,
    cat: ExpenseCategory, payment_method: str | None, *, created: bool = False,
) -> list[str]:
    if draft.share_with:
        return await _propose_share(db, user, inbound, draft, cat)
    return await _capture_card(db, user, inbound, draft, cat)


def _card_label(card) -> str:
    alias = card.alias or card.bank or "Tarjeta"
    if card.last_4_digits and card.last_4_digits not in alias:
        return f"{alias} {card.last_4_digits}"
    return alias


def _match_cards(cards: list, hint: str | None) -> list:
    """Por los últimos 4 dígitos, o por las palabras del nombre o del banco."""
    from app.services.search import fold_text

    if not hint:
        return list(cards)
    folded = fold_text(hint).strip()
    if folded.isdigit():
        return [c for c in cards if c.last_4_digits == folded]
    words = folded.split()
    # "master" tiene que encontrar "Mastercard Platinum".
    def has(card) -> bool:
        name = fold_text(f"{card.alias} {card.bank}")
        return all(w in name for w in words)
    return [c for c in cards if has(c)]


async def _card_period(db: AsyncSession, card, when) -> tuple[int, int]:
    """A qué resumen va una compra. El primero que cierre después de la fecha, si
    ya se conoce; si no, con el día de cierre del último resumen. Sin ningún dato,
    el mes de la compra: la respuesta dice cuál eligió y se puede corregir."""
    from datetime import date as _date

    from app.models.credit_card import CreditCardStatement
    from app.services.statement_parsers.common import assign_period

    closings = (await db.execute(
        select(CreditCardStatement.closing_date, CreditCardStatement.year, CreditCardStatement.month)
        .where(CreditCardStatement.card_id == card.id, CreditCardStatement.closing_date.is_not(None))
        .order_by(CreditCardStatement.closing_date)
    )).all()
    for closing, year, month in closings:
        if closing >= when:
            return year, month
    if not closings:
        return when.year, when.month
    day = min(closings[-1][0].day, 28)
    closing = _date(when.year, when.month, day)
    if when > closing:
        closing = _date(when.year + (when.month == 12), when.month % 12 + 1, day)
    return assign_period(closing)


async def _capture_card(
    db: AsyncSession, user: User, inbound: InboundMessage, draft: quick_capture.QuickDraft, cat: ExpenseCategory,
) -> list[str]:
    from app.models.credit_card import CreditCard

    cards = list((await db.scalars(
        select(CreditCard).where(CreditCard.tenant_id == user.tenant_id).order_by(CreditCard.id)
    )).all())
    matched = _match_cards(cards, draft.card_hint)
    if len(matched) == 1:
        return await _save_card_item(db, user, inbound, draft, matched[0], cat)

    options = (matched or cards)[:7]
    if options:
        listed = "\n".join(f"{i + 1}. {_card_label(c)}" for i, c in enumerate(options))
        extra_n = len(options)
        reply = (
            f"¿Con qué tarjeta pagaste {_fmt_amount(draft)} en *{draft.term or cat.name}*?\n{listed}\n"
            f"{extra_n + 1}. Sin tarjeta, como gasto común\n{extra_n + 2}. Mejor no lo cargo"
        )
    else:
        reply = (
            f"Todavía no tenés tarjetas cargadas, así que no puedo poner {_fmt_amount(draft)} en un resumen.\n"
            "1. Cargarlo como gasto común\n2. Mejor no lo cargo\n"
            "La tarjeta la creás en la app, o mandándome su resumen en PDF."
        )
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
    _remember(db, user.id, "out", "text", text=reply, pending={
        "type": "card_pick", "draft": _draft_dict(draft), "cat": cat.id, "cards": [c.id for c in options],
    })
    await db.commit()
    return [reply]


async def _answer_card_pick(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, number: int
) -> list[str]:
    from app.models.credit_card import CreditCard

    pending = row.pending or {}
    ids = pending.get("cards") or []
    if not (1 <= number <= len(ids) + 2):
        return [f"Decime un número del 1 al {len(ids) + 2}."]
    draft = _draft_from_dict(pending["draft"])
    cat = await db.get(ExpenseCategory, pending["cat"])
    if cat is None or cat.tenant_id != user.tenant_id:
        return ["Esa categoría ya no existe. Mandame el gasto de nuevo."]
    row.pending = None
    if number <= len(ids):
        card = await db.get(CreditCard, ids[number - 1])
        if card is None or card.tenant_id != user.tenant_id:
            await db.commit()
            return ["Esa tarjeta ya no está. Mandame el gasto de nuevo."]
        return await _save_card_item(db, user, inbound, draft, card, cat)
    if number == len(ids) + 2:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Listo, no lo cargo."]
    draft.wants_card = False
    return await _capture_draft(db, user, inbound, draft, category=cat)


async def _save_card_item(
    db: AsyncSession, user: User, inbound: InboundMessage, draft: quick_capture.QuickDraft, card, cat: ExpenseCategory,
) -> list[str]:
    from app.schemas.credit_card import CreditCardItemCreate
    from app.services import auth_links, bill_capture
    from app.services.credit_cards import create_item_in_statement, find_or_create_statement

    count = draft.installments if draft.currency != "USD" else None
    if count:
        each = draft.amount if draft.per_installment else (draft.amount / count).quantize(Decimal("0.01"))
        total = draft.amount * count if draft.per_installment else draft.amount
    else:
        each, total = draft.amount, None
    description = (draft.description or draft.term or cat.name)[:255]
    year, month = await _card_period(db, card, draft.expense_date)
    stmt = await find_or_create_statement(card, year, month, user.tenant_id, db)
    item = await create_item_in_statement(stmt, card, CreditCardItemCreate(
        description=description, category_id=cat.id, item_date=draft.expense_date,
        item_type="installment" if count else "single", amount=each, currency=draft.currency,
        installment_count=count, purchase_total=total,
    ), user, db)
    item.capture_source = "whatsapp"
    await db.flush()
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None,
              ref_type="card_item", ref_id=item.id)
    token = await auth_links.mint_token(db, user.id)
    link = f"{settings.FRONTEND_URL}/tarjetas/{card.id}/{stmt.id}?item={item.id}&wat={token}"
    await db.commit()

    period = bill_capture.period_label(year, month, ar_today())
    amount = _money(total or each, draft.currency)
    if count:
        head = f"✅ {amount} en {description}, {count} cuotas de {_money(each, draft.currency)} con la *{_card_label(card)}*."
        where = f"La primera va en el resumen de {period}."
    else:
        head = f"✅ {amount} en {description}, con la *{_card_label(card)}*."
        where = f"Va en el resumen de {period}."
    note = "\nEn dólares va en un solo pago, así que no lo puse en cuotas." if draft.installments and not count else ""
    return [f"{head}{note}\n{where} Si era otro, o algo quedó mal: *deshacer*, o corregilo acá: {link}"]


async def _holder_tokens(db: AsyncSession, user: User) -> set[str]:
    from app.services.search import fold_text

    row = (await db.execute(
        select(User.first_name, User.last_name, User.display_name).where(User.id == user.id)
    )).first()
    if row is None:
        return set()
    return set(fold_text(" ".join(p for p in row if p)).split())


async def _is_own_name(db: AsyncSession, user: User, name: str | None) -> bool:
    """¿Esta contraparte es el titular de la cuenta? Nombre y apellido, como mínimo:
    con uno solo, "Juan" sería cualquier Juan."""
    from app.services.search import fold_text

    words = set(fold_text(name or "").split())
    if len(words) < 2:
        return False
    tokens = await _holder_tokens(db, user)
    # En los dos sentidos: el comprobante puede traer un segundo nombre que la cuenta no tiene.
    return len(words & tokens) >= 2 and (words <= tokens or tokens <= words)


async def _ask_own_transfer(
    db: AsyncSession, user: User, inbound: InboundMessage, draft: quick_capture.QuickDraft, method: str | None,
) -> list[str]:
    """Un comprobante a nombre del propio titular no es un pago a un tercero: casi
    siempre es plata que le entró, o que movió entre sus cuentas. Cargarlo como
    gasto (caso real: $100.000 a su nombre, en Comida) descuadra el mes dos veces."""
    reply = (
        f"Este comprobante de {_fmt_amount(draft)} está a tu nombre. ¿Qué fue?\n"
        "1. Me entró esa plata\n2. La pagué yo, es un gasto\n3. La pasé entre mis cuentas, no la cargo"
    )
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
    _remember(db, user.id, "out", "text", text=reply, pending={
        "type": "own_transfer", "draft": _draft_dict(draft, method),
    })
    await db.commit()
    return [reply]


async def _answer_own_transfer(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, number: int
) -> list[str]:
    pending = row.pending or {}
    if not (1 <= number <= 3):
        return ["Decime *1*, *2* o *3*."]
    raw = pending["draft"]
    draft = _draft_from_dict(raw)
    row.pending = None
    if number == 3:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Listo, no lo cargo."]
    if number == 2:
        return await _capture_draft(db, user, inbound, draft, payment_method=raw.get("pm"))
    if await _is_business(db, user):
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["No lo cargo: en el negocio, lo que entra sale de las ventas."]
    draft.term = ""
    return await _capture_income(db, user, inbound, draft, refund=True)


async def _resolve_person(db: AsyncSession, user: User, name: str) -> dict | None:
    """Un nombre → alguien a quien se le puede compartir: del hogar, de la agenda,
    o un alias, mail o teléfono exacto. Ante dos posibles, el más usado: la
    confirmación muestra el nombre completo antes de avisarle a nadie."""
    from app.models.contact import SharedContact
    from app.services import participants, user_directory
    from app.services.search import fold_text

    words = set(fold_text(name).split())
    if not words:
        return None
    members = (await db.execute(
        select(User.id, User.first_name, User.last_name, User.display_name, User.alias)
        .where(User.tenant_id == user.tenant_id, User.id != user.id, User.deleted_at.is_(None))
    )).all()
    for member in members:
        known = set(fold_text(" ".join(p for p in member[1:] if p)).split())
        if words <= known:
            return {"name": member.display_name or member.first_name or name, "user_id": member.id}
    contacts = (await db.scalars(
        select(SharedContact).where(SharedContact.tenant_id == user.tenant_id)
        .order_by(SharedContact.use_count.desc())
    )).all()
    for contact in contacts:
        if words <= set(fold_text(contact.display_name).split()):
            return {
                "name": contact.display_name, "user_id": contact.contact_user_id,
                "contact": contact.contact_phone or contact.contact_email,
            }
    found = await user_directory.lookup_exact(db, name)
    if found is not None and found.id != user.id:
        return {"name": found.display_name or name, "user_id": found.id}
    if participants.is_email(name) or participants.is_phone(name):
        return {"name": name, "user_id": None, "contact": name}
    return None


def _equal_shares(total: Decimal, people: int) -> list[Decimal]:
    """En centavos, con el resto en la última parte, igual que `lib/split.ts`: el
    backend rechaza una división que no suma exacto."""
    each = (total / people).quantize(Decimal("0.01"), rounding="ROUND_DOWN")
    return [each] * (people - 1) + [total - each * (people - 1)]


async def _propose_share(
    db: AsyncSession, user: User, inbound: InboundMessage, draft: quick_capture.QuickDraft, cat: ExpenseCategory,
    people: list[dict] | None = None, missing: list[str] | None = None,
) -> list[str]:
    """Compartir le manda un aviso a otra persona y eso no se deshace: se pregunta
    siempre, con quién recibe qué a la vista."""
    if people is None:
        people, missing = [], []
        for name in draft.share_with:
            person = await _resolve_person(db, user, name)
            if person is not None:
                people.append(person)
            else:
                missing.append(name)
    _remember(db, user.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None)
    base = {"draft": _draft_dict(draft), "cat": cat.id, "people": people}
    if missing:
        who = missing[0]
        reply = f"No tengo a *{who}* en tu agenda. Pasame su WhatsApp o su mail y le aviso, o decime *cancelar*."
        _remember(db, user.id, "out", "text", text=reply, pending={**base, "type": "share_contact", "missing": missing})
        await db.commit()
        return [reply]

    shares = _equal_shares(draft.amount, len(people) + 1)
    lines = [f"• Vos: {_money(shares[0], draft.currency)}"]
    lines += [f"• {p['name']}: {_money(s, draft.currency)}" for p, s in zip(people, shares[1:])]
    names = _join_names([p["name"] for p in people])
    reply = (
        f"Anoto {_fmt_amount(draft)} en *{draft.term or cat.name}*, dividido así:\n" + "\n".join(lines) + "\n"
        f"A {names} le va a llegar el aviso para aceptarlo.\n1. Dale\n2. No, dejalo"
    )
    _remember(db, user.id, "out", "text", text=reply, pending={**base, "type": "share_confirm"})
    await db.commit()
    return [reply]


async def _answer_share(
    db: AsyncSession, user: User, inbound: InboundMessage, row: WaMessage, yes: bool
) -> list[str]:
    from app.schemas.shared_expense import SharedExpenseCreate, SplitIn
    from app.services import notify_shared, shared_expenses as shared_service

    pending = row.pending or {}
    row.pending = None
    if not yes:
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Listo, no lo cargo."]
    draft = _draft_from_dict(pending["draft"])
    people = pending.get("people") or []
    shares = _equal_shares(draft.amount, len(people) + 1)
    title = (draft.description or draft.term)[:200] or "Gasto compartido"
    body = SharedExpenseCreate(
        title=title, total_amount=draft.amount, category_id=pending["cat"], currency=draft.currency,
        split_type="equal", expense_date=draft.expense_date,
        splits=[
            SplitIn(user_id=user.id, member_name=user.display_name or "Yo", amount=shares[0]),
            *(SplitIn(
                user_id=p.get("user_id"), member_name=p["name"], amount=s,
                invite_contact=None if p.get("user_id") else p.get("contact"),
            ) for p, s in zip(people, shares[1:])),
        ],
    )
    created = await shared_service.create_shared(user, body, db)
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text,
              ref_type="shared", ref_id=created.shared.id)
    await db.commit()
    # Después del commit, como en la app: un aviso nunca sale por algo que no quedó.
    await notify_shared.notify_share(
        db, creator=user, title=title, total_amount=draft.amount,
        notify=created.notify, invites=created.invites, currency=draft.currency,
    )
    names = _join_names([p["name"] for p in people])
    return [f"✅ {_fmt_amount(draft)} en {title}, compartido con {names}. Te toca {_money(shares[0], draft.currency)}."]


async def _undo_shared(db: AsyncSession, user: User, inbound: InboundMessage, ref: WaMessage) -> list[str]:
    from fastapi import HTTPException

    from app.services import shared_expenses as shared_service

    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    try:
        await shared_service.delete_shared(user, ref.ref_id, db)
    except HTTPException:
        await db.commit()
        return ["Ese compartido ya no se puede borrar desde acá. Fijate en Compartidos, en la app."]
    ref.ref_type = None
    ref.ref_id = None
    await db.commit()
    invalidate_suggest(user.tenant_id)
    return ["🗑️ Listo, lo saqué. Al otro ya le había llegado el aviso, por si querés avisarle."]


# ------------------------------------------------- respuestas con palabras ---

async def _do_quick_fix(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """Corregir lo que se acaba de cargar como se le diría a una persona: "me
    equivoqué, eran 35.000" o "fue descartables". Antes el primero era un gasto
    nuevo de $35.000 en "Me equivoqué, eran", y el segundo no se entendía. Sólo
    por un rato: mañana, "eran 35.000" no habla del gasto de hoy."""
    m = _FIX_RE.match(text)
    if m is None or not (m.group("sorry") or m.group("verb")):
        return None
    value = m.group("value").strip().rstrip(".")
    is_amount = bool(_AMOUNT_ONLY_RE.match(value))
    is_description = (
        m.group("verb") and m.group("verb").lower() in ("fue", "fueron", "era")
        and not any(ch.isdigit() for ch in value) and len(value.split()) <= 6
    )
    if not (is_amount or is_description):
        return None
    row = await _open_pending(db, user.id)
    if row is not None and (row.pending or {}).get("type") in _DRAFT_PENDING:
        if not is_amount:
            return None
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        await db.commit()
        return ["Listo, ese no lo cargo. Mandámelo de nuevo con el monto correcto."]
    ref = await _last_ref(db, user.id, ("expense", "income", "sale", "card_item", "shared"))
    if ref is None or datetime.now() - ref.created_at > FIX_WINDOW:
        return None
    return await _do_edit(db, user, inbound, "monto" if is_amount else "descripción", value)


async def _do_cancel_draft(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """*deshacer* o "no" mientras un gasto espera respuesta: no cargarlo, y nada más."""
    from app.services.search import fold_text

    if not (_UNDO_RE.match(text) or fold_text(text).strip(" .!") in _CANCEL_WORDS):
        return None
    row = await _open_pending(db, user.id)
    if row is None or (row.pending or {}).get("type") not in _DRAFT_PENDING:
        return None
    row.pending = None
    _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
    await db.commit()
    return ["Listo, no lo cargo."]


async def _do_pending_words(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """Las preguntas que también se contestan con palabras."""
    from app.services import participants
    from app.services.search import fold_text

    row = await _open_pending(db, user.id)
    pending = (row.pending or {}) if row is not None else {}
    ptype = pending.get("type")
    folded = fold_text(text).strip(" .!")

    if ptype == "term_ask":
        if quick_capture.parse_amount_text(text) is not None or not text.strip():
            return None
        draft = _draft_from_dict(pending["draft"])
        draft.term = text.strip()[:120]
        row.pending = None
        return await _capture_draft(db, user, inbound, draft)

    if ptype == "recategorize":
        row.pending = None
        return await _do_edit(db, user, inbound, "categoria", text.strip())

    if ptype == "share_confirm":
        if folded in ("si", "dale", "ok", "de una", "listo", "sisi", "si dale", "mandale"):
            return await _answer_share(db, user, inbound, row, True)
        return None

    if ptype == "share_contact":
        contact = text.strip()
        if not (participants.is_email(contact) or participants.is_phone(contact)):
            return None
        missing = list(pending.get("missing") or [])
        name = missing.pop(0)
        people = [*(pending.get("people") or []), {"name": name, "user_id": None, "contact": contact}]
        draft = _draft_from_dict(pending["draft"])
        cat = await db.get(ExpenseCategory, pending["cat"])
        row.pending = None
        return await _propose_share(db, user, inbound, draft, cat, people, missing)

    if ptype == "card_pick":
        from app.models.credit_card import CreditCard

        ids = pending.get("cards") or []
        cards = (await db.scalars(select(CreditCard).where(CreditCard.id.in_(ids)))).all() if ids else []
        matched = _match_cards(list(cards), text.strip())
        if len(matched) == 1:
            return await _answer_card_pick(db, user, inbound, row, ids.index(matched[0].id) + 1)
        return None

    return None


async def _do_small_talk(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """Saludar y agradecer no es un gasto que no se entendió. Sin IA y sin cerrar
    ninguna pregunta abierta."""
    from app.services.search import fold_text

    folded = fold_text(text).strip(" .,!?¡¿")
    reply = _SMALL_TALK.get(folded)
    if reply is None and folded in _ASK_HELP:
        reply = MSG_BUSINESS_HELP if await _is_business(db, user) else _with_media_hint(MSG_CAN_DO)
    # Sin fila propia: una fila común cerraría la pregunta que esté abierta, y un
    # reintento del webhook sólo repetiría un "de nada".
    return [reply] if reply is not None else None


async def _do_correction(
    db: AsyncSession, user: User, inbound: InboundMessage, text: str
) -> list[str] | None:
    """Corregir lo recién cargado como se lo diría a una persona: "¿puedo cambiar
    la categoría?", "este es un reintegro", "no es un gasto, es un ingreso", o
    crear una categoría."""
    asked_new = _NEW_CATEGORY_RE.match(text)
    if asked_new and _looks_like_name(asked_new.group(1)):
        cats = (await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
        )).all()
        name = asked_new.group(1).strip()
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        if _match_exact(cats, name) is not None:
            await db.commit()
            return [f"La categoría {name} ya existe."]
        cat = await _create_category(db, user.tenant_id, name)
        await db.commit()
        return [f"✅ Creé la categoría {cat.name}."]

    if _ASK_RECATEGORIZE_RE.match(text):
        ref = await _last_ref(db, user.id, ("expense", "income"), inbound.quoted_wa_id)
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        if ref is None:
            await db.commit()
            return ["No tengo nada reciente para cambiar."]
        reply = "Sí, ¿a cuál?"
        _remember(db, user.id, "out", "text", text=reply, pending={"type": "recategorize"})
        await db.commit()
        return [reply]

    recent = await _last_ref(db, user.id, ("expense", "income"), inbound.quoted_wa_id)
    if recent is None or recent.created_at is None or (
        datetime.now() - recent.created_at > timedelta(minutes=_CORRECTION_MINUTES)
    ):
        return None

    if _IS_INCOME_RE.match(text) and recent.ref_type == "expense":
        entry = await db.get(ExpenseEntry, recent.ref_id)
        if entry is None or entry.tenant_id != user.tenant_id or entry.source != EXPENSE_SOURCE_WHATSAPP:
            return None
        if await _is_business(db, user):
            return None
        draft = quick_capture.QuickDraft(
            amount=entry.amount, currency=entry.currency, expense_date=entry.expense_date,
            term=entry.description or "", legacy=False,
        )
        await expenses_service.delete_expense(db, entry, user.tenant_id)
        recent.ref_type = None
        recent.ref_id = None
        invalidate_suggest(user.tenant_id)
        return await _capture_income(db, user, inbound, draft)

    # "este es un reintegro": sólo si es el nombre de una categoría o una fuente,
    # si no es una descripción o cualquier otra cosa.
    if not re.match(r"^(?:no,?\s+)?(?:este\s+|esto\s+|eso\s+)?(?:es|era)\s", text, re.IGNORECASE):
        return None
    m = _ACTUALLY_RE.match(text)
    if m is None:
        return None
    pool = (
        await income_capture.writable_sources(db, user.tenant_id) if recent.ref_type == "income"
        else (await db.scalars(select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id))).all()
    )
    match, _candidates = _match_name(pool, m.group(1))
    if match is None:
        return None
    return await _do_edit(db, user, inbound, "categoria", match.name)


# ---------------------------------------------------------- con IA: texto ---

async def _interpret(
    db: AsyncSession, user: User, inbound: InboundMessage
) -> tuple[list[str] | None, InboundMessage]:
    """Lo que el código no entendió, leído por la IA y ejecutado por los mismos
    caminos. Devuelve las respuestas (None = sin IA o sin respuesta útil, el que
    llama contesta como siempre) y el mensaje a usar de acá en más: ya registrado
    si se llamó a la IA. Queda anotado, enmascarado, para pasarlo a código."""
    from app.models.credit_card import CreditCard
    from app.services import rate_limit

    if not ai_capture.enabled() or not rate_limit.check(f"wa_ai:{user.tenant_id}", settings.WA_AI_DAILY_LIMIT, 86400):
        return None, inbound
    is_business = await _is_business(db, user)
    row = await _open_pending(db, user.id)
    question = row.text if row is not None and (row.pending or {}).get("type") in _DRAFT_PENDING else None
    cats = (await db.scalars(select(ExpenseCategory.name).where(ExpenseCategory.tenant_id == user.tenant_id))).all()
    sources = [s.name for s in await income_capture.writable_sources(db, user.tenant_id)]
    cards = (await db.scalars(select(CreditCard).where(CreditCard.tenant_id == user.tenant_id))).all()
    raw_text = inbound.text
    # La llamada tarda: si Evolution reintenta el webhook no tiene que cargar dos veces.
    inbound = await _claim_inbound(db, user, inbound)
    intent = await ai_capture.interpret_text(
        raw_text, today=ar_today(), is_business=is_business, categories=list(cats), sources=sources,
        cards=[_card_label(c) for c in cards], question=question,
    )
    if intent is None:
        return None, inbound
    await record_event(
        db, tenant_id=user.tenant_id, user_id=user.id, channel="whatsapp", input_kind="text",
        outcome="ai_ok", bank_detected=f"texto:{intent.action}"[:30], est_input_tokens=intent.input_tokens,
    )
    slots = [k for k in ("amount", "term", "category", "description", "card", "installments", "share_with", "value")
             if getattr(intent, k)]
    await bot_cases.record(db, bot_cases.KIND_TEXT_AI, raw_text, {"action": intent.action, "slots": slots})
    return await _run_intent(db, user, inbound, intent, is_business, row), inbound


async def _run_intent(
    db: AsyncSession, user: User, inbound: InboundMessage, intent: ai_capture.TextIntent,
    is_business: bool, row: WaMessage | None,
) -> list[str] | None:
    async def say(text: str) -> list[str]:
        _remember(db, user.id, "out", "text", text=text)
        await db.commit()
        return [text]

    action = intent.action
    if action in (ai_capture.ACTION_EXPENSE, ai_capture.ACTION_INCOME):
        if intent.amount is None or intent.amount > quick_capture.MAX_AMOUNT:
            return await say("¿Cuánto fue? Mandámelo de nuevo con el monto.")
        draft = quick_capture.QuickDraft(
            amount=intent.amount, currency=intent.currency, expense_date=intent.when or ar_today(),
            term=intent.term, legacy=False, description=intent.description or None,
            category_name=intent.category or None,
            wants_card=bool(intent.card or intent.installments or intent.payment == "tarjeta_credito"),
            card_hint=intent.card or None, installments=intent.installments or None,
            share_with=intent.share_with,
        )
        if action == ai_capture.ACTION_EXPENSE:
            draft.term = draft.term or intent.category or "Gasto"
            method = intent.payment if intent.payment in ("efectivo", "debito", "transferencia") else None
            return await _capture_draft(db, user, inbound, draft, payment_method=method)
        if is_business:
            return await say("En el negocio, lo que entra sale de las ventas: contame qué vendiste.")
        draft.term = intent.category or intent.term
        return await _capture_income(db, user, inbound, draft, notes=intent.description or None)

    if action == ai_capture.ACTION_SALE and is_business:
        parsed = business_capture.parse_business_text(intent.sale_text)
        if parsed is not None:
            from app.services.business import bot as business_bot

            return await business_bot.handle_intent(db, user, inbound, parsed)
        return None

    if action == ai_capture.ACTION_ANSWER and row is not None and intent.value:
        number = _NUMBER_RE.match(intent.value)
        if number:
            return await _do_pending_answer(db, user, inbound, int(number.group(1)), row)
        answered = replace(inbound, text=intent.value)
        for handler in (_do_pending_income_by_name, _do_pending_category_by_name):
            handled = await handler(db, user, answered, row)
            if handled is not None:
                return handled
        return None

    if action == ai_capture.ACTION_NEW_CATEGORY and intent.value:
        if row is not None and (row.pending or {}).get("type") in ("category_pick", "category_name"):
            return await _do_pending_category_by_name(db, user, replace(inbound, text=intent.value), row)
        if _looks_like_name(intent.value):
            cat = await _create_category(db, user.tenant_id, intent.value)
            return await say(f"✅ Creé la categoría {cat.name}.")
        return None

    if action == ai_capture.ACTION_FIX and intent.fix_field and intent.value:
        return await _do_edit(db, user, inbound, intent.fix_field, intent.value)
    if action == ai_capture.ACTION_UNDO:
        return await _do_undo(db, user, inbound)
    if action == ai_capture.ACTION_CHAT and intent.reply:
        return await say(intent.reply)
    if action == ai_capture.ACTION_OUT_OF_SCOPE:
        return await say(MSG_OUT_OF_SCOPE.format(url=settings.FRONTEND_URL))
    return None


# Un parser que no existe, o que leyó mal: los dos se pueden leer de otra manera.
# Una contraseña o un archivo sin texto, no.
_AI_STATEMENT_REASONS = {"no_parser", "totals_mismatch", "no_items"}


async def _statement_with_ai(
    db: AsyncSession, user: User, failed, pdf: bytes, pdf_text: str
):
    """Un resumen que ningún parser lee, leído por la IA y pasado por el mismo
    motor: control de totales, grupos, deshacer. La sesión fallida no queda, para
    no figurar como pendiente. None si no se pudo: sigue el mensaje de siempre."""
    from app.services import rate_limit
    from app.services.statement_parsers import ParseResult

    if not ai_capture.enabled() or not rate_limit.check(f"wa_ai:{user.tenant_id}", settings.WA_AI_DAILY_LIMIT, 86400):
        return None
    await db.commit()  # la llamada tarda hasta 3 minutos: nada abierto mientras tanto
    answer = await ai_capture.read_statement(pdf, pdf_text)
    if answer is None:
        return None
    data, tokens = answer
    await db.delete(failed)
    await db.flush()
    session = await reconcile_service.start_session(
        db, user=user, channel="whatsapp",
        parsed=ParseResult(
            status="ok", bank_id=f"ai:{data.get('bank') or 'otro'}"[:30], data=data,
            est_input_tokens=tokens or 0,
        ),
    )
    await bot_cases.record(db, bot_cases.KIND_STATEMENT_AI, pdf_text, {"bank": data.get("bank"), "status": session.status})
    return session


async def _do_pending_answer(
    db: AsyncSession, user: User, inbound: InboundMessage, number: int, row: WaMessage | None = None,
) -> list[str] | None:
    """Respuesta "1".."9" a la última pregunta abierta. None = no había
    pregunta (el número se intenta como gasto, p. ej. "5000 kiosco")."""
    row = row or await _open_pending(db, user.id)
    if row is None:
        return None
    pending = row.pending or {}
    ptype = pending.get("type")

    if ptype and ptype.startswith("biz_"):
        from app.services.business import bot as business_bot

        return await business_bot.answer_number(db, user, inbound, row, number)

    if ptype == "income_pick":
        return await _answer_income_pick(db, user, inbound, row, number)

    if ptype in ("bill_card", "bill_pick"):
        return await _answer_bill(db, user, inbound, row, number)

    if ptype == "card_pick":
        return await _answer_card_pick(db, user, inbound, row, number)
    if ptype == "own_transfer":
        return await _answer_own_transfer(db, user, inbound, row, number)
    if ptype == "share_confirm":
        return await _answer_share(db, user, inbound, row, number == 1)

    if ptype == "category_pick":
        options = pending.get("options") or []
        if not (1 <= number <= len(options)):
            return [f"Decime un número del 1 al {len(options)}, o el nombre de la categoría."]
        name = options[number - 1]
        cats = (await db.scalars(
            select(ExpenseCategory).where(ExpenseCategory.tenant_id == user.tenant_id)
        )).all()
        from app.services.search import fold_text

        cat = next((c for c in cats if fold_text(c.name) == fold_text(name)), None)
        if cat is None:
            return ["Esa categoría ya no existe. Elegí otra."]
        return await _create_from_pending(db, user, inbound, row, cat)

    if ptype == "reconcile_apply":
        session_id = pending.get("session_id")
        row.pending = None
        _remember(db, user.id, "in", "text", wa_id=inbound.wa_id, text=inbound.text)
        if number == 2:
            await db.commit()
            return [f"Dale, acá lo tenés: {await _conciliar_link(db, user, session_id)}"]
        if number != 1:
            await db.commit()
            return ["Respondé *1* para corregir todo o *2* para verlo en la app."]
        return await _apply_all_groups(db, user, session_id)

    return None


async def _apply_all_groups(db: AsyncSession, user: User, session_id: int) -> list[str]:
    from app.models.reconciliation import ReconciliationSession

    session = await db.get(ReconciliationSession, session_id)
    if session is None or session.tenant_id != user.tenant_id:
        await db.commit()
        return ["No encontré ese resumen."]

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
        lines = [f"✅ Listo: {_groups_text(applied_by_klass, _GROUP_DONE)}."]
    else:
        lines = ["No corregí nada todavía."]
    if session.status == "closed":
        lines.append("Quedó igual que el resumen del banco.")
        lines.append(f"Detalle: {await _conciliar_link(db, user, session_id)}")
    elif skipped_total:
        lines.append(
            f"{'Quedó 1 sin corregir porque le falta' if skipped_total == 1 else f'Quedaron {skipped_total} sin corregir porque les falta'} "
            f"la categoría. Elegila acá: {await _conciliar_link(db, user, session_id)}"
        )
    else:
        remaining = await _pending_group_counts(db, session.id)
        if remaining:
            lines.append(
                f"Falta revisar: {_groups_text(remaining, _GROUP_FOUND)}.\n"
                f"{await _conciliar_link(db, user, session_id)}"
            )
        else:
            lines.append(f"Detalle: {await _conciliar_link(db, user, session_id)}")
    await db.commit()
    return ["\n".join(lines)]
