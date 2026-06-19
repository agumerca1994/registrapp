"""add payment_day to mortgage_loans

Revision ID: f6a9b4d3c25e
Revises: e5f8a3c2b19d
Create Date: 2026-06-19 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'f6a9b4d3c25e'
down_revision: Union[str, None] = 'e5f8a3c2b19d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('mortgage_loans',
        sa.Column('payment_day', sa.Integer(), nullable=True))


def downgrade() -> None:
    op.drop_column('mortgage_loans', 'payment_day')
