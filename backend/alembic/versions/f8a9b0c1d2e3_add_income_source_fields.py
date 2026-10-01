"""campos de detalle por fuente de ingreso

Revision ID: f8a9b0c1d2e3
Revises: e7f8a9b0c1d2
Create Date: 2026-10-01

Un ingreso era neto + `bruto`/`deducciones` fijos. Alcanza para ver que el
sueldo varía pero no por qué: un aguinaldo, un premio o una retención de
Ganancias atrasada mueven el neto y parece que cambió el sueldo cuando no
cambió. Ahora cada fuente define sus propios campos (nombre + si suma, resta o
es informativo) y cada ingreso guarda un monto por campo.

**Un campo nunca se borra, se archiva**, y `income_entry_items.field_id` es
RESTRICT: quitarle un campo a una fuente no puede tocar lo ya cargado.

Backfill: cada fuente que alguna vez usó bruto/deducciones recibe los campos
"Bruto" (add) y "Deducciones" (subtract) y los valores pasan a ser ítems. Las
columnas `income_entries.bruto`/`deducciones` **se quedan**, ahora como valores
derivados (Σ add / Σ subtract) que escribe el router, para que la analítica y
el conector MCP sigan leyéndolas sin cambios.

Todo con `IF NOT EXISTS` / `WHERE NOT EXISTS`: si un deploy falla en medio,
Alembic reintenta la migración entera en el siguiente.
"""
from alembic import op
import sqlalchemy as sa

revision = "f8a9b0c1d2e3"
down_revision = "e7f8a9b0c1d2"
branch_labels = None
depends_on = None


def _backfill(column: str, name: str, kind: str, position: int) -> None:
    op.execute(sa.text(f"""
        INSERT INTO income_source_fields (source_id, name, kind, position, is_active)
        SELECT DISTINCT e.source_id, '{name}', '{kind}', {position}, true
        FROM income_entries e
        WHERE e.{column} IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM income_source_fields f
              WHERE f.source_id = e.source_id AND f.name = '{name}'
          )
    """))
    op.execute(sa.text(f"""
        INSERT INTO income_entry_items (entry_id, field_id, amount)
        SELECT e.id, f.id, e.{column}
        FROM income_entries e
        JOIN income_source_fields f
          ON f.source_id = e.source_id AND f.name = '{name}'
        WHERE e.{column} IS NOT NULL
        ON CONFLICT (entry_id, field_id) DO NOTHING
    """))


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS income_source_fields (
            id SERIAL PRIMARY KEY,
            source_id INTEGER NOT NULL REFERENCES income_sources(id) ON DELETE CASCADE,
            name VARCHAR(80) NOT NULL,
            kind VARCHAR(10) NOT NULL
                CONSTRAINT ck_income_source_fields_kind
                CHECK (kind IN ('add', 'subtract', 'info')),
            position INTEGER NOT NULL DEFAULT 0,
            is_active BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_income_source_fields_source_id "
        "ON income_source_fields (source_id)"
    ))
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS income_entry_items (
            id SERIAL PRIMARY KEY,
            entry_id INTEGER NOT NULL REFERENCES income_entries(id) ON DELETE CASCADE,
            field_id INTEGER NOT NULL REFERENCES income_source_fields(id) ON DELETE RESTRICT,
            amount NUMERIC(18, 2) NOT NULL,
            CONSTRAINT uq_income_entry_item_field UNIQUE (entry_id, field_id)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_income_entry_items_entry_id "
        "ON income_entry_items (entry_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_income_entry_items_field_id "
        "ON income_entry_items (field_id)"
    ))

    _backfill("bruto", "Bruto", "add", 0)
    _backfill("deducciones", "Deducciones", "subtract", 1)


def downgrade():
    # Las columnas bruto/deducciones nunca se vaciaron, así que bajar no pierde
    # lo que existía antes; sí se pierde el detalle cargado después.
    op.execute(sa.text("DROP TABLE IF EXISTS income_entry_items"))
    op.execute(sa.text("DROP TABLE IF EXISTS income_source_fields"))
