"""tokens de auto-login para los links del bot de WhatsApp

Revision ID: j2k3l4m5n6o7
Revises: i1j2k3l4m5n6
Create Date: 2026-10-05

Los links del bot se abren en el navegador interno de WhatsApp, donde el
login de Google no funciona. El bot conoce al destinatario (número
vinculado), así que el link lleva un token de un solo uso (15 min, sha256
en la base) que la página canjea por un custom token de Firebase.

`IF NOT EXISTS` para que un deploy caído a mitad pueda reintentar.
"""
from alembic import op
import sqlalchemy as sa

revision = "j2k3l4m5n6o7"
down_revision = "i1j2k3l4m5n6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS auth_link_tokens (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(64) NOT NULL UNIQUE,
            purpose VARCHAR(20) NOT NULL DEFAULT 'wa_link',
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_auth_link_tokens_user_id ON auth_link_tokens (user_id)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS auth_link_tokens"))
