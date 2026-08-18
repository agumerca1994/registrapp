"""WhatsApp como canal opcional

Revision ID: c5d6e7f8a9b0
Revises: b4c5d6e7f8a9
Create Date: 2026-08-18

Arranca en `true` para no cambiarle el comportamiento a nadie: hoy quien tiene
número vinculado recibe WhatsApp, y seguirá recibiéndolo hasta que lo apague.
"""
from alembic import op
import sqlalchemy as sa

revision = "c5d6e7f8a9b0"
down_revision = "b4c5d6e7f8a9"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_notifications "
        "BOOLEAN NOT NULL DEFAULT true"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS whatsapp_notifications"))
