"""add due_day to credit_cards

Revision ID: b8c9d0e1f2a3
Revises: a7b8c9d0e1f2
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "b8c9d0e1f2a3"
down_revision = "a7b8c9d0e1f2"
branch_labels = None
depends_on = None


def upgrade():
    # Which day of the month this card's statement usually falls due. Used to
    # estimate the cash-out date of a statement whose real due_date isn't known
    # yet — the bank only sends it at the end of the period, but the statement
    # (and its instalments) already exist and have to land in the right month.
    op.execute(sa.text(
        "ALTER TABLE credit_cards ADD COLUMN IF NOT EXISTS due_day INTEGER"
    ))
    # Seed each card from its own most recent known due date, so the estimate
    # starts out matching the card's real behaviour instead of a generic guess.
    op.execute(sa.text("""
        UPDATE credit_cards c
        SET due_day = sub.day
        FROM (
            SELECT DISTINCT ON (s.card_id)
                   s.card_id, EXTRACT(DAY FROM s.due_date)::int AS day
            FROM credit_card_statements s
            WHERE s.due_date IS NOT NULL
            ORDER BY s.card_id, s.year DESC, s.month DESC
        ) AS sub
        WHERE c.id = sub.card_id AND c.due_day IS NULL
    """))


def downgrade():
    op.execute(sa.text("ALTER TABLE credit_cards DROP COLUMN IF EXISTS due_day"))
