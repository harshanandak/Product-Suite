"""Summary-first meeting memory schema.

Revision ID: 0002_summary_first_meeting_memory
Revises: 0001_initial_multi_user_job_schema
Create Date: 2026-04-03
"""

from alembic import op

revision = "0002_summary_first_meeting_memory"
down_revision = "0001_initial_multi_user_job_schema"
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    "CREATE EXTENSION IF NOT EXISTS vector",
    """
    CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    ALTER TABLE users
    ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL
    """,
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS workos_session_id TEXT",
    """
    ALTER TABLE meetings
    ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE
    """,
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private'",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS project_name TEXT",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS participant_labels TEXT[] NOT NULL DEFAULT '{}'",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS primary_language TEXT NOT NULL DEFAULT 'unknown'",
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS buddy_mode TEXT NOT NULL DEFAULT 'addressable'",
    """
    ALTER TABLE transcript_segments
    ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE
    """,
    """
    ALTER TABLE summaries
    ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE
    """,
    """
    ALTER TABLE chat_messages
    ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE
    """,
    """
    ALTER TABLE jobs
    ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id) ON DELETE CASCADE
    """,
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS result JSONB NOT NULL DEFAULT '{}'::jsonb",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS finished_at TIMESTAMPTZ",
    "ALTER TABLE jobs ADD COLUMN IF NOT EXISTS idempotency_key TEXT",
    """
    INSERT INTO tenants (id, slug, name, created_at, updated_at)
    VALUES ('00000000-0000-0000-0000-000000000001', 'personal', 'Personal Workspace', NOW(), NOW())
    ON CONFLICT (id) DO NOTHING
    """,
    "UPDATE users SET tenant_id = COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001')",
    "UPDATE meetings SET tenant_id = COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001')",
    "UPDATE transcript_segments SET tenant_id = COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001')",
    "UPDATE summaries SET tenant_id = COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001')",
    "UPDATE chat_messages SET tenant_id = COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001')",
    "UPDATE jobs SET tenant_id = COALESCE(tenant_id, '00000000-0000-0000-0000-000000000001')",
    """
    CREATE TABLE IF NOT EXISTS meeting_state (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        window_start DOUBLE PRECISION NOT NULL DEFAULT 0,
        window_end DOUBLE PRECISION NOT NULL DEFAULT 0,
        current_topic TEXT,
        current_goal TEXT,
        summary_bullets JSONB NOT NULL DEFAULT '[]'::jsonb,
        decisions_forming JSONB NOT NULL DEFAULT '[]'::jsonb,
        blockers JSONB NOT NULL DEFAULT '[]'::jsonb,
        open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        active_action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chapter_summaries (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        chapter_index INTEGER NOT NULL,
        window_start DOUBLE PRECISION NOT NULL DEFAULT 0,
        window_end DOUBLE PRECISION NOT NULL DEFAULT 0,
        title TEXT,
        summary_text TEXT NOT NULL,
        decisions JSONB NOT NULL DEFAULT '[]'::jsonb,
        action_items JSONB NOT NULL DEFAULT '[]'::jsonb,
        open_questions JSONB NOT NULL DEFAULT '[]'::jsonb,
        reference_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        embedding vector(1536),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS decisions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        chapter_summary_id TEXT REFERENCES chapter_summaries(id) ON DELETE SET NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        record_origin TEXT NOT NULL DEFAULT 'generated',
        review_status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS action_items (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        chapter_summary_id TEXT REFERENCES chapter_summaries(id) ON DELETE SET NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        owner_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
        due_at TIMESTAMPTZ,
        evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        record_origin TEXT NOT NULL DEFAULT 'generated',
        review_status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS open_questions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        chapter_summary_id TEXT REFERENCES chapter_summaries(id) ON DELETE SET NULL,
        text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        evidence_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        record_origin TEXT NOT NULL DEFAULT 'generated',
        review_status TEXT NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS audio_assets (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        storage_path TEXT NOT NULL,
        kind TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        duration_ms INTEGER NOT NULL DEFAULT 0,
        retention_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS agent_invocations (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_label TEXT,
        trigger_text TEXT NOT NULL,
        detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        status TEXT NOT NULL DEFAULT 'captured'
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS agent_responses (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        invocation_id TEXT REFERENCES agent_invocations(id) ON DELETE SET NULL,
        response_text TEXT NOT NULL,
        response_audio_asset_id TEXT REFERENCES audio_assets(id) ON DELETE SET NULL,
        source_kind TEXT NOT NULL DEFAULT 'meeting',
        tool_refs JSONB NOT NULL DEFAULT '[]'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS meeting_links (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        linked_meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        reason TEXT NOT NULL,
        score DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
    """,
    "CREATE INDEX IF NOT EXISTS idx_meetings_tenant_created_at ON meetings (tenant_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_timestamp ON transcript_segments (meeting_id, timestamp_start)",
    "CREATE INDEX IF NOT EXISTS idx_chapter_summaries_meeting_chapter_index ON chapter_summaries (meeting_id, chapter_index)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_meeting_status_scheduled_at ON jobs (meeting_id, status, scheduled_at)",
    "CREATE INDEX IF NOT EXISTS idx_decisions_meeting_created_at ON decisions (meeting_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_action_items_meeting_status_created_at ON action_items (meeting_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_open_questions_meeting_status_created_at ON open_questions (meeting_id, status, created_at)",
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_idempotency_key ON jobs (idempotency_key) WHERE idempotency_key IS NOT NULL",
]

DOWNGRADE_STATEMENTS = [
    "DROP INDEX IF EXISTS idx_jobs_idempotency_key",
    "DROP INDEX IF EXISTS idx_open_questions_meeting_status_created_at",
    "DROP INDEX IF EXISTS idx_action_items_meeting_status_created_at",
    "DROP INDEX IF EXISTS idx_decisions_meeting_created_at",
    "DROP INDEX IF EXISTS idx_jobs_meeting_status_scheduled_at",
    "DROP INDEX IF EXISTS idx_chapter_summaries_meeting_chapter_index",
    "DROP INDEX IF EXISTS idx_transcript_segments_meeting_timestamp",
    "DROP INDEX IF EXISTS idx_meetings_tenant_created_at",
    "DROP TABLE IF EXISTS meeting_links",
    "DROP TABLE IF EXISTS agent_responses",
    "DROP TABLE IF EXISTS agent_invocations",
    "DROP TABLE IF EXISTS audio_assets",
    "DROP TABLE IF EXISTS open_questions",
    "DROP TABLE IF EXISTS action_items",
    "DROP TABLE IF EXISTS decisions",
    "DROP TABLE IF EXISTS chapter_summaries",
    "DROP TABLE IF EXISTS meeting_state",
    "ALTER TABLE jobs DROP COLUMN IF EXISTS idempotency_key",
    "ALTER TABLE jobs DROP COLUMN IF EXISTS finished_at",
    "ALTER TABLE jobs DROP COLUMN IF EXISTS started_at",
    "ALTER TABLE jobs DROP COLUMN IF EXISTS scheduled_at",
    "ALTER TABLE jobs DROP COLUMN IF EXISTS result",
    "ALTER TABLE jobs DROP COLUMN IF EXISTS payload",
    "ALTER TABLE jobs DROP COLUMN IF EXISTS tenant_id",
    "ALTER TABLE chat_messages DROP COLUMN IF EXISTS tenant_id",
    "ALTER TABLE summaries DROP COLUMN IF EXISTS tenant_id",
    "ALTER TABLE transcript_segments DROP COLUMN IF EXISTS tenant_id",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS buddy_mode",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS primary_language",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS ended_at",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS started_at",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS participant_labels",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS tags",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS project_name",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS visibility",
    "ALTER TABLE meetings DROP COLUMN IF EXISTS tenant_id",
    "ALTER TABLE users DROP COLUMN IF EXISTS workos_session_id",
    "ALTER TABLE users DROP COLUMN IF EXISTS tenant_id",
    "DROP TABLE IF EXISTS tenants",
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)


def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement)
