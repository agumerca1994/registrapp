"""proveedores y empleados de un negocio (payees) y a quién se le pagó cada gasto

Revision ID: l4m5n6o7p8q9
Revises: k3l4m5n6o7p8
Create Date: 2026-10-10

Una sola tabla para los dos: un proveedor y un empleado son lo mismo para el
libro (alguien a quien se le paga), y una sola tabla da un solo selector, un
solo agregado y ningún estado inválido de "las dos cosas a la vez". `kind`
sólo decide cómo se los agrupa en pantalla.

`default_category_id` es lo que vuelve automático "pagué 80 lucas a Juan":
Juan → Sueldos. `name_key` es el nombre plegado (sin acentos ni mayúsculas),
único por negocio, para no tener a "Verdulería" y "verduleria" por separado.

`IF NOT EXISTS` para que un deploy caído a mitad pueda reintentar.
"""
from alembic import op
import sqlalchemy as sa

revision = "l4m5n6o7p8q9"
down_revision = "k3l4m5n6o7p8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS payees (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            name VARCHAR(120) NOT NULL,
            name_key VARCHAR(120) NOT NULL,
            kind VARCHAR(12) NOT NULL DEFAULT 'proveedor'
                CONSTRAINT ck_payees_kind CHECK (kind IN ('proveedor', 'empleado', 'otro')),
            default_category_id INTEGER REFERENCES expense_categories(id) ON DELETE SET NULL,
            notes VARCHAR(255),
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT uq_payees_tenant_name UNIQUE (tenant_id, name_key)
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_payees_tenant_id ON payees (tenant_id)"))
    op.execute(sa.text("""
        ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS payee_id INTEGER
            REFERENCES payees(id) ON DELETE SET NULL
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_expense_entries_payee_id ON expense_entries (payee_id)"
    ))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE expense_entries DROP COLUMN IF EXISTS payee_id"))
    op.execute(sa.text("DROP TABLE IF EXISTS payees"))
