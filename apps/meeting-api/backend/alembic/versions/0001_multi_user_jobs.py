"""Initial multi-user ownership and job schema.

Revision ID: 0001_initial_multi_user_job_schema
Revises:
Create Date: 2026-04-02
"""

from alembic import op

revision = "0001_initial_multi_user_job_schema"
down_revision = None
branch_labels = None
depends_on = None

UPGRADE_STATEMENTS = [
    """
    CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS meetings (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        status TEXT NOT NULL,
        engine TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        duration_seconds INTEGER NOT NULL DEFAULT 0,
        segment_count INTEGER NOT NULL DEFAULT 0
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS transcript_segments (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        speaker_label TEXT NOT NULL,
        text TEXT NOT NULL,
        timestamp_start DOUBLE PRECISION NOT NULL DEFAULT 0,
        timestamp_end DOUBLE PRECISION NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        language_code TEXT NOT NULL DEFAULT 'unknown',
        translated_text TEXT
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS summaries (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
        summary_text TEXT NOT NULL,
        action_items TEXT[] NOT NULL DEFAULT '{}',
        key_topics TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
        meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL
    )
    """,
    """
    CREATE TABLE IF NOT EXISTS jobs (
        id TEXT PRIMARY KEY,
        owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
        job_type TEXT NOT NULL,
        status TEXT NOT NULL,
        stage TEXT NOT NULL,
        elapsed_ms INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        retry_count INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
    )
    """,
    "ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner_user_id TEXT",
    "ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS owner_user_id TEXT",
    "ALTER TABLE summaries ADD COLUMN IF NOT EXISTS owner_user_id TEXT",
    "ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS owner_user_id TEXT",
    "ALTER TABLE users ADD COLUMN IF NOT EXISTS name TEXT",
    "INSERT INTO users (id, email, password_hash, name, created_at, updated_at) VALUES ('00000000-0000-0000-0000-000000000001', 'local@meeting-agent.oss', '$2b$12$qgD9Cj0hfBkpHL8mWuL1VejKQCh9LK3Rr8kD6QvQ6tqEQG6Q3k6j2', 'Local OSS User', NOW(), NOW()) ON CONFLICT (email) DO NOTHING",
    "UPDATE meetings SET owner_user_id = COALESCE(owner_user_id, '00000000-0000-0000-0000-000000000001')",
    "UPDATE transcript_segments ts SET owner_user_id = m.owner_user_id FROM meetings m WHERE ts.meeting_id = m.id AND ts.owner_user_id IS NULL",
    "UPDATE summaries s SET owner_user_id = m.owner_user_id FROM meetings m WHERE s.meeting_id = m.id AND s.owner_user_id IS NULL",
    "UPDATE chat_messages c SET owner_user_id = m.owner_user_id FROM meetings m WHERE c.meeting_id = m.id AND c.owner_user_id IS NULL",
    "CREATE INDEX IF NOT EXISTS idx_users_email ON users (LOWER(email))",
    "CREATE INDEX IF NOT EXISTS idx_meetings_owner_created_at ON meetings (owner_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_transcript_segments_owner_meeting_timestamp ON transcript_segments (owner_user_id, meeting_id, timestamp_start)",
    "CREATE INDEX IF NOT EXISTS idx_summaries_owner_meeting_id ON summaries (owner_user_id, meeting_id)",
    "CREATE INDEX IF NOT EXISTS idx_chat_messages_owner_meeting_created_at ON chat_messages (owner_user_id, meeting_id, created_at)",
    "CREATE INDEX IF NOT EXISTS idx_jobs_owner_created_at ON jobs (owner_user_id, created_at DESC)",
    "CREATE INDEX IF NOT EXISTS idx_transcript_segments_text_search ON transcript_segments USING GIN (to_tsvector('simple', coalesce(text, '') || ' ' || coalesce(translated_text, '')))",
]

DOWNGRADE_STATEMENTS = [
    "DROP TABLE IF EXISTS jobs",
    "DROP TABLE IF EXISTS chat_messages",
    "DROP TABLE IF EXISTS summaries",
    "DROP TABLE IF EXISTS transcript_segments",
    "DROP TABLE IF EXISTS meetings",
    "DROP TABLE IF EXISTS users",
]


def upgrade() -> None:
    for statement in UPGRADE_STATEMENTS:
        op.execute(statement)



def downgrade() -> None:
    for statement in DOWNGRADE_STATEMENTS:
        op.execute(statement)
