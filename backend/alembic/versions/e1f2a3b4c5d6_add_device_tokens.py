"""device_tokens: los tokens de FCM por dispositivo

Revision ID: e1f2a3b4c5d6
Revises: d0e1f2a3b4c5
Create Date: 2026-08-18
"""
from alembic import op
import sqlalchemy as sa

revision = "e1f2a3b4c5d6"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade():
    # IF NOT EXISTS en todo: si un deploy se corta a la mitad, Alembic no marca
    # la revisión y la vuelve a correr entera en el deploy siguiente.
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS device_tokens (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token VARCHAR(512) NOT NULL,
            platform VARCHAR(40),
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now(),
            last_seen_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        )
    """))
    # Único global, no por usuario: dos cuentas en el mismo navegador comparten
    # el token que da FCM, y el último que lo registra es su dueño. Repetirlo
    # mandaría el aviso de una persona a la pantalla de la otra.
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_device_tokens_token ON device_tokens (token)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_device_tokens_user_id ON device_tokens (user_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_device_tokens_tenant_id ON device_tokens (tenant_id)"
    ))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS device_tokens"))
