"""normalize stored whatsapp_phone to +digits

Revision ID: c9d0e1f2a3b4
Revises: b8c9d0e1f2a3
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "c9d0e1f2a3b4"
down_revision = "b8c9d0e1f2a3"
branch_labels = None
depends_on = None


def upgrade():
    # `/auth/me/verify-whatsapp` stored the raw submitted phone before it began
    # normalizing, so some rows sit as "549..." while _normalize_phone() always
    # produces "+549...". Sharing an expense looks the recipient up by that
    # exact string, and a miss doesn't error — it downgrades the share into an
    # invite token that only exists inside the WhatsApp message, so the expense
    # never appears in the recipient's app. Converge every row on one spelling.
    op.execute(sa.text(r"""
        UPDATE users
        SET whatsapp_phone = '+' || regexp_replace(whatsapp_phone, '\D', '', 'g')
        WHERE whatsapp_phone IS NOT NULL
          AND whatsapp_phone <> '+' || regexp_replace(whatsapp_phone, '\D', '', 'g')
    """))


def downgrade():
    # Nothing to restore to — the pre-normalization spellings weren't recorded,
    # and both forms mean the same number.
    pass
