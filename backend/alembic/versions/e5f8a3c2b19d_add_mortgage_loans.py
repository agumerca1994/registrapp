"""add mortgage_loans table and FK columns on mortgage_records

Revision ID: e5f8a3c2b19d
Revises: d4f5b6c7e08a
Create Date: 2026-06-19 00:00:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'e5f8a3c2b19d'
down_revision: Union[str, None] = 'd4f5b6c7e08a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'mortgage_loans',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), sa.ForeignKey('tenants.id'), nullable=False),
        sa.Column('loan_type', sa.String(20), nullable=False),
        sa.Column('description', sa.String(255), nullable=True),
        sa.Column('loan_number', sa.String(50), nullable=True),
        sa.Column('total_cuotas', sa.Integer(), nullable=False),
        sa.Column('first_payment_date', sa.Date(), nullable=False),
        sa.Column('cuota_uva', sa.Numeric(18, 6), nullable=True),
        sa.Column('cuota_pesos', sa.Numeric(18, 2), nullable=True),
        sa.Column('tna', sa.Numeric(8, 4), nullable=True),
        sa.Column('original_capital_uva', sa.Numeric(18, 6), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_mortgage_loans_tenant_id', 'mortgage_loans', ['tenant_id'])
    op.create_index('ix_mortgage_loans_is_active', 'mortgage_loans', ['is_active'])

    op.add_column('mortgage_records',
        sa.Column('mortgage_loan_id', sa.Integer(), sa.ForeignKey('mortgage_loans.id'), nullable=True))
    op.add_column('mortgage_records',
        sa.Column('expense_entry_id', sa.Integer(), sa.ForeignKey('expense_entries.id'), nullable=True))
    op.create_index('ix_mortgage_records_loan', 'mortgage_records', ['mortgage_loan_id'])


def downgrade() -> None:
    op.drop_index('ix_mortgage_records_loan', 'mortgage_records')
    op.drop_column('mortgage_records', 'expense_entry_id')
    op.drop_column('mortgage_records', 'mortgage_loan_id')
    op.drop_index('ix_mortgage_loans_is_active', 'mortgage_loans')
    op.drop_index('ix_mortgage_loans_tenant_id', 'mortgage_loans')
    op.drop_table('mortgage_loans')
