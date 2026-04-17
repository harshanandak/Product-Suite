"""Meeting intelligence hardening metadata.

Revision ID: 0003_meeting_intelligence_hardening
Revises: 0002_summary_first_meeting_memory
Create Date: 2026-04-07
"""

from alembic import op

revision = "0003_meeting_intelligence_hardening"
down_revision = "0002_summary_first_meeting_memory"
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    "ALTER TABLE chapter_summaries ADD COLUMN IF NOT EXISTS window_label TEXT",
    "ALTER TABLE chapter_summaries ADD COLUMN IF NOT EXISTS boundary_source TEXT",
    "ALTER TABLE decisions ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE decisions ADD COLUMN IF NOT EXISTS promotion_reason TEXT",
    "ALTER TABLE decisions ADD COLUMN IF NOT EXISTS source_window_start DOUBLE PRECISION",
    "ALTER TABLE decisions ADD COLUMN IF NOT EXISTS source_window_end DOUBLE PRECISION",
    "ALTER TABLE action_items ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE action_items ADD COLUMN IF NOT EXISTS promotion_reason TEXT",
    "ALTER TABLE action_items ADD COLUMN IF NOT EXISTS source_window_start DOUBLE PRECISION",
    "ALTER TABLE action_items ADD COLUMN IF NOT EXISTS source_window_end DOUBLE PRECISION",
    "ALTER TABLE open_questions ADD COLUMN IF NOT EXISTS confidence DOUBLE PRECISION NOT NULL DEFAULT 0",
    "ALTER TABLE open_questions ADD COLUMN IF NOT EXISTS promotion_reason TEXT",
    "ALTER TABLE open_questions ADD COLUMN IF NOT EXISTS source_window_start DOUBLE PRECISION",
    "ALTER TABLE open_questions ADD COLUMN IF NOT EXISTS source_window_end DOUBLE PRECISION",
]

DOWNGRADE_STATEMENTS = [
    "ALTER TABLE chapter_summaries DROP COLUMN IF EXISTS boundary_source",
    "ALTER TABLE chapter_summaries DROP COLUMN IF EXISTS window_label",
    "ALTER TABLE open_questions DROP COLUMN IF EXISTS source_window_end",
    "ALTER TABLE open_questions DROP COLUMN IF EXISTS source_window_start",
    "ALTER TABLE open_questions DROP COLUMN IF EXISTS promotion_reason",
    "ALTER TABLE open_questions DROP COLUMN IF EXISTS confidence",
    "ALTER TABLE action_items DROP COLUMN IF EXISTS source_window_end",
    "ALTER TABLE action_items DROP COLUMN IF EXISTS source_window_start",
    "ALTER TABLE action_items DROP COLUMN IF EXISTS promotion_reason",
    "ALTER TABLE action_items DROP COLUMN IF EXISTS confidence",
    "ALTER TABLE decisions DROP COLUMN IF EXISTS source_window_end",
    "ALTER TABLE decisions DROP COLUMN IF EXISTS source_window_start",
    "ALTER TABLE decisions DROP COLUMN IF EXISTS promotion_reason",
    "ALTER TABLE decisions DROP COLUMN IF EXISTS confidence",
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement)
