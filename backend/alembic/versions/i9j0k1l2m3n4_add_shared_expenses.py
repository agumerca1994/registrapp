"""add shared expenses

Revision ID: i9j0k1l2m3n4
Revises: h8i9j0k1l2m3
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision = 'i9j0k1l2m3n4'
down_revision = 'h8i9j0k1l2m3'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS shared_expenses ("
        "id SERIAL PRIMARY KEY,"
        "tenant_id INTEGER NOT NULL REFERENCES tenants(id),"
        "created_by_user_id INTEGER NOT NULL REFERENCES users(id),"
        "title VARCHAR(255) NOT NULL,"
        "total_amount NUMERIC(18,2) NOT NULL,"
        "category_id INTEGER NOT NULL REFERENCES expense_categories(id),"
        "split_type VARCHAR(10) NOT NULL,"
        "expense_date DATE NOT NULL,"
        "locked BOOLEAN NOT NULL DEFAULT FALSE,"
        "created_at TIMESTAMP DEFAULT now()"
        ")"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_expenses_tenant_id ON shared_expenses (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_expenses_expense_date ON shared_expenses (expense_date)"
    ))
    op.execute(sa.text(
        "CREATE TABLE IF NOT EXISTS shared_expense_splits ("
        "id SERIAL PRIMARY KEY,"
        "shared_expense_id INTEGER NOT NULL REFERENCES shared_expenses(id) ON DELETE CASCADE,"
        "user_id INTEGER REFERENCES users(id),"
        "member_name VARCHAR(120) NOT NULL,"
        "amount NUMERIC(18,2) NOT NULL,"
        "status VARCHAR(10) NOT NULL DEFAULT 'pending',"
        "expense_entry_id INTEGER REFERENCES expense_entries(id) ON DELETE SET NULL,"
        "created_at TIMESTAMP DEFAULT now()"
        ")"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_expense_splits_shared_expense_id "
        "ON shared_expense_splits (shared_expense_id)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS shared_expense_splits"))
    op.execute(sa.text("DROP TABLE IF EXISTS shared_expenses"))
