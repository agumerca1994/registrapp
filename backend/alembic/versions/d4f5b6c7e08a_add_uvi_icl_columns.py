"""add uvi and icl columns to macro_variables

Revision ID: d4f5b6c7e08a
Revises: c3e9a1f2b04d
Create Date: 2026-06-18 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'd4f5b6c7e08a'
down_revision: Union[str, None] = 'c3e9a1f2b04d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('macro_variables', sa.Column('uvi', sa.Numeric(18, 2), nullable=True))
    op.add_column('macro_variables', sa.Column('icl', sa.Numeric(18, 4), nullable=True))


def downgrade() -> None:
    op.drop_column('macro_variables', 'icl')
    op.drop_column('macro_variables', 'uvi')
