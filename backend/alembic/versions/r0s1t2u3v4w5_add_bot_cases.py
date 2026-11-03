"""add bot_cases

Revision ID: r0s1t2u3v4w5
Revises: q9r0s1t2u3v4
"""
from alembic import op
import sqlalchemy as sa

revision = "r0s1t2u3v4w5"
down_revision = "q9r0s1t2u3v4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS bot_cases (
            id SERIAL PRIMARY KEY,
            kind VARCHAR(20) NOT NULL,
            shape VARCHAR(1500) NOT NULL,
            shape_hash VARCHAR(64) NOT NULL,
            resolution JSONB,
            count INTEGER NOT NULL DEFAULT 1,
            first_seen TIMESTAMP NOT NULL DEFAULT now(),
            last_seen TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_bot_cases_kind ON bot_cases (kind)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_bot_cases_shape_hash ON bot_cases (shape_hash)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_bot_cases_last_seen ON bot_cases (last_seen)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS bot_cases"))
