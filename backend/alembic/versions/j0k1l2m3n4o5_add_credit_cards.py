"""add credit cards

Revision ID: j0k1l2m3n4o5
Revises: i9j0k1l2m3n4
Create Date: 2026-06-20
"""
from alembic import op
import sqlalchemy as sa

revision = "j0k1l2m3n4o5"
down_revision = "i9j0k1l2m3n4"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Add payment_method and entity to expense_entries
    op.execute(sa.text(
        "ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30)"
    ))
    op.execute(sa.text(
        "ALTER TABLE expense_entries ADD COLUMN IF NOT EXISTS entity VARCHAR(100)"
    ))

    # Create credit_cards table
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS credit_cards (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            user_id INTEGER NOT NULL REFERENCES users(id),
            bank VARCHAR(100) NOT NULL,
            alias VARCHAR(100) NOT NULL,
            closing_day INTEGER NOT NULL,
            due_day INTEGER NOT NULL,
            last_4_digits VARCHAR(4),
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_credit_cards_tenant_id ON credit_cards(tenant_id)"
    ))

    # Create credit_card_statements table
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS credit_card_statements (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id),
            card_id INTEGER NOT NULL REFERENCES credit_cards(id) ON DELETE CASCADE,
            year INTEGER NOT NULL,
            month INTEGER NOT NULL,
            status VARCHAR(10) NOT NULL DEFAULT 'open',
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_credit_card_statements_tenant_id ON credit_card_statements(tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_credit_card_statements_card_id ON credit_card_statements(card_id)"
    ))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_statement_card_period ON credit_card_statements(card_id, year, month)"
    ))

    # Create credit_card_items table (without self-referential FK first)
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS credit_card_items (
            id SERIAL PRIMARY KEY,
            statement_id INTEGER NOT NULL REFERENCES credit_card_statements(id) ON DELETE CASCADE,
            description VARCHAR(255) NOT NULL,
            category_id INTEGER NOT NULL REFERENCES expense_categories(id),
            item_date DATE NOT NULL,
            item_type VARCHAR(20) NOT NULL,
            amount NUMERIC(18, 2) NOT NULL,
            installment_count INTEGER,
            installment_number INTEGER,
            purchase_total NUMERIC(18, 2),
            installment_group_id INTEGER,
            expense_entry_id INTEGER REFERENCES expense_entries(id) ON DELETE SET NULL,
            created_at TIMESTAMP NOT NULL DEFAULT now()
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_credit_card_items_statement_id ON credit_card_items(statement_id)"
    ))

    # Add self-referential FK for installment_group_id (deferred to avoid circular dependency)
    op.execute(sa.text("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint WHERE conname = 'fk_item_group'
            ) THEN
                ALTER TABLE credit_card_items
                    ADD CONSTRAINT fk_item_group
                    FOREIGN KEY (installment_group_id)
                    REFERENCES credit_card_items(id)
                    ON DELETE SET NULL;
            END IF;
        END
        $$
    """))


def downgrade() -> None:
    op.execute(sa.text("ALTER TABLE credit_card_items DROP CONSTRAINT IF EXISTS fk_item_group"))
    op.execute(sa.text("DROP TABLE IF EXISTS credit_card_items"))
    op.execute(sa.text("DROP TABLE IF EXISTS credit_card_statements"))
    op.execute(sa.text("DROP TABLE IF EXISTS credit_cards"))
    op.execute(sa.text("ALTER TABLE expense_entries DROP COLUMN IF EXISTS payment_method"))
    op.execute(sa.text("ALTER TABLE expense_entries DROP COLUMN IF EXISTS entity"))
