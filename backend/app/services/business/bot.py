"""El bot de WhatsApp de un negocio: ventas, el cierre del día, compras,
producción, conteos, consultas de stock y pagos.

`capture.parse_business_text` dice QUÉ pasó; acá se resuelve contra los
productos y los proveedores del negocio y se ejecuta con las mismas funciones
que usan la app y el conector (`sales`, `stock`, `products`, y el gasto del bot
de siempre). El canal traduce, el motor decide.

Cuando lo escrito no alcanza —dos productos que se llaman parecido, una venta
sin monto ni precio, "hice 30 X" de un producto que no existe— se pregunta con
opciones numeradas, y la respuesta retoma desde donde quedó: el estado entero
viaja en `wa_messages.pending` (los tipos `biz_*`).

Reglas:
- Un empleado carga ventas, el cierre y el stock de hoy y de ayer, la misma
  ventana que la app (`access.assert_staff_day`). Compras, pagos y gastos son
  de los dueños.
- Lo que no es un producto no se inventa. En una venta queda como texto libre;
  en una compra el gasto se carga igual, sin stock (es materia prima). Sólo
  "hice 30 X" ofrece crear el producto, y sólo a un dueño.
- Una compra entra al stock sólo como gasto simple: con tarjeta va por la app.
- Todo responde lo que entendió, y se deshace con *deshacer*.
"""
from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

from fastapi import HTTPException
from sqlalchemy import select

from app.core.access import Actor, assert_staff_day
from app.models.business import (
    PRODUCT_KIND_RESALE, SALE_KIND_TICKET, STOCK_KIND_PRODUCTION, STOCK_KIND_PURCHASE,
    Payee, Product, Sale, StockMovement,
)
from app.models.expense import ExpenseCategory
from app.models.tenant import TENANT_KIND_BUSINESS
from app.models.wa_message import WaMessage
from app.schemas.business import SaleLineIn, SalePaymentIn
from app.services import quick_capture, wa_bot as wa
from app.services.business import capture, payees as payees_service, products as products_service, sales, stock
from app.services.business.capture import fmt_qty
from app.services.business.sales import METHOD_LABELS
from app.services.clock import business_today
from app.services.search import fold_text

# Lo que `deshacer` sabe revertir, además de un gasto.
BUSINESS_REFS = ("sale", "close", "stock")
OWNER_OPS = {"purchase", "pay", "expense"}
# El medio de un gasto simple: los de `services/expenses.PAYMENT_METHODS`. En
# una compra o un pago, Mercado Pago es una transferencia.
EXPENSE_METHODS = {
    "efectivo": "efectivo", "debito": "debito", "transferencia": "transferencia", "mercadopago": "transferencia",
}
MSG_CARD = (
    "Con tarjeta de crédito cargalo desde la app (Egresos → Tarjeta): así va al resumen "
    "que corresponde. Si entró mercadería, sumala en Productos → Ingreso."
)
MSG_STAFF_WINDOW = "Como empleado podés cargar y corregir lo de hoy y de ayer."
MSG_UNDO_HINT = "Respondé *deshacer* si algo no quedó bien."


# ── Contexto y memoria ────────────────────────────────────────────────────────

def _ctx(user) -> SimpleNamespace:
    """Lo que hace falta del usuario, leído una vez. Después de un rollback el
    objeto del ORM queda expirado, y leerlo en async es un MissingGreenlet."""
    employee = wa._is_employee(user)
    return SimpleNamespace(
        id=user.id, tenant_id=user.tenant_id, employee=employee, role="employee" if employee else None,
    )


def _day_ok(ctx, day: date) -> bool:
    if not ctx.employee:
        return True
    try:
        assert_staff_day(Actor(user=ctx, tenant_kind=TENANT_KIND_BUSINESS), day)
    except HTTPException:
        return False
    return True


async def _done(db, ctx, inbound, reply: str, *, ref_type=None, ref_id=None, pending=None) -> list[str]:
    wa._remember(db, ctx.id, "in", inbound.kind, wa_id=inbound.wa_id, text=inbound.text or None,
                 ref_type=ref_type, ref_id=ref_id)
    wa._remember(db, ctx.id, "out", "text", text=reply, pending=pending)
    await db.commit()
    return [reply]


async def _ask(db, ctx, inbound, st: dict, ptype: str, question: str, **extra) -> list[str]:
    return await _done(db, ctx, inbound, question, pending={"type": ptype, "state": st, **extra})


async def _drop_superseded(db, user_id: int) -> None:
    """Un mensaje nuevo del negocio deja sin efecto las preguntas del negocio
    que quedaron abiertas y la oferta de descripción: si no, un "1" o un texto
    de más tarde contestaría algo que ya no está en pantalla. La pregunta de
    categoría de un gasto no se toca: sin respuesta, ese gasto no existe."""
    rows = (await db.scalars(
        select(WaMessage).where(
            WaMessage.user_id == user_id, WaMessage.pending.is_not(None), WaMessage.created_at >= wa._cutoff(),
        )
    )).all()
    for row in rows:
        ptype = (row.pending or {}).get("type") or ""
        if ptype.startswith("biz_") or ptype == "description_offer":
            row.pending = None


# ── Formato ───────────────────────────────────────────────────────────────────

def _money(amount) -> str:
    formatted = f"{Decimal(amount):,.2f}".replace(",", "@").replace(".", ",").replace("@", ".")
    return wa._money(formatted, "ARS")


def _when(day: date) -> str:
    today = business_today()
    if day == today:
        return "de hoy"
    if day == today - timedelta(days=1):
        return "de ayer"
    return f"del {day.strftime('%d/%m')}"


def _key(n: int) -> str:
    return f"{n}️⃣"


def _names(names: list[str]) -> str:
    return names[0] if len(names) == 1 else ", ".join(names[:-1]) + " y " + names[-1]


def _items_text(items: list[dict]) -> str:
    return " + ".join(f"{fmt_qty(it['qty'])} {it['label']}" for it in items)


def _now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


# ── Estado ────────────────────────────────────────────────────────────────────

def _state(intent: capture.Intent, text: str) -> dict:
    """La intención como dato: es lo que se guarda mientras se espera una respuesta."""
    return {
        "op": intent.op,
        "day": (business_today() - timedelta(days=intent.day_offset)).isoformat(),
        "amount": None if intent.amount is None else str(intent.amount),
        "method": intent.method,
        "payments": {m: str(a) for m, a in intent.payments.items()},
        "each": intent.each,
        "items": [
            {"qty": str(it.qty), "term": it.term, "label": capture.display(text, it.term), "pid": None, "skip": False}
            for it in intent.items
        ],
        "payee": None if not intent.payee_term else {
            "term": intent.payee_term, "label": capture.display(text, intent.payee_term), "id": None, "skip": False,
        },
        "counted": {m: str(a) for m, a in intent.counted.items()},
        "term": intent.term,
        "label": capture.display(text, intent.term),
    }


def _amount(st: dict) -> Decimal | None:
    if st["payments"]:
        return sum((Decimal(a) for a in st["payments"].values()), Decimal(0))
    if st["amount"] is None:
        return None
    amount = Decimal(st["amount"])
    if st["each"]:  # "a 1500 c/u"
        amount *= sum((Decimal(it["qty"]) for it in st["items"]), Decimal(0)) or Decimal(1)
    return amount.quantize(Decimal("0.01"))


def _payee_id(st: dict) -> int | None:
    return (st.get("payee") or {}).get("id")


async def _products(db, ids) -> dict[int, Product]:
    if not ids:
        return {}
    return {p.id: p for p in (await db.scalars(select(Product).where(Product.id.in_(ids)))).all()}


async def _category_named(db, tenant_id: int, name: str) -> ExpenseCategory | None:
    key = fold_text(name)
    cats = (await db.scalars(select(ExpenseCategory).where(ExpenseCategory.tenant_id == tenant_id))).all()
    return next((c for c in cats if fold_text(c.name) == key), None)


# ── Entradas ──────────────────────────────────────────────────────────────────

async def handle_intent(db, user, inbound, intent: capture.Intent) -> list[str]:
    ctx = _ctx(user)
    await _drop_superseded(db, ctx.id)
    return await _run(db, ctx, inbound, _state(intent, inbound.text))


async def answer_number(db, user, inbound, row: WaMessage, number: int) -> list[str] | None:
    """La respuesta "1".."9" a una pregunta del negocio. None = no era una."""
    pending = row.pending or {}
    ptype = pending.get("type")
    if ptype not in ("biz_pick", "biz_payee", "biz_create", "biz_kind"):
        return None
    st = pending["state"]
    if ptype == "biz_kind":
        if number not in (1, 2):
            return ["Respondé *1* si fue una venta o *2* si fue una compra."]
        st["op"] = "sale" if number == 1 else "purchase"
    elif ptype == "biz_create":
        if number not in (1, 2):
            return ["Respondé *1* para crearlo o *2* para dejarlo afuera."]
        st["items"][pending["index"]]["create" if number == 1 else "skip"] = True
    else:
        options = pending.get("options") or []
        if not 1 <= number <= len(options) + 1:
            return [f"Respondé un número del 1 al {len(options) + 1}."]
        target = st["payee"] if ptype == "biz_payee" else st["items"][pending["index"]]
        if number <= len(options):
            target["id" if ptype == "biz_payee" else "pid"] = options[number - 1]["id"]
            target["label"] = options[number - 1]["name"]
        else:
            target["skip"] = True
    row.pending = None
    return await _run(db, _ctx(user), inbound, st)


async def answer_text(db, user, inbound) -> list[str] | None:
    """La respuesta a "¿cuánto cobraste/pagaste?": sólo un monto (y el medio).
    None = no era eso, y el mensaje sigue su camino."""
    amount, method = capture.parse_amount(inbound.text)
    if amount is None or amount <= 0:
        return None
    row = await wa._open_pending(db, user.id)
    if row is None or (row.pending or {}).get("type") != "biz_amount":
        return None
    st = row.pending["state"]
    st.update(amount=str(amount), payments={}, each=False)
    if method:
        st["method"] = method
    row.pending = None
    return await _run(db, _ctx(user), inbound, st)


async def _run(db, ctx, inbound, st: dict) -> list[str]:
    op = st["op"]
    day = date.fromisoformat(st["day"])
    if ctx.employee:
        if op in OWNER_OPS:
            return await _done(db, ctx, inbound, wa.MSG_EMPLOYEE_ONLY)
        if op == "ambiguous":
            st["op"] = op = "sale"  # un empleado no carga compras
        if op != "query" and not _day_ok(ctx, day):
            return await _done(db, ctx, inbound, MSG_STAFF_WINDOW)
    try:
        if op == "ambiguous":
            return await _ask(db, ctx, inbound, st, "biz_kind",
                              f"¿Qué fue?\n{_key(1)} Una venta\n{_key(2)} Una compra")
        if op in ("sale", "purchase", "production", "count"):
            asked = await _resolve_items(db, ctx, inbound, st)
            if asked is not None:
                return asked
        if st.get("payee"):
            asked = await _resolve_payee(db, ctx, inbound, st)
            if asked is not None:
                return asked
        handler = {
            "sale": _sale, "close": _close, "purchase": _purchase, "production": _production,
            "count": _count, "query": _query, "pay": _expense, "expense": _expense,
        }[op]
        return await handler(db, ctx, inbound, st, day)
    except HTTPException as exc:
        # Una regla del servicio (un producto archivado con ese nombre, una
        # cantidad en cero): se contesta, no es un error del bot.
        await db.rollback()
        return await _done(db, ctx, inbound, f"No pude cargarlo: {exc.detail}")


async def _resolve_items(db, ctx, inbound, st: dict) -> list[str] | None:
    """Cada ítem a un producto. Devuelve la pregunta si hace falta una."""
    op = st["op"]
    for i, it in enumerate(st["items"]):
        if it["pid"] is not None or it["skip"]:
            continue
        if it.get("create"):
            product = await products_service.create_product(
                db, ctx.tenant_id, name=it["label"], kind="elaborado", track_stock=True,
            )
            it.update(pid=product.id, label=product.name, created=True)
            continue
        matches = await products_service.resolve_product(db, ctx.tenant_id, it["term"]) if it["term"] else []
        if len(matches) == 1:
            it.update(pid=matches[0].id, label=matches[0].name)
        elif len(matches) > 1:
            options = [{"id": p.id, "name": p.name} for p in matches[:8]]
            none = {"sale": "Ninguno: dejarlo como texto", "purchase": "Ninguno: no va al stock"}.get(op, "Ninguno")
            listed = "\n".join(f"{_key(n)} {o['name']}" for n, o in enumerate(options, 1))
            question = f"¿Cuál es «{it['label']}»?\n{listed}\n{_key(len(options) + 1)} {none}"
            return await _ask(db, ctx, inbound, st, "biz_pick", question, index=i, options=options)
        elif op == "production" and not ctx.employee:
            question = f"No tengo un producto «{it['label']}». ¿Lo creo?\n{_key(1)} Sí, crearlo\n{_key(2)} No"
            return await _ask(db, ctx, inbound, st, "biz_create", question, index=i)
        else:
            it["skip"] = True
    return None


async def _resolve_payee(db, ctx, inbound, st: dict) -> list[str] | None:
    payee = st["payee"]
    if payee["id"] is not None or payee["skip"]:
        return None
    matches = await payees_service.resolve_payee(db, ctx.tenant_id, payee["term"])
    if len(matches) == 1:
        payee.update(id=matches[0].id, label=matches[0].name)
    elif len(matches) > 1 and st["op"] == "pay":
        options = [{"id": p.id, "name": p.name} for p in matches[:8]]
        listed = "\n".join(f"{_key(n)} {o['name']}" for n, o in enumerate(options, 1))
        question = f"¿A quién le pagaste?\n{listed}\n{_key(len(options) + 1)} Ninguno de estos"
        return await _ask(db, ctx, inbound, st, "biz_payee", question, options=options)
    else:
        payee["skip"] = True
    return None


# ── Operaciones ───────────────────────────────────────────────────────────────

async def _sale(db, ctx, inbound, st: dict, day: date) -> list[str]:
    items = st["items"]
    products = await _products(db, [it["pid"] for it in items if it["pid"]])
    lines = [
        SaleLineIn(product_id=it["pid"], qty=Decimal(it["qty"]), unit_price=products[it["pid"]].sale_price)
        if it["pid"] else SaleLineIn(description=it["label"] or it["term"], qty=Decimal(it["qty"]))
        for it in items
    ]
    if st["payments"]:
        payments = [SalePaymentIn(method=m, amount=Decimal(a)) for m, a in st["payments"].items()]
    else:
        amount = _amount(st)
        if amount is None and lines and all(ln.unit_price is not None for ln in lines):
            # Sin monto pero con precio en todos: a precio de lista.
            amount = sum((ln.qty * ln.unit_price for ln in lines), Decimal(0)).quantize(Decimal("0.01"))
            st["listed"] = True
        if amount is None:
            what = f" por {_items_text(items)}" if items else ""
            return await _ask(db, ctx, inbound, st, "biz_amount",
                              f"¿Cuánto cobraste{what}? Escribí el total, por ejemplo *6500 efectivo*.")
        payments = [SalePaymentIn(method=st["method"] or "efectivo", amount=amount)]

    sale, _ = await sales.create_ticket(
        db, tenant_id=ctx.tenant_id, user_id=ctx.id, sale_date=day, lines=lines, payments=payments,
        source="whatsapp",
    )
    how = " + ".join(f"{_money(p.amount)} en {METHOD_LABELS[p.method]}" for p in payments)
    head = f"✅ Venta {_when(day)}: " + (f"{_items_text(items)} · " if items else "") + how
    out = [head + (" (a precio de lista)" if st.get("listed") else "")]
    out += await _stock_warnings(db, ctx.tenant_id, [p for p in products.values() if p.track_stock])
    if await sales.get_close(db, ctx.tenant_id, day) is not None:
        out.append(
            "ℹ️ Ese día ya tiene cierre, y el día suma lo contado. Si esta venta no estaba "
            "en la caja al cerrar, mandá el cierre de nuevo."
        )
    out.append(MSG_UNDO_HINT)
    return await _done(db, ctx, inbound, "\n".join(out), ref_type="sale", ref_id=sale.id)


async def _stock_warnings(db, tenant_id: int, products: list[Product]) -> list[str]:
    if not products:
        return []
    levels = await stock.on_hand(db, tenant_id, [p.id for p in products])
    out = []
    for p in products:
        n = levels.get(p.id, Decimal(0))
        if n < 0:
            todo = "el ingreso" if p.kind == PRODUCT_KIND_RESALE else "la producción"
            out.append(f"⚠️ {p.name} quedó en {fmt_qty(n)}: cargá {todo}.")
    return out


async def _close(db, ctx, inbound, st: dict, day: date) -> list[str]:
    counted = [SalePaymentIn(method=m, amount=Decimal(a)) for m, a in st["counted"].items()]
    previous = await sales.get_close(db, ctx.tenant_id, day)
    replaced = previous is not None
    # Volver a cerrar por chat cambia la plata, no las unidades del cierre que
    # se hayan cargado en la app: sin esto, `upsert_close` las borraría.
    units = [SaleLineIn(product_id=ln.product_id, qty=ln.qty) for ln in previous.lines if ln.product_id] if replaced else None
    notes = previous.notes if replaced else None
    close = await sales.upsert_close(
        db, tenant_id=ctx.tenant_id, user_id=ctx.id, day=day, counted=counted, units=units, notes=notes,
        source="whatsapp",
    )
    summary = await sales.day_summary(db, ctx.tenant_id, day)
    parts = " · ".join(f"{METHOD_LABELS[p.method]} {_money(p.amount)}" for p in counted)
    out = [f"✅ Cierre {_when(day)}: {parts}" + (f" = {_money(close.total)}" if len(counted) > 1 else "")]
    if summary.tickets:
        line = f"Ventas cargadas: {_money(summary.ticketed_total)}"
        if close.total > summary.ticketed_total:
            line += f" · sin ticket: {_money(close.total - summary.ticketed_total)}"
        out.append(line)
    out += [f"⚠️ {w}" for w in summary.warnings]
    if replaced:
        # Deshacer borraría el cierre entero, también lo que había antes.
        out.append("Reemplazó al cierre que ya tenía ese día. Si algo no quedó bien, mandalo de nuevo.")
        return await _done(db, ctx, inbound, "\n".join(out))
    out.append(MSG_UNDO_HINT)
    return await _done(db, ctx, inbound, "\n".join(out), ref_type="close", ref_id=close.id)


async def _purchase(db, ctx, inbound, st: dict, day: date) -> list[str]:
    if st["method"] == "credito":
        return await _done(db, ctx, inbound, MSG_CARD)
    items = st["items"]
    stocked = [it for it in items if it["pid"] and not it["skip"]]
    if not stocked:
        # Nada de lo comprado es un producto: es materia prima o un insumo, y
        # va como cualquier gasto, con su categoría.
        st["term"] = " y ".join(it["term"] for it in items)
        st["label"] = " y ".join(it["label"] for it in items)
        return await _expense(db, ctx, inbound, st, day)
    amount = _amount(st)
    if amount is None:
        return await _ask(db, ctx, inbound, st, "biz_amount",
                          f"¿Cuánto pagaste por {_items_text(items)}? Escribí el total, por ejemplo *18 lucas*.")
    draft = quick_capture.QuickDraft(
        amount=amount, currency="ARS", expense_date=day, term=_items_text(items), legacy=False,
    )
    extra = {"stock": [{"pid": it["pid"], "qty": it["qty"]} for it in stocked], "payee_id": _payee_id(st)}
    return await wa._capture_draft(
        db, ctx, inbound, draft, payment_method=EXPENSE_METHODS.get(st["method"] or ""),
        category=await _category_named(db, ctx.tenant_id, "Mercadería"), extra=extra,
    )


async def _expense(db, ctx, inbound, st: dict, day: date) -> list[str]:
    """Un gasto o un pago, por el mismo camino que el gasto de siempre del bot
    (categoría, preguntas, deshacer), con el proveedor o empleado si se nombró."""
    if st["method"] == "credito":
        return await _done(db, ctx, inbound, MSG_CARD)
    amount = _amount(st)
    if amount is None:
        what = f" por {st['label']}" if st.get("label") else ""
        return await _ask(db, ctx, inbound, st, "biz_amount",
                          f"¿Cuánto pagaste{what}? Escribí el total, por ejemplo *18 lucas*.")
    term = st.get("label") or st.get("term") or ""
    payee = await db.get(Payee, _payee_id(st)) if _payee_id(st) else None
    category = None
    if payee is not None:
        term = payee.name
        if payee.default_category_id:
            category = await db.get(ExpenseCategory, payee.default_category_id)
        elif payee.kind == "empleado":
            category = await _category_named(db, ctx.tenant_id, "Sueldos")
    elif not term and st.get("payee"):
        term = st["payee"]["label"]
    draft = quick_capture.QuickDraft(amount=amount, currency="ARS", expense_date=day, term=term or "Pago", legacy=False)
    return await wa._capture_draft(
        db, ctx, inbound, draft, payment_method=EXPENSE_METHODS.get(st["method"] or ""),
        category=category, extra={"payee_id": payee.id} if payee is not None else None,
    )


def _not_found(ctx, missing: list[str]) -> str:
    who = "Pedile al dueño que los cargue en Productos." if ctx.employee else "Se cargan en Productos, en la app."
    return f"No encontré {_names(missing)} entre los productos. {who}"


async def _production(db, ctx, inbound, st: dict, day: date) -> list[str]:
    batch = _now()  # el mismo instante en todo el mensaje: deshacer lo borra junto
    done, missing = [], []
    for it in st["items"]:
        if not it["pid"]:
            missing.append(it["label"])
            continue
        product = await products_service.assert_owns_product(db, ctx.tenant_id, it["pid"])
        # Un producto de reventa no se produce: entra (lo mismo que hace la app).
        kind = STOCK_KIND_PURCHASE if product.kind == PRODUCT_KIND_RESALE else STOCK_KIND_PRODUCTION
        movement = await stock.record_movement(
            db, tenant_id=ctx.tenant_id, user_id=ctx.id, product_id=product.id, kind=kind,
            qty=Decimal(it["qty"]), movement_date=day, source="whatsapp",
        )
        movement.created_at = batch
        done.append((product, Decimal(it["qty"]), movement))
    if not done:
        return await _done(db, ctx, inbound, _not_found(ctx, missing))
    levels = await stock.on_hand(db, ctx.tenant_id, [p.id for p, _, _ in done])
    what = " · ".join(f"{fmt_qty(q)} {p.name} (hay {fmt_qty(levels.get(p.id, 0))})" for p, q, _ in done)
    out = [f"✅ Producción {_when(day)}: {what}"]
    created = [it["label"] for it in st["items"] if it.get("created")]
    if created:
        out.append(f"Creé {_names(created)} en Productos: el precio de venta se pone desde la app.")
    if missing:
        out.append(_not_found(ctx, missing))
    out.append(MSG_UNDO_HINT)
    return await _done(db, ctx, inbound, "\n".join(out), ref_type="stock", ref_id=done[0][2].id)


async def _count(db, ctx, inbound, st: dict, day: date) -> list[str]:
    batch = _now()
    parts, moves, missing = [], [], []
    for it in st["items"]:
        if not it["pid"]:
            missing.append(it["label"])
            continue
        product = await products_service.assert_owns_product(db, ctx.tenant_id, it["pid"])
        counted = Decimal(it["qty"])
        movement = await stock.record_count(
            db, tenant_id=ctx.tenant_id, user_id=ctx.id, product_id=product.id, counted_qty=counted,
            movement_date=day, source="whatsapp",
        )
        if movement is None:
            parts.append(f"{product.name} {fmt_qty(counted)} (ya coincidía)")
            continue
        movement.created_at = batch
        moves.append(movement)
        sign = "+" if movement.qty > 0 else ""
        parts.append(f"{product.name} {fmt_qty(counted)} (ajuste {sign}{fmt_qty(movement.qty)})")
    if not parts:
        return await _done(db, ctx, inbound, _not_found(ctx, missing))
    out = [f"📦 Conteo {_when(day)}: " + " · ".join(parts)]
    if missing:
        out.append(_not_found(ctx, missing))
    if moves:
        out.append(MSG_UNDO_HINT)
    ref = ("stock", moves[0].id) if moves else (None, None)
    return await _done(db, ctx, inbound, "\n".join(out), ref_type=ref[0], ref_id=ref[1])


def _alert(alert: str | None) -> str:
    return {"negativo": " ⚠️ en negativo: falta cargar producción o ingreso", "bajo": " ⚠️ queda poco"}.get(alert or "", "")


async def _query(db, ctx, inbound, st: dict, day: date) -> list[str]:
    levels = await stock.stock_levels(db, ctx.tenant_id)
    if not st["term"]:
        if not levels:
            return await _done(db, ctx, inbound, (
                "Todavía no hay productos con stock. Se activa solo cuando cargás la "
                "producción o una compra de un producto."
            ))
        levels.sort(key=lambda lv: (lv["alert"] is None, lv["name"]))
        out = ["📦 Stock:"] + [f"• {lv['name']}: {fmt_qty(lv['on_hand'])}{_alert(lv['alert'])}" for lv in levels[:15]]
        if len(levels) > 15:
            out.append(f"… y {len(levels) - 15} más en la app.")
        return await _done(db, ctx, inbound, "\n".join(out))
    matches = await products_service.resolve_product(db, ctx.tenant_id, st["term"])
    if not matches:
        return await _done(db, ctx, inbound, f"No encontré «{st['label']}» entre los productos.")
    by_id = {lv["product_id"]: lv for lv in levels}
    rows = [
        f"{p.name}: {fmt_qty(by_id[p.id]['on_hand'])}{_alert(by_id[p.id]['alert'])}" if p.id in by_id
        else f"{p.name}: no lleva stock"
        for p in matches[:8]
    ]
    reply = f"📦 {rows[0]}" if len(rows) == 1 else "📦 Stock:\n" + "\n".join(f"• {r}" for r in rows)
    return await _done(db, ctx, inbound, reply)


# ── Deshacer y editar ─────────────────────────────────────────────────────────

async def undo(db, user, inbound, ref: WaMessage) -> list[str]:
    """Deshace una venta, un cierre o un movimiento de stock cargados por el bot."""
    ctx = _ctx(user)
    try:
        reply = await _undo(db, ctx, ref)
    except HTTPException as exc:
        await db.rollback()
        return await _done(db, ctx, inbound, f"No pude deshacerlo: {exc.detail}")
    return await _done(db, ctx, inbound, reply)


async def _undo(db, ctx, ref: WaMessage) -> str:
    if ref.ref_type in ("sale", "close"):
        sale = await db.get(Sale, ref.ref_id)
        if sale is None or sale.tenant_id != ctx.tenant_id:
            ref.ref_type = ref.ref_id = None
            return "Eso ya no está: se borró desde la app."
        day = sale.sale_date
        if not _day_ok(ctx, day):
            return MSG_STAFF_WINDOW
        if sale.kind == SALE_KIND_TICKET:
            total = sale.total
            await sales.delete_ticket(db, sale, user_id=ctx.id)
            reply = f"🗑️ Deshecha la venta {_when(day)} de {_money(total)}."
        else:
            await sales.delete_close(db, tenant_id=ctx.tenant_id, user_id=ctx.id, day=day)
            reply = f"🗑️ Deshecho el cierre {_when(day)}: el día vuelve a sumar las ventas cargadas."
    else:
        first = await db.get(StockMovement, ref.ref_id)
        if first is None or first.tenant_id != ctx.tenant_id:
            ref.ref_type = ref.ref_id = None
            return "Eso ya no está: se borró desde la app."
        if not _day_ok(ctx, first.movement_date):
            return MSG_STAFF_WINDOW
        # Todo lo que cargó ese mensaje ("hice 30 empanadas y 10 tartas").
        group = (await db.scalars(
            select(StockMovement).where(
                StockMovement.tenant_id == ctx.tenant_id, StockMovement.user_id == first.user_id,
                StockMovement.created_at == first.created_at, StockMovement.source == "whatsapp",
                StockMovement.sale_id.is_(None), StockMovement.expense_entry_id.is_(None),
            ).order_by(StockMovement.id)
        )).all()
        products = await _products(db, [m.product_id for m in group])
        names = list(dict.fromkeys(products[m.product_id].name for m in group))
        for movement in group:
            await stock.delete_manual_movement(db, ctx.tenant_id, movement.id)
        reply = f"🗑️ Deshecho lo que cargué de {_names(names)}."
    ref.ref_type = ref.ref_id = None
    return reply


async def edit_sale_amount(db, user, inbound, ref: WaMessage, value: str) -> list[str]:
    """`editar monto 7000` sobre la última venta: cambia lo cobrado, si se cobró
    con un solo medio (con dos, cuál cambia es ambiguo: desde la app)."""
    ctx = _ctx(user)
    sale = await db.get(Sale, ref.ref_id)
    if sale is None or sale.tenant_id != ctx.tenant_id or sale.kind != SALE_KIND_TICKET:
        return await _done(db, ctx, inbound, "Esa venta ya no está.")
    day = sale.sale_date
    if not _day_ok(ctx, day):
        return await _done(db, ctx, inbound, MSG_STAFF_WINDOW)
    amount, _ = capture.parse_amount(value)
    if amount is None or amount <= 0:
        return await _done(db, ctx, inbound, "No entendí el monto. Probá: *editar monto 7000*")
    if len(sale.payments) != 1:
        return await _done(db, ctx, inbound, "Esa venta se cobró con más de un medio: corregila desde la app.")
    method = sale.payments[0].method
    lines = [
        SaleLineIn(product_id=ln.product_id, description=ln.description, qty=ln.qty, unit_price=ln.unit_price)
        for ln in sale.lines
    ]
    try:
        await sales.update_ticket(
            db, sale, user_id=ctx.id, sale_date=day, lines=lines,
            payments=[SalePaymentIn(method=method, amount=amount)], notes=sale.notes,
        )
    except HTTPException as exc:
        await db.rollback()
        return await _done(db, ctx, inbound, f"No pude cambiarlo: {exc.detail}")
    return await _done(db, ctx, inbound, f"✏️ Listo: venta {_when(day)} · {_money(amount)} en {METHOD_LABELS[method]}")
