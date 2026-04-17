"""Auth provider redesign schema.

Revision ID: 0004_auth_provider_redesign
Revises: 0003_meeting_intelligence_hardening
Create Date: 2026-04-08
"""

from alembic import op

revision = "0004_auth_provider_redesign"
down_revision = "0003_meeting_intelligence_hardening"
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS user_auth_identities (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider TEXT NOT NULL,
        provider_user_id TEXT NOT NULL,
        provider_email TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (provider, provider_user_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS organization_memberships (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role TEXT NOT NULL DEFAULT 'member',
        status TEXT NOT NULL DEFAULT 'active',
        invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (tenant_id, user_id)
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS organization_invitations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        email TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token_hash TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'pending',
        invited_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        accepted_by_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        accepted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_user_auth_identities_user_id ON user_auth_identities (user_id)",
    "CREATE INDEX IF NOT EXISTS idx_org_memberships_tenant_user ON organization_memberships (tenant_id, user_id)",
    "CREATE INDEX IF NOT EXISTS idx_org_invites_tenant_email_status ON organization_invitations (tenant_id, email, status)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_org_invites_tenant_email_pending ON organization_invitations (tenant_id, email) WHERE status = 'pending'",
]

DOWNGRADE_STATEMENTS = [
    "DROP INDEX IF EXISTS idx_org_invites_tenant_email_pending",
    "DROP INDEX IF EXISTS idx_org_invites_tenant_email_status",
    "DROP INDEX IF EXISTS idx_org_memberships_tenant_user",
    "DROP INDEX IF EXISTS idx_user_auth_identities_user_id",
    "DROP TABLE IF EXISTS organization_invitations",
    "DROP TABLE IF EXISTS organization_memberships",
    "DROP TABLE IF EXISTS user_auth_identities",
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement)
