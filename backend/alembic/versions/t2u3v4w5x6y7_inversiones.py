"""inversiones: dónde está la plata y cuánto vale hoy

Revision ID: t2u3v4w5x6y7
Revises: s1t2u3v4w5x6
"""
from alembic import op
import sqlalchemy as sa

revision = "t2u3v4w5x6y7"
down_revision = "s1t2u3v4w5x6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS investments (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            name VARCHAR(80) NOT NULL,
            kind VARCHAR(20) NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'ARS',
            institution VARCHAR(80),
            tna NUMERIC(8, 4),
            start_date DATE NOT NULL,
            maturity_date DATE,
            closed_at DATE,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_investments_tenant_id ON investments (tenant_id)"))
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS investment_movements (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            investment_id INTEGER NOT NULL REFERENCES investments(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            kind VARCHAR(12) NOT NULL,
            amount NUMERIC(18, 2) NOT NULL,
            movement_date DATE NOT NULL,
            note VARCHAR(255),
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_investment_movements_tenant_id ON investment_movements (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_investment_movements_investment_id ON investment_movements (investment_id)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS investment_movements"))
    op.execute(sa.text("DROP TABLE IF EXISTS investments"))
