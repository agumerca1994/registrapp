"""add tenant code

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa


revision = 'h8i9j0k1l2m3'
down_revision = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("tenants", sa.Column("code", sa.String(8), nullable=True))

    # Assign random 8-char alphanumeric codes using PostgreSQL native functions
    # substring(md5(...)) gives hex chars 0-9a-f, upper() makes them uppercase
    op.execute(sa.text(
        "UPDATE tenants SET code = upper(substring(md5(random()::text || id::text) from 1 for 8)) "
        "WHERE code IS NULL"
    ))

    op.create_index("ix_tenants_code", "tenants", ["code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_tenants_code", table_name="tenants")
    op.drop_column("tenants", "code")
