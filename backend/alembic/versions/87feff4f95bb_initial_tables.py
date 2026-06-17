"""initial_tables

Revision ID: 87feff4f95bb
Revises:
Create Date: 2026-06-17 23:24:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = '87feff4f95bb'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table('tenants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_table('expense_categories',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('color', sa.String(length=7), nullable=True),
        sa.Column('is_fixed', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_expense_categories_tenant_id'), 'expense_categories', ['tenant_id'], unique=False)
    op.create_table('income_sources',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=120), nullable=False),
        sa.Column('income_type', sa.Enum('salary', 'bonus', 'aguinaldo', 'investment', 'other', name='incometype'), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_income_sources_tenant_id'), 'income_sources', ['tenant_id'], unique=False)
    op.create_table('macro_variables',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('period_date', sa.Date(), nullable=False),
        sa.Column('uva_value', sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column('inflation_monthly_pct', sa.Numeric(precision=8, scale=4), nullable=True),
        sa.Column('usd_official', sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column('usd_mep', sa.Numeric(precision=18, scale=4), nullable=True),
        sa.Column('source', sa.String(length=50), nullable=True),
        sa.Column('updated_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_macro_variables_period_date'), 'macro_variables', ['period_date'], unique=False)
    op.create_index(op.f('ix_macro_variables_tenant_id'), 'macro_variables', ['tenant_id'], unique=False)
    op.create_table('mortgage_records',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('period_date', sa.Date(), nullable=False),
        sa.Column('payment_amount', sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column('capital', sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column('interest', sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column('uva_units', sa.Numeric(precision=18, scale=6), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_mortgage_records_period_date'), 'mortgage_records', ['period_date'], unique=False)
    op.create_index(op.f('ix_mortgage_records_tenant_id'), 'mortgage_records', ['tenant_id'], unique=False)
    op.create_table('users',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('firebase_uid', sa.String(length=128), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('email', sa.String(length=255), nullable=False),
        sa.Column('display_name', sa.String(length=120), nullable=True),
        sa.Column('phone_number', sa.String(length=30), nullable=True),
        sa.Column('role', sa.Enum('admin', 'member', name='userrole'), nullable=False),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('firebase_uid')
    )
    op.create_index(op.f('ix_users_firebase_uid'), 'users', ['firebase_uid'], unique=False)
    op.create_index(op.f('ix_users_tenant_id'), 'users', ['tenant_id'], unique=False)
    op.create_table('expense_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('category_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column('description', sa.String(length=255), nullable=True),
        sa.Column('expense_date', sa.Date(), nullable=False),
        sa.Column('notes', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['category_id'], ['expense_categories.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_expense_entries_expense_date'), 'expense_entries', ['expense_date'], unique=False)
    op.create_index(op.f('ix_expense_entries_tenant_id'), 'expense_entries', ['tenant_id'], unique=False)
    op.create_table('income_entries',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('tenant_id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('source_id', sa.Integer(), nullable=False),
        sa.Column('amount', sa.Numeric(precision=18, scale=2), nullable=False),
        sa.Column('period_date', sa.Date(), nullable=False),
        sa.Column('notes', sa.String(length=500), nullable=True),
        sa.Column('created_at', sa.DateTime(), server_default=sa.text('now()'), nullable=False),
        sa.ForeignKeyConstraint(['source_id'], ['income_sources.id'], ),
        sa.ForeignKeyConstraint(['tenant_id'], ['tenants.id'], ),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
        sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_income_entries_period_date'), 'income_entries', ['period_date'], unique=False)
    op.create_index(op.f('ix_income_entries_tenant_id'), 'income_entries', ['tenant_id'], unique=False)


def downgrade() -> None:
    op.drop_index(op.f('ix_income_entries_tenant_id'), table_name='income_entries')
    op.drop_index(op.f('ix_income_entries_period_date'), table_name='income_entries')
    op.drop_table('income_entries')
    op.drop_index(op.f('ix_expense_entries_tenant_id'), table_name='expense_entries')
    op.drop_index(op.f('ix_expense_entries_expense_date'), table_name='expense_entries')
    op.drop_table('expense_entries')
    op.drop_index(op.f('ix_users_tenant_id'), table_name='users')
    op.drop_index(op.f('ix_users_firebase_uid'), table_name='users')
    op.drop_table('users')
    op.drop_index(op.f('ix_mortgage_records_tenant_id'), table_name='mortgage_records')
    op.drop_index(op.f('ix_mortgage_records_period_date'), table_name='mortgage_records')
    op.drop_table('mortgage_records')
    op.drop_index(op.f('ix_macro_variables_tenant_id'), table_name='macro_variables')
    op.drop_index(op.f('ix_macro_variables_period_date'), table_name='macro_variables')
    op.drop_table('macro_variables')
    op.drop_index(op.f('ix_income_sources_tenant_id'), table_name='income_sources')
    op.drop_table('income_sources')
    op.drop_index(op.f('ix_expense_categories_tenant_id'), table_name='expense_categories')
    op.drop_table('expense_categories')
    op.drop_table('tenants')
