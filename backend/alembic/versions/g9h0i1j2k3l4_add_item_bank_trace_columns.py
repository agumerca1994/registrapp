"""trazabilidad del ítem de tarjeta contra el resumen del banco

Revision ID: g9h0i1j2k3l4
Revises: f8a9b0c1d2e3
Create Date: 2026-10-05

La descripción de un ítem la reescribe el usuario ("Ferreteria - Mercadopago"
donde el banco imprimió "MERPAGO*LUCIANOGABRIELCAM"), así que conciliar contra
el PDF del banco sólo puede matchear por monto — la heurística ciega de los
importadores, que confunde dos cargos iguales. Estas tres columnas guardan lo
que el banco imprimió (`bank_description`), el número de cupón (`bank_coupon`,
el identificador real del cargo) y por dónde entró el ítem (`capture_source`:
app / reconcile / whatsapp / import / mcp). Nullable las tres: todo lo ya
cargado queda como está y las completa la primera conciliación que lo matchee.

`IF NOT EXISTS` para que un deploy que falle a mitad pueda reintentar la
migración entera.
"""
from alembic import op
import sqlalchemy as sa

revision = "g9h0i1j2k3l4"
down_revision = "f8a9b0c1d2e3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text(
        "ALTER TABLE credit_card_items ADD COLUMN IF NOT EXISTS bank_description VARCHAR(255)"
    ))
    op.execute(sa.text(
        "ALTER TABLE credit_card_items ADD COLUMN IF NOT EXISTS bank_coupon VARCHAR(20)"
    ))
    op.execute(sa.text(
        "ALTER TABLE credit_card_items ADD COLUMN IF NOT EXISTS capture_source VARCHAR(20)"
    ))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE credit_card_items DROP COLUMN IF EXISTS bank_description"))
    op.execute(sa.text("ALTER TABLE credit_card_items DROP COLUMN IF EXISTS bank_coupon"))
    op.execute(sa.text("ALTER TABLE credit_card_items DROP COLUMN IF EXISTS capture_source"))
