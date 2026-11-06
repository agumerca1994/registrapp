"""créditos (la hipoteca pasa a ser un tipo más) y objetivos de ahorro

Revision ID: s1t2u3v4w5x6
Revises: r0s1t2u3v4w5
"""
from alembic import op
import sqlalchemy as sa

revision = "s1t2u3v4w5x6"
down_revision = "r0s1t2u3v4w5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Todo con default: la pantalla de Hipoteca de producción sigue creando
    # préstamos sin mandar estos campos.
    for ddl in (
        "ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL DEFAULT 'hipotecario'",
        "ADD COLUMN IF NOT EXISTS adjustment VARCHAR(12) NOT NULL DEFAULT 'uva'",
        "ADD COLUMN IF NOT EXISTS amortization VARCHAR(12) NOT NULL DEFAULT 'frances'",
        "ADD COLUMN IF NOT EXISTS method VARCHAR(12) NOT NULL DEFAULT 'cuota'",
        "ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ARS'",
        "ADD COLUMN IF NOT EXISTS capital NUMERIC(18, 2)",
        "ADD COLUMN IF NOT EXISTS plan_status VARCHAR(12)",
    ):
        op.execute(sa.text(f"ALTER TABLE mortgage_loans {ddl}"))

    # Los préstamos que ya existen se traducen desde su loan_type.
    op.execute(sa.text("""
        UPDATE mortgage_loans SET
            adjustment = CASE WHEN loan_type IN ('uva_frances', 'uva_aleman') THEN 'uva' ELSE 'fija' END,
            amortization = CASE WHEN loan_type = 'uva_aleman' THEN 'aleman' ELSE 'frances' END,
            method = CASE WHEN loan_type = 'tasa_variable' THEN 'manual' ELSE 'cuota' END
    """))

    for ddl in (
        "ADD COLUMN IF NOT EXISTS cuota_number INTEGER",
        "ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ARS'",
        "ADD COLUMN IF NOT EXISTS is_manual BOOLEAN NOT NULL DEFAULT false",
    ):
        op.execute(sa.text(f"ALTER TABLE mortgage_records {ddl}"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS savings_goals (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name VARCHAR(80) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'USD',
            target_amount NUMERIC(18, 2) NOT NULL,
            target_date DATE,
            archived_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_savings_goals_tenant_id ON savings_goals (tenant_id)"))
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS savings_contributions (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            goal_id INTEGER NOT NULL REFERENCES savings_goals(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            amount NUMERIC(18, 2) NOT NULL,
            contribution_date DATE NOT NULL,
            note VARCHAR(255),
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_savings_contributions_tenant_id ON savings_contributions (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_savings_contributions_goal_id ON savings_contributions (goal_id)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS savings_contributions"))
    op.execute(sa.text("DROP TABLE IF EXISTS savings_goals"))
    for col in ("cuota_number", "currency", "is_manual"):
        op.execute(sa.text(f"ALTER TABLE mortgage_records DROP COLUMN IF EXISTS {col}"))
    for col in ("kind", "adjustment", "amortization", "method", "currency", "capital", "plan_status"):
        op.execute(sa.text(f"ALTER TABLE mortgage_loans DROP COLUMN IF EXISTS {col}"))
