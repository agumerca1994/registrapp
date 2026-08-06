"""add currency to income_entries

Revision ID: a7b8c9d0e1f2
Revises: z6a7b8c9d0e1
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "a7b8c9d0e1f2"
down_revision = "z6a7b8c9d0e1"
branch_labels = None
depends_on = None


def upgrade():
    # Every income recorded so far is pesos — the column didn't exist, and the
    # dashboard summed them all as ARS.
    op.execute(sa.text(
        "ALTER TABLE income_entries ADD COLUMN IF NOT EXISTS "
        "currency VARCHAR(3) NOT NULL DEFAULT 'ARS'"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE income_entries DROP COLUMN IF EXISTS currency"))
