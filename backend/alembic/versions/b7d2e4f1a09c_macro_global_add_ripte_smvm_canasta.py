"""macro global: drop tenant_id, add usd_mayorista/ripte/smvm/canasta

Revision ID: b7d2e4f1a09c
Revises: a3f1c8e92d45
Create Date: 2026-06-18 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa


revision: str = 'b7d2e4f1a09c'
down_revision: Union[str, None] = 'a3f1c8e92d45'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Deduplicate: keep one row per period_date before adding unique constraint
    op.execute("""
        DELETE FROM macro_variables
        WHERE id NOT IN (
            SELECT MIN(id) FROM macro_variables GROUP BY period_date
        )
    """)

    # Drop FK constraint and tenant_id index before dropping the column
    op.execute("ALTER TABLE macro_variables DROP CONSTRAINT IF EXISTS macro_variables_tenant_id_fkey")
    op.execute("DROP INDEX IF EXISTS ix_macro_variables_tenant_id")
    op.drop_column('macro_variables', 'tenant_id')

    # Unique constraint on period_date
    op.create_unique_constraint('uq_macro_period_date', 'macro_variables', ['period_date'])

    # New variable columns
    op.add_column('macro_variables', sa.Column('usd_mayorista', sa.Numeric(18, 4), nullable=True))
    op.add_column('macro_variables', sa.Column('ripte', sa.Numeric(18, 2), nullable=True))
    op.add_column('macro_variables', sa.Column('smvm', sa.Numeric(18, 2), nullable=True))
    op.add_column('macro_variables', sa.Column('canasta_basica_total', sa.Numeric(18, 2), nullable=True))


def downgrade() -> None:
    op.drop_column('macro_variables', 'canasta_basica_total')
    op.drop_column('macro_variables', 'smvm')
    op.drop_column('macro_variables', 'ripte')
    op.drop_column('macro_variables', 'usd_mayorista')
    op.drop_constraint('uq_macro_period_date', 'macro_variables', type_='unique')
    op.add_column('macro_variables', sa.Column('tenant_id', sa.Integer(), nullable=True))
