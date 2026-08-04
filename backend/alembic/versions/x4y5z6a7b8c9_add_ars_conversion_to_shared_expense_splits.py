"""add ars conversion fields to shared_expense_splits

Revision ID: x4y5z6a7b8c9
Revises: w3x4y5z6a7b8
Create Date: 2026-08-04

"""
from alembic import op
import sqlalchemy as sa

revision = "x4y5z6a7b8c9"
down_revision = "w3x4y5z6a7b8"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE shared_expense_splits ADD COLUMN IF NOT EXISTS converted_ars_amount NUMERIC(18, 2)"
    ))
    op.execute(sa.text(
        "ALTER TABLE shared_expense_splits ADD COLUMN IF NOT EXISTS converted_ars_rate NUMERIC(18, 4)"
    ))
    op.execute(sa.text(
        "ALTER TABLE shared_expense_splits ADD COLUMN IF NOT EXISTS converted_ars_rate_type VARCHAR(20)"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE shared_expense_splits DROP COLUMN IF EXISTS converted_ars_rate_type"))
    op.execute(sa.text("ALTER TABLE shared_expense_splits DROP COLUMN IF EXISTS converted_ars_rate"))
    op.execute(sa.text("ALTER TABLE shared_expense_splits DROP COLUMN IF EXISTS converted_ars_amount"))
