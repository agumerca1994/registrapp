"""add usd_blue and inflation_interanual, drop usd_mep

Revision ID: a3f1c8e92d45
Revises: c4b9e2d1f7a3
Create Date: 2026-06-18 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'a3f1c8e92d45'
down_revision: Union[str, None] = 'c4b9e2d1f7a3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('macro_variables', sa.Column('inflation_interanual_pct', sa.Numeric(8, 4), nullable=True))
    op.add_column('macro_variables', sa.Column('usd_blue', sa.Numeric(18, 4), nullable=True))
    op.drop_column('macro_variables', 'usd_mep')


def downgrade() -> None:
    op.add_column('macro_variables', sa.Column('usd_mep', sa.Numeric(18, 4), nullable=True))
    op.drop_column('macro_variables', 'usd_blue')
    op.drop_column('macro_variables', 'inflation_interanual_pct')
