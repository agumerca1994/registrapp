"""el libro del stock de un negocio (stock_movements)

Revision ID: n6o7p8q9r0s1
Revises: m5n6o7p8q9r0
Create Date: 2026-10-10

Stock = SUM(qty) por producto, con el signo en la cantidad: el mismo patrón que
`currency_operations.foreign_amount` para los dólares. El CHECK ata el signo al
tipo: compra y producción suman, venta y merma restan, un ajuste (un conteo)
va para cualquier lado pero nunca es cero.

Un movimiento sale de una compra (`expense_entry_id`), de una venta o del cierre
(`sale_id`), o se carga a mano (producción, conteo, merma). Los dos orígenes
borran en cascada: si se borra la compra o la venta, su stock se va con ella.

`IF NOT EXISTS` para que un deploy caído a mitad pueda reintentar.
"""
from alembic import op
import sqlalchemy as sa

revision = "n6o7p8q9r0s1"
down_revision = "m5n6o7p8q9r0"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS stock_movements (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
            kind VARCHAR(12) NOT NULL CONSTRAINT ck_stock_movements_kind
                CHECK (kind IN ('compra', 'produccion', 'venta', 'ajuste', 'merma')),
            qty NUMERIC(12, 3) NOT NULL,
            movement_date DATE NOT NULL,
            unit_cost NUMERIC(18, 2),
            counted_qty NUMERIC(12, 3),
            expense_entry_id INTEGER REFERENCES expense_entries(id) ON DELETE CASCADE,
            sale_id INTEGER REFERENCES sales(id) ON DELETE CASCADE,
            user_id INTEGER REFERENCES users(id),
            source VARCHAR(20) NOT NULL DEFAULT 'app',
            notes VARCHAR(255),
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT ck_stock_movements_sign CHECK (
                (kind IN ('compra', 'produccion') AND qty > 0)
                OR (kind IN ('venta', 'merma') AND qty < 0)
                OR (kind = 'ajuste' AND qty <> 0)
            ),
            CONSTRAINT ck_stock_movements_one_origin
                CHECK (NOT (expense_entry_id IS NOT NULL AND sale_id IS NOT NULL))
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_stock_movements_tenant_product ON stock_movements (tenant_id, product_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_stock_movements_expense_entry_id ON stock_movements (expense_entry_id)"
    ))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_stock_movements_sale_id ON stock_movements (sale_id)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS stock_movements"))
