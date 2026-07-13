"""add whatsapp_gate_pending to users

Revision ID: t0u1v2w3x4y5
Revises: s9t0u1v2w3x4
Create Date: 2026-07-13

"""
from alembic import op
import sqlalchemy as sa

revision = "t0u1v2w3x4y5"
down_revision = "s9t0u1v2w3x4"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_gate_pending BOOLEAN NOT NULL DEFAULT false"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS whatsapp_gate_pending"))
