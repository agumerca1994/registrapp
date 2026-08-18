"""shared_contacts: la agenda que puede crecer

Revision ID: b4c5d6e7f8a9
Revises: a3b4c5d6e7f8
Create Date: 2026-08-18

`tenant_contacts` no podía crecer: `contact_phone` era NOT NULL *y* mitad de la
clave única, así que un contacto sólo-mail o un usuario registrado sin teléfono
guardado no tenían dónde ir.

`tenant_contacts` NO se borra acá a propósito: `GET/DELETE /internal/tenant-contacts`
son herramientas de ops documentadas, y romperlas en medio de un incidente es
peor que convivir una release con las dos tablas. Se borra en una revisión
posterior, después de repuntar esos dos endpoints.
"""
from alembic import op
import sqlalchemy as sa

revision = "b4c5d6e7f8a9"
down_revision = "a3b4c5d6e7f8"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS shared_contacts (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            contact_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            display_name VARCHAR(120) NOT NULL,
            contact_email VARCHAR(255),
            contact_phone VARCHAR(20),
            person_key VARCHAR(160) NOT NULL,
            use_count INTEGER NOT NULL DEFAULT 0,
            last_used_at TIMESTAMP WITHOUT TIME ZONE,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_shared_contacts_person "
        "ON shared_contacts (tenant_id, person_key)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_contacts_tenant ON shared_contacts (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_shared_contacts_user ON shared_contacts (contact_user_id)"
    ))

    # Traspaso: la agenda vieja es toda por teléfono, así que su person_key es
    # 'p:' + el número. ON CONFLICT por si la migración se corre dos veces.
    op.execute(sa.text("""
        INSERT INTO shared_contacts (tenant_id, display_name, contact_phone, person_key)
        SELECT tenant_id, contact_name, contact_phone, 'p:' || contact_phone
        FROM tenant_contacts
        ON CONFLICT (tenant_id, person_key) DO NOTHING
    """))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS shared_contacts"))
