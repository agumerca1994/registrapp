"""Reparar los splits huérfanos que dejó la copia de credit_cards.py

Revision ID: f2a3b4c5d6e7
Revises: e1f2a3b4c5d6
Create Date: 2026-08-18

`POST /credit-cards/items/{id}/share` tenía su propia copia de la resolución de
participantes y le faltaba la rama del externo sin cuenta: creaba el split con
`user_id=NULL`, sin token y en `pending`. Nadie puede aceptar ni rechazar una
fila así — `_my_split` nunca la matchea — así que quedaba colgada para siempre,
contando como pendiente y sin forma de resolverse.

El código ya no las genera (ahora las dos vías pasan por
`services/participants.py`). Esto arregla las que quedaron: pasan a `accepted`,
que es lo que habrían sido de haberse creado por el camino correcto — un
externo sin cuenta no tiene a nadie que acepte.
"""
from alembic import op
import sqlalchemy as sa

revision = "f2a3b4c5d6e7"
down_revision = "e1f2a3b4c5d6"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        UPDATE shared_expense_splits
        SET status = 'accepted'
        WHERE user_id IS NULL
          AND invite_token IS NULL
          AND status = 'pending'
    """))


def downgrade():
    # Sin vuelta atrás: no hay forma de distinguir estas filas de las que ya
    # eran 'accepted' legítimamente, y volverlas a 'pending' recrearía el bug.
    pass
