"""productos y ventas de un negocio (tickets y cierre del día), y la fuente "Ventas"

Revision ID: m5n6o7p8q9r0
Revises: l4m5n6o7p8q9
Create Date: 2026-10-10

Una venta es un ticket (lo que se vendió, cómo se cobró) o el cierre del día
(lo CONTADO por medio de pago). Los pagos son la verdad de la plata: con
descuentos, las líneas no suman lo cobrado. Por eso `sale_payments` existe
aparte y `sales.total` es la suma de los pagos.

Las ventas entran al libro como UN ingreso por día en la fuente "Ventas"
(`income_sources.system_key = 'sales'`), que el sistema recalcula desde cero
en cada escritura (services/business/sales.py). Así el resultado del mes, la
historia y el conector siguen funcionando sin saber de ventas.

`IF NOT EXISTS` para que un deploy caído a mitad pueda reintentar.
"""
from alembic import op
import sqlalchemy as sa

revision = "m5n6o7p8q9r0"
down_revision = "l4m5n6o7p8q9"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS products (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            name VARCHAR(120) NOT NULL,
            name_key VARCHAR(120) NOT NULL,
            kind VARCHAR(10) NOT NULL DEFAULT 'elaborado'
                CONSTRAINT ck_products_kind CHECK (kind IN ('reventa', 'elaborado')),
            unit VARCHAR(10) NOT NULL DEFAULT 'unidad',
            sale_price NUMERIC(18, 2),
            track_stock BOOLEAN NOT NULL DEFAULT false,
            min_stock NUMERIC(12, 3),
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT uq_products_tenant_name UNIQUE (tenant_id, name_key)
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_products_tenant_id ON products (tenant_id)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS sales (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            sale_date DATE NOT NULL,
            kind VARCHAR(10) NOT NULL DEFAULT 'ticket'
                CONSTRAINT ck_sales_kind CHECK (kind IN ('ticket', 'cierre')),
            total NUMERIC(18, 2) NOT NULL,
            source VARCHAR(20) NOT NULL DEFAULT 'app',
            client_ref VARCHAR(36),
            notes VARCHAR(500),
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            updated_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_sales_tenant_date ON sales (tenant_id, sale_date)"))
    # Un cierre por día, y un `client_ref` (el id que el celular le pone a cada
    # alta) una sola vez: un doble toque o un reintento con mala señal no
    # cobra dos veces.
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_close_per_day ON sales (tenant_id, sale_date) "
        "WHERE kind = 'cierre'"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_client_ref ON sales (tenant_id, client_ref) "
        "WHERE client_ref IS NOT NULL"
    ))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS sale_lines (
            id SERIAL PRIMARY KEY,
            sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
            product_id INTEGER REFERENCES products(id) ON DELETE RESTRICT,
            description VARCHAR(120),
            qty NUMERIC(12, 3) NOT NULL CONSTRAINT ck_sale_lines_qty CHECK (qty > 0),
            unit_price NUMERIC(18, 2),
            position INTEGER NOT NULL DEFAULT 0,
            CONSTRAINT ck_sale_lines_what CHECK (product_id IS NOT NULL OR description IS NOT NULL)
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_sale_lines_sale_id ON sale_lines (sale_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_sale_lines_product_id ON sale_lines (product_id)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS sale_payments (
            id SERIAL PRIMARY KEY,
            sale_id INTEGER NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
            method VARCHAR(20) NOT NULL CONSTRAINT ck_sale_payments_method
                CHECK (method IN ('efectivo', 'debito', 'credito', 'mercadopago', 'transferencia', 'otro')),
            amount NUMERIC(18, 2) NOT NULL CONSTRAINT ck_sale_payments_amount CHECK (amount > 0),
            CONSTRAINT uq_sale_payments_method UNIQUE (sale_id, method)
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_sale_payments_sale_id ON sale_payments (sale_id)"))

    op.execute(sa.text("ALTER TABLE income_sources ADD COLUMN IF NOT EXISTS system_key VARCHAR(20)"))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_income_sources_system_key "
        "ON income_sources (tenant_id, system_key) WHERE system_key IS NOT NULL"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP INDEX IF EXISTS uq_income_sources_system_key"))
    op.execute(sa.text("ALTER TABLE income_sources DROP COLUMN IF EXISTS system_key"))
    op.execute(sa.text("DROP TABLE IF EXISTS sale_payments"))
    op.execute(sa.text("DROP TABLE IF EXISTS sale_lines"))
    op.execute(sa.text("DROP TABLE IF EXISTS sales"))
    op.execute(sa.text("DROP TABLE IF EXISTS products"))
