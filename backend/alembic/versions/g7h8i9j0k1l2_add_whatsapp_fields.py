"""add_whatsapp_fields

Revision ID: g7h8i9j0k1l2
Revises: f6a9b4d3c25e
Create Date: 2026-06-19
"""
from typing import Union
from alembic import op
import sqlalchemy as sa

revision: str = "g7h8i9j0k1l2"
down_revision: Union[str, None] = "f6a9b4d3c25e"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("whatsapp_phone", sa.String(20), nullable=True))
    op.add_column("users", sa.Column("whatsapp_verify_code", sa.String(6), nullable=True))
    op.add_column("users", sa.Column("whatsapp_verify_expires", sa.DateTime(), nullable=True))
    op.create_unique_constraint("uq_users_whatsapp_phone", "users", ["whatsapp_phone"])
    op.create_index("ix_users_whatsapp_phone", "users", ["whatsapp_phone"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_whatsapp_phone", table_name="users")
    op.drop_constraint("uq_users_whatsapp_phone", "users", type_="unique")
    op.drop_column("users", "whatsapp_verify_expires")
    op.drop_column("users", "whatsapp_verify_code")
    op.drop_column("users", "whatsapp_phone")
