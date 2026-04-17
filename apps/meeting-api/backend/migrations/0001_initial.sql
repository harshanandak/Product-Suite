CREATE TABLE IF NOT EXISTS meetings (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    status TEXT NOT NULL,
    engine TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL,
    duration_seconds INTEGER NOT NULL DEFAULT 0,
    segment_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS transcript_segments (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    speaker_label TEXT NOT NULL,
    text TEXT NOT NULL,
    timestamp_start DOUBLE PRECISION NOT NULL DEFAULT 0,
    timestamp_end DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL,
    language_code TEXT NOT NULL DEFAULT 'unknown',
    translated_text TEXT
);

CREATE TABLE IF NOT EXISTS summaries (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL UNIQUE REFERENCES meetings(id) ON DELETE CASCADE,
    summary_text TEXT NOT NULL,
    action_items TEXT[] NOT NULL DEFAULT '{}',
    key_topics TEXT[] NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_meetings_created_at
    ON meetings (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_meeting_timestamp
    ON transcript_segments (meeting_id, timestamp_start);
CREATE INDEX IF NOT EXISTS idx_summaries_meeting_id
    ON summaries (meeting_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting_created_at
    ON chat_messages (meeting_id, created_at);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_text_lower
    ON transcript_segments (LOWER(text));
