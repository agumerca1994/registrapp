"""bind the whatsapp verification code to the phone it was sent to

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-08-13
"""
from alembic import op
import sqlalchemy as sa

revision = "d0e1f2a3b4c5"
down_revision = "c9d0e1f2a3b4"
branch_labels = None
depends_on = None


def upgrade():
    # `verify_whatsapp` aceptaba el teléfono que mandaba el cliente, sin ninguna
    # relación con el número al que se había enviado el código: pedir el código
    # al propio número y verificarlo con el de otra persona te dejaba su
    # `whatsapp_phone`, que decide qué invitaciones de gastos compartidos ves y
    # a qué hogar entran los mensajes del webhook. `whatsapp_pending_phone`
    # guarda el destino real en el momento del envío.
    #
    # `whatsapp_verify_attempts` cierra la otra mitad: 6 dígitos con 10 minutos
    # de validez y sin contador de intentos se agotan por fuerza bruta.
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_pending_phone VARCHAR(20)"
    ))
    op.execute(sa.text(
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp_verify_attempts "
        "INTEGER NOT NULL DEFAULT 0"
    ))

    # Cualquier código en vuelo al momento del deploy no tiene destino guardado,
    # así que `verify_whatsapp` lo rechazaría con un mensaje confuso. Invalidarlos
    # es más limpio: el usuario pide uno nuevo y son 10 minutos de ventana.
    op.execute(sa.text(
        "UPDATE users SET whatsapp_verify_code = NULL, whatsapp_verify_expires = NULL "
        "WHERE whatsapp_verify_code IS NOT NULL"
    ))


def downgrade():
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS whatsapp_verify_attempts"))
    op.execute(sa.text("ALTER TABLE users DROP COLUMN IF EXISTS whatsapp_pending_phone"))
