"""rol "employee" para los empleados de un negocio

Revision ID: o7p8q9r0s1t2
Revises: n6o7p8q9r0s1
Create Date: 2026-10-10

`users.role` es un enum de Postgres (`userrole`). Agregarle un valor tiene una
trampa: el valor nuevo no se puede usar en la misma transacción que lo agrega,
y `env.py` corre todas las migraciones pendientes en UNA sola. Por eso va en su
propia migración y dentro de `autocommit_block()`, y ninguna migración usa
'employee'. Bajarla no hace nada: Postgres no deja sacar valores de un enum.
"""
from alembic import op

revision = "o7p8q9r0s1t2"
down_revision = "n6o7p8q9r0s1"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.get_context().autocommit_block():
        op.execute("ALTER TYPE userrole ADD VALUE IF NOT EXISTS 'employee'")


def downgrade() -> None:
    pass
