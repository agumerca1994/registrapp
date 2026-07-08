"""replace user_contacts with tenant_contacts (household-wide agenda)

Revision ID: q7r8s9t0u1v2
Revises: o5p6q7r8s9t0
Create Date: 2026-07-08

"""
from alembic import op
import sqlalchemy as sa

revision = "q7r8s9t0u1v2"
down_revision = "o5p6q7r8s9t0"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS user_contacts"))
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS tenant_contacts (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            contact_name VARCHAR(120) NOT NULL,
            contact_phone VARCHAR(20) NOT NULL,
            created_at TIMESTAMP NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_tenant_contacts_tenant_phone UNIQUE (tenant_id, contact_phone)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_tenant_contacts_tenant_id ON tenant_contacts (tenant_id)"
    ))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS tenant_contacts"))
