"""add tenant code

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa


revision = 'h8i9j0k1l2m3'
down_revision = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Use IF NOT EXISTS so re-running after a partial failure is safe
    op.execute(sa.text(
        "ALTER TABLE tenants ADD COLUMN IF NOT EXISTS code VARCHAR(8)"
    ))
    op.execute(sa.text(
        "UPDATE tenants "
        "SET code = upper(substring(md5(random()::text || id::text) from 1 for 8)) "
        "WHERE code IS NULL"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_tenants_code ON tenants (code)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS ix_tenants_code"))
    op.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS code"))
