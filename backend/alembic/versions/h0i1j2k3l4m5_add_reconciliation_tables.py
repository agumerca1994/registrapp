"""conciliación de resúmenes: sesiones, acciones, reglas y embudo de captura

Revision ID: h0i1j2k3l4m5
Revises: g9h0i1j2k3l4
Create Date: 2026-10-05

Cuatro tablas nuevas y una columna:

- `reconciliation_sessions` / `reconciliation_actions`: una lectura del
  resumen del banco comparada contra la app, con cada corrección propuesta y
  su snapshot `before` (lo que hace posible deshacer). El PDF nunca se guarda.
- `capture_rules`: reglas por hogar (resumen→tarjeta, comercio→categoría,
  exclusiones) que el matching aplica antes de preguntar.
- `capture_events`: un evento por intento de captura con el motivo cuando el
  código no pudo resolver — el embudo que decide si la IA de respaldo vale
  su costo. Sin FKs (como app_logs): es telemetría, no datos del hogar.
- `tenants.plan` ("free"/"pro", default free): sin billing, se setea a mano
  por /internal; gatea sólo los caminos que gastarían plata en IA.

Todo idempotente (IF NOT EXISTS) para que un deploy caído a mitad reintente.
"""
from alembic import op
import sqlalchemy as sa

revision = "h0i1j2k3l4m5"
down_revision = "g9h0i1j2k3l4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS plan VARCHAR(10) NOT NULL DEFAULT 'free'"
    ))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS reconciliation_sessions (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            channel VARCHAR(10) NOT NULL DEFAULT 'app',
            card_id INTEGER REFERENCES credit_cards(id) ON DELETE SET NULL,
            statement_id INTEGER REFERENCES credit_card_statements(id) ON DELETE SET NULL,
            status VARCHAR(16) NOT NULL,
            reason VARCHAR(30),
            bank_id VARCHAR(30),
            cardholder VARCHAR(120),
            period_year INTEGER,
            period_month INTEGER,
            closing_date DATE,
            due_date DATE,
            parsed JSONB,
            totals JSONB,
            choices JSONB,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_reconciliation_sessions_tenant_id"
        " ON reconciliation_sessions (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_reconciliation_sessions_status"
        " ON reconciliation_sessions (status)"
    ))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS reconciliation_actions (
            id SERIAL PRIMARY KEY,
            session_id INTEGER NOT NULL REFERENCES reconciliation_sessions(id) ON DELETE CASCADE,
            klass VARCHAR(16) NOT NULL,
            op VARCHAR(20) NOT NULL,
            item_id INTEGER REFERENCES credit_card_items(id) ON DELETE SET NULL,
            payload JSONB,
            before JSONB,
            status VARCHAR(12) NOT NULL DEFAULT 'proposed',
            applied_at TIMESTAMP
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_reconciliation_actions_session_id"
        " ON reconciliation_actions (session_id)"
    ))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS capture_rules (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            kind VARCHAR(20) NOT NULL,
            match VARCHAR(255) NOT NULL,
            payload JSONB,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT uq_capture_rule UNIQUE (tenant_id, kind, match)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_capture_rules_tenant_id ON capture_rules (tenant_id)"
    ))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS capture_events (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL,
            user_id INTEGER,
            channel VARCHAR(10) NOT NULL,
            input_kind VARCHAR(10) NOT NULL,
            outcome VARCHAR(12) NOT NULL,
            reason VARCHAR(20),
            bank_detected VARCHAR(30),
            pages_total INTEGER,
            pages_with_movements INTEGER,
            est_input_tokens INTEGER,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_capture_events_tenant_id ON capture_events (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_capture_events_outcome ON capture_events (outcome)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_capture_events_created_at ON capture_events (created_at)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS reconciliation_actions"))
    op.execute(sa.text("DROP TABLE IF EXISTS reconciliation_sessions"))
    op.execute(sa.text("DROP TABLE IF EXISTS capture_rules"))
    op.execute(sa.text("DROP TABLE IF EXISTS capture_events"))
    op.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS plan"))
