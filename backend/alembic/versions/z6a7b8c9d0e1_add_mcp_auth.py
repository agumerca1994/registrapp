"""add MCP connector auth tables (oauth clients, txns, codes, tokens)

Revision ID: z6a7b8c9d0e1
Revises: y5z6a7b8c9d0
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "z6a7b8c9d0e1"
down_revision = "y5z6a7b8c9d0"
branch_labels = None
depends_on = None


def upgrade():
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
            client_id VARCHAR(64) PRIMARY KEY,
            client_secret VARCHAR(128),
            client_secret_expires_at BIGINT,
            client_id_issued_at BIGINT,
            client_name VARCHAR(200),
            client_uri VARCHAR(500),
            logo_uri VARCHAR(500),
            redirect_uris JSONB NOT NULL DEFAULT '[]'::jsonb,
            grant_types JSONB NOT NULL DEFAULT '[]'::jsonb,
            response_types JSONB NOT NULL DEFAULT '[]'::jsonb,
            scope VARCHAR(200),
            token_endpoint_auth_method VARCHAR(40),
            software_id VARCHAR(100),
            software_version VARCHAR(50),
            created_at TIMESTAMP DEFAULT now()
        )
    """))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS mcp_oauth_authorizations (
            txn_id VARCHAR(64) PRIMARY KEY,
            client_id VARCHAR(64) NOT NULL,
            redirect_uri VARCHAR(700) NOT NULL,
            redirect_uri_provided_explicitly BOOLEAN NOT NULL DEFAULT false,
            state VARCHAR(500),
            scopes VARCHAR(300) NOT NULL,
            code_challenge VARCHAR(200) NOT NULL,
            resource VARCHAR(300),
            created_at TIMESTAMP DEFAULT now(),
            expires_at TIMESTAMP NOT NULL,
            consumed_at TIMESTAMP
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mcp_oauth_authorizations_client_id "
        "ON mcp_oauth_authorizations (client_id)"
    ))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS mcp_auth_codes (
            code_hash VARCHAR(64) PRIMARY KEY,
            client_id VARCHAR(64) NOT NULL,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            scopes VARCHAR(300) NOT NULL,
            code_challenge VARCHAR(200) NOT NULL,
            redirect_uri VARCHAR(700) NOT NULL,
            redirect_uri_provided_explicitly BOOLEAN NOT NULL DEFAULT false,
            resource VARCHAR(300),
            created_at TIMESTAMP DEFAULT now(),
            expires_at TIMESTAMP NOT NULL,
            used_at TIMESTAMP
        )
    """))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mcp_auth_codes_client_id "
        "ON mcp_auth_codes (client_id)"
    ))

    # One table for personal tokens and OAuth tokens alike: the verifier does a
    # single lookup by hash, and revoking anything is always "set revoked_at".
    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS mcp_tokens (
            id SERIAL PRIMARY KEY,
            tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind VARCHAR(20) NOT NULL,
            token_hash VARCHAR(64) NOT NULL,
            token_prefix VARCHAR(24) NOT NULL,
            grant_id VARCHAR(64) NOT NULL,
            parent_id INTEGER REFERENCES mcp_tokens(id) ON DELETE SET NULL,
            client_id VARCHAR(64),
            client_name VARCHAR(200),
            name VARCHAR(100),
            scopes VARCHAR(300) NOT NULL,
            resource VARCHAR(300),
            created_at TIMESTAMP NOT NULL DEFAULT now(),
            expires_at TIMESTAMP,
            last_used_at TIMESTAMP,
            revoked_at TIMESTAMP,
            revoked_reason VARCHAR(40)
        )
    """))
    op.execute(sa.text(
        "CREATE UNIQUE INDEX IF NOT EXISTS ix_mcp_tokens_token_hash "
        "ON mcp_tokens (token_hash)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mcp_tokens_tenant_id ON mcp_tokens (tenant_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mcp_tokens_user_id ON mcp_tokens (user_id)"
    ))
    op.execute(sa.text(
        "CREATE INDEX IF NOT EXISTS ix_mcp_tokens_grant_id ON mcp_tokens (grant_id)"
    ))


def downgrade():
    op.execute(sa.text("DROP TABLE IF EXISTS mcp_tokens"))
    op.execute(sa.text("DROP TABLE IF EXISTS mcp_auth_codes"))
    op.execute(sa.text("DROP TABLE IF EXISTS mcp_oauth_authorizations"))
    op.execute(sa.text("DROP TABLE IF EXISTS mcp_oauth_clients"))
