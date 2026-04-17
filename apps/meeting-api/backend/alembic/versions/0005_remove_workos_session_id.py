"""Remove legacy WorkOS session column.

Revision ID: 0005_remove_workos_session_id
Revises: 0004_auth_provider_redesign
Create Date: 2026-04-09
"""

from alembic import op

revision = "0005_remove_workos_session_id"
down_revision = "0004_auth_provider_redesign"
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    "ALTER TABLE users DROP COLUMN IF EXISTS workos_session_id",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS workos_session_id TEXT",
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement)
