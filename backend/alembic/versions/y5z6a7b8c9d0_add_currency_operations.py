"""add currency_operations and tenant fx_rate_type

Revision ID: y5z6a7b8c9d0
Revises: x4y5z6a7b8c9
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "y5z6a7b8c9d0"
down_revision = "x4y5z6a7b8c9"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS currency_operations (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            op_type VARCHAR(20) NOT NULL,
            operation_date DATE NOT NULL,
            currency VARCHAR(3) NOT NULL DEFAULT 'USD',
            foreign_amount NUMERIC(18, 2) NOT NULL,
            ars_amount NUMERIC(18, 2),
            rate NUMERIC(18, 4),
            rate_type VARCHAR(20),
            entity VARCHAR(100),
            notes VARCHAR(500),
            created_at TIMESTAMP DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_currency_operations_tenant_id "
        "ON currency_operations (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_currency_operations_operation_date "
        "ON currency_operations (operation_date)"
    ))
    # At most one declared starting balance per household and currency — a second
    # one would silently double the holding.
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_currency_op_initial "
        "ON currency_operations (tenant_id, currency) WHERE op_type = 'initial'"
    ))
    op.execute(sa.text(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS "
        "fx_rate_type VARCHAR(20) NOT NULL DEFAULT 'blue'"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS fx_rate_type"))
    op.execute(sa.text("DROP INDEX IF EXISTS uq_currency_op_initial"))
    op.execute(sa.text("DROP TABLE IF EXISTS currency_operations"))
