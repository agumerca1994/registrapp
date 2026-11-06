"""objetivos: cuota fija mensual

Revision ID: u3v4w5x6y7z8
Revises: t2u3v4w5x6y7
"""
from alembic import op
import sqlalchemy as sa

revision = "u3v4w5x6y7z8"
down_revision = "t2u3v4w5x6y7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for ddl in (
        "ADD COLUMN IF NOT EXISTS plan_amount NUMERIC(18, 2)",
        "ADD COLUMN IF NOT EXISTS plan_day INTEGER",
        "ADD COLUMN IF NOT EXISTS plan_paused BOOLEAN NOT NULL DEFAULT false",
    ):
        op.execute(sa.text(f"ALTER TABLE savings_goals {ddl}"))


def downgrade() -> None:
    for col in ("plan_amount", "plan_day", "plan_paused"):
        op.execute(sa.text(f"ALTER TABLE savings_goals DROP COLUMN IF EXISTS {col}"))
