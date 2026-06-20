"""add currency field to expense_entries and credit_card_items

Revision ID: m3n4o5p6q7r8
Revises: l2m3n4o5p6q7
Create Date: 2026-06-20

"""
from alembic import op
import sqlalchemy as sa

revision = "m3n4o5p6q7r8"
down_revision = "l2m3n4o5p6q7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ARS'"
    ))
    op.execute(sa.text(
        "ALTER TABLE credit_card_items ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'ARS'"
    ))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE expense_entries DROP COLUMN IF EXISTS currency"))
    op.execute(sa.text("ALTER TABLE credit_card_items DROP COLUMN IF EXISTS currency"))
