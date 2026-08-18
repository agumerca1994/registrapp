"""nombre y apellido por separado

Revision ID: d6e7f8a9b0c1
Revises: c5d6e7f8a9b0
Create Date: 2026-08-18

`display_name` se mantiene y se sigue derivando de los dos: es la clave por la
que busca el directorio, la que agrupa personKey() y la que quedó escrita en
cada split ya creado. El backfill parte el nombre existente en el primer
espacio: el primer token es el nombre y el resto el apellido, que es lo correcto
para "María del Carmen García" y para la enorme mayoría de los casos.
"""
from alembic import op
import sqlalchemy as sa

revision = "d6e7f8a9b0c1"
down_revision = "c5d6e7f8a9b0"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(60)"))
    op.execute(sa.text("ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(60)"))
    # `display_name` NO se toca: nadie tiene que ver que su nombre cambió por
    # una migración.
    op.execute(sa.text("""
        UPDATE users
        SET first_name = split_part(trim(display_name), ' ', 1),
            last_name = NULLIF(
                substr(trim(display_name), length(split_part(trim(display_name), ' ', 1)) + 2),
                ''
            )
        WHERE display_name IS NOT NULL
          AND trim(display_name) <> ''
          AND first_name IS NULL
    """))


def downgrade():
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS last_name"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS first_name"))
