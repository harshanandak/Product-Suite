CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);

INSERT INTO users (id, email, password_hash, created_at, updated_at)
VALUES (
    '00000000-0000-0000-0000-000000000001',
    'local@meeting-agent.local',
    NULL,
    NOW(),
    NOW()
)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE meetings ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
UPDATE meetings
SET owner_user_id = '00000000-0000-0000-0000-000000000001'
WHERE owner_user_id IS NULL;
ALTER TABLE meetings ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE meetings
    DROP CONSTRAINT IF EXISTS meetings_owner_user_id_fkey,
    ADD CONSTRAINT meetings_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_meetings_owner_created_at
    ON meetings (owner_user_id, created_at DESC);

ALTER TABLE transcript_segments ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
UPDATE transcript_segments AS ts
SET owner_user_id = m.owner_user_id
FROM meetings AS m
WHERE ts.meeting_id = m.id AND ts.owner_user_id IS NULL;
ALTER TABLE transcript_segments ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE transcript_segments
    DROP CONSTRAINT IF EXISTS transcript_segments_owner_user_id_fkey,
    ADD CONSTRAINT transcript_segments_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_transcript_segments_owner_meeting_timestamp
    ON transcript_segments (owner_user_id, meeting_id, timestamp_start);

ALTER TABLE summaries ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
UPDATE summaries AS s
SET owner_user_id = m.owner_user_id
FROM meetings AS m
WHERE s.meeting_id = m.id AND s.owner_user_id IS NULL;
ALTER TABLE summaries ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE summaries
    DROP CONSTRAINT IF EXISTS summaries_owner_user_id_fkey,
    ADD CONSTRAINT summaries_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_summaries_owner_meeting_id
    ON summaries (owner_user_id, meeting_id);

ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS owner_user_id TEXT;
UPDATE chat_messages AS c
SET owner_user_id = m.owner_user_id
FROM meetings AS m
WHERE c.meeting_id = m.id AND c.owner_user_id IS NULL;
ALTER TABLE chat_messages ALTER COLUMN owner_user_id SET NOT NULL;
ALTER TABLE chat_messages
    DROP CONSTRAINT IF EXISTS chat_messages_owner_user_id_fkey,
    ADD CONSTRAINT chat_messages_owner_user_id_fkey
    FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_chat_messages_owner_meeting_created_at
    ON chat_messages (owner_user_id, meeting_id, created_at);

CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    meeting_id TEXT REFERENCES meetings(id) ON DELETE CASCADE,
    kind TEXT NOT NULL,
    status TEXT NOT NULL,
    stage TEXT NOT NULL,
    elapsed_ms INTEGER NOT NULL DEFAULT 0,
    error TEXT,
    retry_count INTEGER NOT NULL DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_jobs_owner_created_at
    ON jobs (owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_jobs_meeting_created_at
    ON jobs (meeting_id, created_at DESC);

