"""add payment_date to shared_expenses

Revision ID: w3x4y5z6a7b8
Revises: v2w3x4y5z6a7
Create Date: 2026-08-03

"""
from alembic import op
import sqlalchemy as sa

revision = "w3x4y5z6a7b8"
down_revision = "v2w3x4y5z6a7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE shared_expenses ADD COLUMN IF NOT EXISTS payment_date DATE"
    ))

    # Default: payment_date = expense_date (the vast majority of shared expenses
    # are settled the same day they're registered).
    op.execute(sa.text(
        "UPDATE shared_expenses SET payment_date = expense_date WHERE payment_date IS NULL"
    ))

    # Credit-card-linked shared expenses have a real, known payment date: the
    # statement's due_date. Correct those from expense_date (the cuota's
    # accounting date) to the actual due_date wherever one is set.
    op.execute(sa.text(
        """
        UPDATE shared_expenses se
        SET payment_date = ccs.due_date
        FROM credit_card_items cci
        JOIN credit_card_statements ccs ON ccs.id = cci.statement_id
        WHERE se.credit_card_item_id = cci.id AND ccs.due_date IS NOT NULL
        """
    ))

    op.execute(sa.text(
        "ALTER TABLE shared_expenses ALTER COLUMN payment_date SET NOT NULL"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_expenses_payment_date ON shared_expenses (payment_date)"
    ))


def downgrade():
    op.execute(sa.text("DROP INDEX IF EXISTS ix_shared_expenses_payment_date"))
    op.execute(sa.text("ALTER TABLE shared_expenses DROP COLUMN IF EXISTS payment_date"))
