"""wa_signup_intents: lo que mandó por WhatsApp alguien sin cuenta

Revision ID: q9r0s1t2u3v4
Revises: p8q9r0s1t2u3
Create Date: 2026-11-01

Ver models/wa_signup_intent.py y services/wa_signup.py.
"""
import sqlalchemy as sa
from alembic import op

revision = "q9r0s1t2u3v4"
down_revision = "p8q9r0s1t2u3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS wa_signup_intents (
            id SERIAL PRIMARY KEY,
            phone VARCHAR(32) NOT NULL UNIQUE,
            token_hash VARCHAR(64) NULL,
            link_sent_at TIMESTAMP NULL,
            messages JSONB NULL,
            claimed_at TIMESTAMP NULL,
            claimed_user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_wa_signup_intents_token_hash ON wa_signup_intents (token_hash)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS wa_signup_intents"))
