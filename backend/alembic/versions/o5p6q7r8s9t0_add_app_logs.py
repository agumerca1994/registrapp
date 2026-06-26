"""add app_logs table

Revision ID: o5p6q7r8s9t0
Revises: n4o5p6q7r8s9
Create Date: 2026-06-26

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = "o5p6q7r8s9t0"
down_revision = "n4o5p6q7r8s9"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS app_logs (
            id SERIAL PRIMARY KEY,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            level VARCHAR(10) NOT NULL,
            logger_name VARCHAR(255),
            message TEXT NOT NULL,
            module VARCHAR(255),
            request_path VARCHAR(500),
            request_method VARCHAR(10),
            status_code INTEGER,
            user_id INTEGER,
            tenant_id INTEGER,
            traceback TEXT,
            extra JSONB
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_app_logs_created_at ON app_logs (created_at DESC)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_app_logs_level ON app_logs (level)"
    ))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS app_logs"))
