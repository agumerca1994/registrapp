"""add titular to credit_cards

Revision ID: u1v2w3x4y5z6
Revises: t0u1v2w3x4y5
Create Date: 2026-07-15

"""
from alembic import op
import sqlalchemy as sa

revision = "u1v2w3x4y5z6"
down_revision = "t0u1v2w3x4y5"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS titular VARCHAR(100)"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE credit_cards DROP COLUMN IF EXISTS titular"))
