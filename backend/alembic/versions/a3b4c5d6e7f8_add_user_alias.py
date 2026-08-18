"""alias y visibilidad en users

Revision ID: a3b4c5d6e7f8
Revises: f2a3b4c5d6e7
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa

revision = "a3b4c5d6e7f8"
down_revision = "f2a3b4c5d6e7"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS alias VARCHAR(30)"))
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS discoverable BOOLEAN NOT NULL DEFAULT true"
    ))
    # Único parcial: muchos usuarios sin alias conviven, pero un alias elegido
    # es de una sola persona.
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_users_alias ON users (alias) WHERE alias IS NOT NULL"
    ))


def downgrade():
    op.execute(sa.text("DROP INDEX IF EXISTS ix_users_alias"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS discoverable"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS alias"))
