"""tipo de cuenta: hogar o negocio

Revision ID: k3l4m5n6o7p8
Revises: j2k3l4m5n6o7
Create Date: 2026-10-10

RegistrApp Negocio vive en la misma base: un negocio es un tenant más, con
`kind='business'`. Todos los existentes quedan como hogar por el DEFAULT, así
que nadie ve nada distinto hasta que un tenant se convierta a mano
(`PATCH /internal/tenants/{id}/kind`) o el alta de negocios se abra.

VARCHAR + CHECK y no un enum de Postgres: agregarle un valor a un enum no se
puede usar en la misma transacción, y `env.py` corre todas las migraciones
pendientes en una sola. El CHECK va en la misma cláusula que la columna, así
`IF NOT EXISTS` saltea las dos juntas si un deploy caído reintenta.
"""
from alembic import op
import sqlalchemy as sa

revision = "k3l4m5n6o7p8"
down_revision = "j2k3l4m5n6o7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        ALTER TABLE tenants ADD COLUMN IF NOT EXISTS kind VARCHAR(20) NOT NULL
            DEFAULT 'household'
            CONSTRAINT ck_tenants_kind CHECK (kind IN ('household', 'business'))
    """))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE tenants DROP COLUMN IF EXISTS kind"))
