"""memoria corta del bot de WhatsApp (wa_messages)

Revision ID: i1j2k3l4m5n6
Revises: h0i1j2k3l4m5
Create Date: 2026-10-05

Una fila por mensaje del chat del bot, con la referencia a lo que produjo
(gasto o sesión de conciliación) y la pregunta pendiente si la hay. Es lo que
hace funcionar *deshacer*, *editar*, responder citando y contestar "1"/"2".
La unicidad (user_id, wa_message_id) es la idempotencia del webhook: Evolution
reintenta, y un reintento no puede crear el gasto dos veces. Se purga a los
7 días por el job diario.

`IF NOT EXISTS` para que un deploy caído a mitad pueda reintentar.
"""
from alembic import op
import sqlalchemy as sa

revision = "i1j2k3l4m5n6"
down_revision = "h0i1j2k3l4m5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS wa_messages (
            id SERIAL PRIMARY KEY,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            direction VARCHAR(3) NOT NULL,
            wa_message_id VARCHAR(64),
            kind VARCHAR(10) NOT NULL,
            text VARCHAR(500),
            ref_type VARCHAR(20),
            ref_id INTEGER,
            pending JSONB,
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            CONSTRAINT uq_wa_message UNIQUE (user_id, wa_message_id)
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_wa_messages_user_id ON wa_messages (user_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_wa_messages_created_at ON wa_messages (created_at)"
    ))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS wa_messages"))
