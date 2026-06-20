"""add cross-tenant invite fields and user_contacts table

Revision ID: k1l2m3n4o5p6
Revises: j0k1l2m3n4o5
Create Date: 2026-06-20
"""
import sqlalchemy as sa
from alembic import op

revision = "k1l2m3n4o5p6"
down_revision = "j0k1l2m3n4o5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        ALTER TABLE shared_expense_splits
        ADD COLUMN IF NOT EXISTS invite_email VARCHAR(255),
        ADD COLUMN IF NOT EXISTS invite_token VARCHAR(64),
        ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMP
    """))

    op.execute(sa.text("""
        CREATE UNIQUE INDEX IF NOT EXISTS uq_ses_invite_token
        ON shared_expense_splits (invite_token)
        WHERE invite_token IS NOT NULL
    """))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS user_contacts (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            contact_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            contact_email VARCHAR(255) NOT NULL,
            contact_name VARCHAR(120) NOT NULL,
            created_at TIMESTAMP DEFAULT NOW(),
            UNIQUE(user_id, contact_email)
        )
    """))

    op.execute(sa.text("""
        CREATE INDEX IF NOT EXISTS ix_user_contacts_user_id
        ON user_contacts (user_id)
    """))


def downgrade() -> None:
    pass