"""add bruto and deducciones to income_entries

Revision ID: c4b9e2d1f7a3
Revises: 87feff4f95bb
Create Date: 2026-06-18 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c4b9e2d1f7a3'
down_revision: Union[str, None] = '87feff4f95bb'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('income_entries', sa.Column('bruto', sa.Numeric(precision=18, scale=2), nullable=True))
    op.add_column('income_entries', sa.Column('deducciones', sa.Numeric(precision=18, scale=2), nullable=True))


def downgrade() -> None:
    op.drop_column('income_entries', 'deducciones')
    op.drop_column('income_entries', 'bruto')
