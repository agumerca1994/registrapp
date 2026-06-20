"""add tenant code

Revision ID: h8i9j0k1l2m3
Revises: g7h8i9j0k1l2
Create Date: 2026-06-19
"""
from alembic import op
import sqlalchemy as sa
import random
import string


revision = 'h8i9j0k1l2m3'
down_revision = 'g7h8i9j0k1l2'
branch_labels = None
depends_on = None


def _random_code() -> str:
    chars = string.ascii_uppercase + string.digits
    return "".join(random.choices(chars, k=8))


def upgrade() -> None:
    op.add_column("tenants", sa.Column("code", sa.String(8), nullable=True))

    conn = op.get_bind()
    tenants = conn.execute(sa.text("SELECT id FROM tenants ORDER BY id")).fetchall()
    for (tid,) in tenants:
        while True:
            code = _random_code()
            existing = conn.execute(
                sa.text("SELECT id FROM tenants WHERE code = :c"), {"c": code}
            ).fetchone()
            if not existing:
                break
        conn.execute(sa.text("UPDATE tenants SET code = :c WHERE id = :i"), {"c": code, "i": tid})

    op.create_index("ix_tenants_code", "tenants", ["code"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_tenants_code", table_name="tenants")
    op.drop_column("tenants", "code")
