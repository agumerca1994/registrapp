"""add credit_card_item_id to shared_expenses

Revision ID: n4o5p6q7r8s9
Revises: m3n4o5p6q7r8
Create Date: 2026-06-20

"""
from alembic import op
import sqlalchemy as sa

revision = "n4o5p6q7r8s9"
down_revision = "m3n4o5p6q7r8"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE shared_expenses "
        "ADD COLUMN IF NOT EXISTS credit_card_item_id INT NULL "
        "REFERENCES credit_card_items(id) ON DELETE SET NULL"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_expenses_credit_card_item_id "
        "ON shared_expenses(credit_card_item_id)"
    ))


def downgrade():
    op.execute(sa.text(
        "DROP INDEX IF EXISTS ix_shared_expenses_credit_card_item_id"
    ))
    op.execute(sa.text(
        "ALTER TABLE shared_expenses DROP COLUMN IF EXISTS credit_card_item_id"
    ))
