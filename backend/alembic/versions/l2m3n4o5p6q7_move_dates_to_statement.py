"""move closing_due_dates to statement, add for-expense lookup

Revision ID: l2m3n4o5p6q7
Revises: k1l2m3n4o5p6
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision = "l2m3n4o5p6q7"
down_revision = "k1l2m3n4o5p6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Remove day-based fields from credit_cards
    op.execute(sa.text("ALTER TABLE credit_cards DROP COLUMN IF EXISTS closing_day"))
    op.execute(sa.text("ALTER TABLE credit_cards DROP COLUMN IF EXISTS due_day"))

    # Add date fields to credit_card_statements
    op.execute(sa.text(
        "ALTER TABLE credit_card_statements ADD COLUMN IF NOT EXISTS closing_date DATE"
    ))
    op.execute(sa.text(
        "ALTER TABLE credit_card_statements ADD COLUMN IF NOT EXISTS due_date DATE"
    ))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE credit_card_statements DROP COLUMN IF EXISTS closing_date"))
    op.execute(sa.text("ALTER TABLE credit_card_statements DROP COLUMN IF EXISTS due_date"))
    op.execute(sa.text("ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS closing_day INTEGER NOT NULL DEFAULT 1"))
    op.execute(sa.text("ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS due_day INTEGER NOT NULL DEFAULT 1"))
