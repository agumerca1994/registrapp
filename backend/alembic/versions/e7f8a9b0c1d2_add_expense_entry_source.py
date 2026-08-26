"""procedencia del gasto

Revision ID: e7f8a9b0c1d2
Revises: d6e7f8a9b0c1
Create Date: 2026-08-26

Hasta ahora un gasto importado y uno tipeado a mano eran indistinguibles en la
base: lo único que los separaba era `payment_method == "tarjeta_credito"`, que
es un hecho de medio de pago haciendo de hecho de procedencia. Con los caminos
de alta que vienen (/registrar, hoja de compartir, Atajo de iOS, media por
WhatsApp) eso deja de alcanzar, y sin la columna no hay forma de responder
"¿por qué hay dos gastos de $12.500 hoy?" ni de medir si un canal se usa.

**Nullable, sin default y sin backfill, a propósito.** NULL significa
"preexistente, no sabemos", que es lo único cierto. Poner "manual" en todo
afirmaría algo falso justo sobre las filas espejadas de tarjeta, que son las que
más se prestan a confusión.

`IF NOT EXISTS` en las dos sentencias: si un deploy falla en medio, Alembic no
marca la migración como aplicada y la reintenta en el siguiente.
"""
from alembic import op
import sqlalchemy as sa

revision = "e7f8a9b0c1d2"
down_revision = "d6e7f8a9b0c1"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text(
        "ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS source VARCHAR(30)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_expense_entries_source "
        "ON expense_entries (source)"
    ))


def downgrade():
    op.execute(sa.text("DROP INDEX IF EXISTS ix_expense_entries_source"))
    op.execute(sa.text("ALTER TABLE expense_entries DROP COLUMN IF EXISTS source"))
