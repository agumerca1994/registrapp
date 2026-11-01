"""pausar y eliminar la cuenta: users.paused_at y users.deleted_at

Revision ID: p8q9r0s1t2u3
Revises: o7p8q9r0s1t2
Create Date: 2026-11-01

Las dos son nullable y sin default: nadie queda pausado ni eliminado por la
migración. Ver services/account_closure.py.
"""
import sqlalchemy as sa
from alembic import op

revision = "p8q9r0s1t2u3"
down_revision = "o7p8q9r0s1t2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS paused_at TIMESTAMP NULL"))
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL"))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS deleted_at"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS paused_at"))
