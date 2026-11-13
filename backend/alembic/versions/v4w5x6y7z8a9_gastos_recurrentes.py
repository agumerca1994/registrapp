"""gastos recurrentes: series y meses a confirmar

Crea `recurrences`, suma `recurrence_id` / `recurrence_status` a
`expense_entries` y adopta los ítems de tarjeta ya marcados "Recurrente".

Hasta acá "Recurrente" era una etiqueta: nada los repetía. Decisión del usuario
(2026-11-13): los del mes actual o del anterior se toman como meses aceptados,
y cada uno arranca su cadena con el mes siguiente a confirmar. Los más viejos
quedan como estaban (si se generaran, aparecerían de golpe suscripciones que ya
no existen). Si el mes siguiente ya tiene un ítem con la misma descripción en
esa tarjeta, cargado a mano, ése pasa a ser el último aceptado y la cadena
sigue desde él, en vez de duplicarlo.

Revision ID: v4w5x6y7z8a9
Revises: u3v4w5x6y7z8
"""
from calendar import monthrange
from datetime import date, datetime
from zoneinfo import ZoneInfo

import sqlalchemy as sa
from alembic import op

revision = "v4w5x6y7z8a9"
down_revision = "u3v4w5x6y7z8"
branch_labels = None
depends_on = None


def _fold(s: str | None) -> str:
    import unicodedata

    s = unicodedata.normalize("NFKD", (s or "").strip().lower())
    return "".join(c for c in s if not unicodedata.combining(c))


def _period_after(y: int, m: int) -> tuple[int, int]:
    return (y + 1, 1) if m == 12 else (y, m + 1)


def _next_date(prev: date, day: int) -> date:
    y, m = _period_after(prev.year, prev.month)
    return date(y, m, min(day, monthrange(y, m)[1]))


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS recurrences (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            description VARCHAR(255),
            category_id INTEGER NOT NULL REFERENCES expense_categories(id),
            currency VARCHAR(3) NOT NULL DEFAULT 'ARS',
            amount NUMERIC(18, 2) NOT NULL,
            day INTEGER NOT NULL,
            card_id INTEGER REFERENCES credit_cards(id) ON DELETE CASCADE,
            payment_method VARCHAR(30),
            bank_description VARCHAR(255),
            status VARCHAR(10) NOT NULL DEFAULT 'active',
            ended_at DATE,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_recurrences_tenant_id ON recurrences (tenant_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_recurrences_card_id ON recurrences (card_id)"))
    op.execute(sa.text(
        "ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS recurrence_id INTEGER "
        "REFERENCES recurrences(id) ON DELETE SET NULL"
    ))
    op.execute(sa.text("ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS recurrence_status VARCHAR(10)"))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_expense_entries_recurrence_id ON expense_entries (recurrence_id)"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_expense_recurrence_pending ON expense_entries (recurrence_id) "
        "WHERE recurrence_status = 'pending'"
    ))
    _adopt_legacy(op.get_bind())


def _adopt_legacy(conn) -> None:
    today = datetime.now(ZoneInfo("America/Argentina/Buenos_Aires")).date()
    prev_y, prev_m = (today.year - 1, 12) if today.month == 1 else (today.year, today.month - 1)
    rows = conn.execute(sa.text("""
        SELECT i.id, i.description, i.category_id, i.item_date, i.amount, i.currency,
               i.expense_entry_id, i.bank_description, s.year, s.month, s.card_id,
               s.tenant_id, e.user_id, e.recurrence_id
        FROM credit_card_items i
        JOIN credit_card_statements s ON s.id = i.statement_id
        JOIN expense_entries e ON e.id = i.expense_entry_id
        WHERE i.item_type = 'recurring' AND s.year * 100 + s.month >= :since
        ORDER BY s.year, s.month, i.item_date, i.id
    """), {"since": prev_y * 100 + prev_m}).mappings().all()

    latest: dict[tuple, dict] = {}
    for r in rows:
        latest[(r["card_id"], _fold(r["description"]), r["currency"])] = dict(r)

    for (card_id, key, currency), r in latest.items():
        if r["recurrence_id"] is not None:
            continue
        day = r["item_date"].day
        series_id = conn.execute(sa.text("""
            INSERT INTO recurrences (tenant_id, user_id, description, category_id, currency,
                                     amount, day, card_id, bank_description, status)
            VALUES (:t, :u, :d, :c, :cur, :a, :day, :card, :bd, 'active')
            RETURNING id
        """), {"t": r["tenant_id"], "u": r["user_id"], "d": r["description"], "c": r["category_id"],
               "cur": currency, "a": r["amount"], "day": day, "card": card_id,
               "bd": r["bank_description"]}).scalar_one()
        conn.execute(sa.text(
            "UPDATE expense_entries SET recurrence_id = :s, recurrence_status = 'confirmed' WHERE id = :e"
        ), {"s": series_id, "e": r["expense_entry_id"]})

        bank = conn.execute(sa.text("SELECT bank FROM credit_cards WHERE id = :c"), {"c": card_id}).scalar_one()
        y, m, prev_date, amount = r["year"], r["month"], r["item_date"], r["amount"]
        for _ in range(24):
            y, m = _period_after(y, m)
            stmt_id = conn.execute(sa.text(
                "SELECT id FROM credit_card_statements WHERE card_id = :c AND year = :y AND month = :m"
            ), {"c": card_id, "y": y, "m": m}).scalar()
            if stmt_id is not None:
                # ¿Ya está cargado a mano ese mes? Pasa a ser el último aceptado.
                same = [
                    x for x in conn.execute(sa.text("""
                        SELECT i.id, i.description, i.item_date, i.amount, i.expense_entry_id
                        FROM credit_card_items i JOIN expense_entries e ON e.id = i.expense_entry_id
                        WHERE i.statement_id = :s AND i.currency = :cur AND i.item_type <> 'installment'
                          AND e.recurrence_id IS NULL
                        ORDER BY i.id
                    """), {"s": stmt_id, "cur": currency}).mappings().all()
                    if _fold(x["description"]) == key
                ]
                if same:
                    x = same[0]
                    conn.execute(sa.text(
                        "UPDATE credit_card_items SET item_type = 'recurring' WHERE id = :i"
                    ), {"i": x["id"]})
                    conn.execute(sa.text(
                        "UPDATE expense_entries SET recurrence_id = :s, recurrence_status = 'confirmed' WHERE id = :e"
                    ), {"s": series_id, "e": x["expense_entry_id"]})
                    prev_date, amount = x["item_date"], x["amount"]
                    conn.execute(sa.text("UPDATE recurrences SET amount = :a WHERE id = :s"),
                                 {"a": amount, "s": series_id})
                    continue
            else:
                stmt_id = conn.execute(sa.text("""
                    INSERT INTO credit_card_statements (tenant_id, card_id, year, month, status)
                    VALUES (:t, :c, :y, :m, 'open') RETURNING id
                """), {"t": r["tenant_id"], "c": card_id, "y": y, "m": m}).scalar_one()

            when = _next_date(prev_date, day)
            entry_id = conn.execute(sa.text("""
                INSERT INTO expense_entries (tenant_id, user_id, category_id, amount, description,
                    expense_date, payment_method, entity, currency, source,
                    recurrence_id, recurrence_status)
                VALUES (:t, :u, :c, :a, :d, :dt, 'tarjeta_credito', :bank, :cur, 'credit_card',
                    :s, 'pending')
                RETURNING id
            """), {"t": r["tenant_id"], "u": r["user_id"], "c": r["category_id"], "a": amount,
                   "d": r["description"], "dt": when, "bank": bank, "cur": currency,
                   "s": series_id}).scalar_one()
            conn.execute(sa.text("""
                INSERT INTO credit_card_items (statement_id, description, category_id, item_date,
                    item_type, amount, currency, expense_entry_id, bank_description, capture_source)
                VALUES (:st, :d, :c, :dt, 'recurring', :a, :cur, :e, :bd, 'recurrence')
            """), {"st": stmt_id, "d": r["description"], "c": r["category_id"], "dt": when,
                   "a": amount, "cur": currency, "e": entry_id, "bd": r["bank_description"]})
            break


def downgrade() -> None:
    # Los meses a confirmar que generaron las series son gastos que nadie
    # cargó: se van con ellas.
    op.execute(sa.text("""
        DELETE FROM credit_card_items WHERE expense_entry_id IN (
            SELECT id FROM expense_entries WHERE recurrence_status = 'pending')
    """))
    op.execute(sa.text("DELETE FROM expense_entries WHERE recurrence_status = 'pending'"))
    op.execute(sa.text("DROP INDEX IF EXISTS uq_expense_recurrence_pending"))
    op.execute(sa.text("DROP INDEX IF EXISTS ix_expense_entries_recurrence_id"))
    op.execute(sa.text("ALTER TABLE expense_entries DROP COLUMN IF EXISTS recurrence_status"))
    op.execute(sa.text("ALTER TABLE expense_entries DROP COLUMN IF EXISTS recurrence_id"))
    op.execute(sa.text("DROP TABLE IF EXISTS recurrences"))
