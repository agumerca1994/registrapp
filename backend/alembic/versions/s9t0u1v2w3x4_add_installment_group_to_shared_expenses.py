"""add installment_group_id to shared_expenses

Revision ID: s9t0u1v2w3x4
Revises: r8s9t0u1v2w3
Create Date: 2026-07-13

"""
from alembic import op
import sqlalchemy as sa

revision = "s9t0u1v2w3x4"
down_revision = "r8s9t0u1v2w3"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        ALTER TABLE shared_expenses
        ADD COLUMN IF NOT EXISTS installment_group_id INTEGER
        REFERENCES shared_expenses(id) ON DELETE SET NULL
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_expenses_installment_group_id "
        "ON shared_expenses (installment_group_id)"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE shared_expenses DROP COLUMN IF EXISTS installment_group_id"))
