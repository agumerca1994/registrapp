"""add currency to shared_expenses

Revision ID: v2w3x4y5z6a7
Revises: u1v2w3x4y5z6
Create Date: 2026-08-03

"""
from alembic import op
import sqlalchemy as sa

revision = "v2w3x4y5z6a7"
down_revision = "u1v2w3x4y5z6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE shared_expenses ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ARS'"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE shared_expenses DROP COLUMN IF EXISTS currency"))
