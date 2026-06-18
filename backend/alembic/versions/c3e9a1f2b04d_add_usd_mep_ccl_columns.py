"""add usd_mep and usd_ccl columns to macro_variables

Revision ID: c3e9a1f2b04d
Revises: b7d2e4f1a09c
Create Date: 2026-06-18 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'c3e9a1f2b04d'
down_revision: Union[str, None] = 'b7d2e4f1a09c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('macro_variables', sa.Column('usd_mep', sa.Numeric(18, 4), nullable=True))
    op.add_column('macro_variables', sa.Column('usd_ccl', sa.Numeric(18, 4), nullable=True))


def downgrade() -> None:
    op.drop_column('macro_variables', 'usd_ccl')
    op.drop_column('macro_variables', 'usd_mep')
