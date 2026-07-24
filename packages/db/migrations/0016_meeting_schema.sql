-- Meeting → board loop (end-to-end-meeting-0c1a2ac1), Task A.1 — the `meeting`
-- schema in the shared Neon platform database.
--
-- Ported from infra/supabase/migrations/20260606093937_create_meeting_schema.sql.
-- Table/index/comment DDL is kept verbatim (lower-case, source ordering) so this
-- file stays diffable against that original; only the Supabase-only constructs
-- are dropped, because they do not exist on Neon:
--   * `alter table ... enable row level security` (19 statements) — Meeting API
--     reaches this schema through the privileged DATABASE_URL, never PostgREST.
--   * the `anon` / `authenticated` / `service_role` revoke+grant block — those
--     roles are Supabase's.
--   * the `extensions.` schema qualifier on `vector` — this repo installs the
--     extension into the default schema (see 0013_knowledge_base.sql).
--   * the `public.alembic_version` table and its seeding — `public` here is the
--     Drizzle-owned platform schema and Alembic is read-only history.
--
-- Ids stay TEXT exactly as Meeting API writes them. This slice repoints the
-- database; it does not reshape a single id.
--
-- Hand-authored (drizzle-kit generate unavailable in the worktree; see 0012/0014/0015).
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint

create schema if not exists meeting;--> statement-breakpoint

comment on schema meeting is 'Private Meeting module schema. Meeting API owns writes; this Drizzle migration chain owns the hosted schema.';--> statement-breakpoint

create table if not exists meeting.tenants (
  id text primary key,
  slug text not null unique,
  name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.users (
  id text primary key,
  email text not null unique,
  password_hash text not null,
  name text,
  tenant_id text references meeting.tenants(id) on delete set null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);--> statement-breakpoint

create table if not exists meeting.meetings (
  id text primary key,
  owner_user_id text references meeting.users(id) on delete cascade,
  tenant_id text references meeting.tenants(id) on delete cascade,
  title text not null,
  status text not null,
  engine text not null,
  visibility text not null default 'private',
  project_name text,
  tags text[] not null default '{}',
  participant_labels text[] not null default '{}',
  started_at timestamptz,
  ended_at timestamptz,
  primary_language text not null default 'unknown',
  buddy_mode text not null default 'addressable',
  created_at timestamptz not null,
  updated_at timestamptz not null,
  duration_seconds integer not null default 0,
  segment_count integer not null default 0
);--> statement-breakpoint

create table if not exists meeting.transcript_segments (
  id text primary key,
  owner_user_id text references meeting.users(id) on delete cascade,
  tenant_id text references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  speaker_label text not null,
  text text not null,
  timestamp_start double precision not null default 0,
  timestamp_end double precision not null default 0,
  created_at timestamptz not null,
  language_code text not null default 'unknown',
  translated_text text
);--> statement-breakpoint

create table if not exists meeting.summaries (
  id text primary key,
  owner_user_id text references meeting.users(id) on delete cascade,
  tenant_id text references meeting.tenants(id) on delete cascade,
  meeting_id text not null unique references meeting.meetings(id) on delete cascade,
  summary_text text not null,
  action_items text[] not null default '{}',
  key_topics text[] not null default '{}',
  created_at timestamptz not null
);--> statement-breakpoint

create table if not exists meeting.chat_messages (
  id text primary key,
  owner_user_id text references meeting.users(id) on delete cascade,
  tenant_id text references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  role text not null,
  content text not null,
  created_at timestamptz not null
);--> statement-breakpoint

create table if not exists meeting.jobs (
  id text primary key,
  owner_user_id text not null references meeting.users(id) on delete cascade,
  tenant_id text references meeting.tenants(id) on delete cascade,
  meeting_id text references meeting.meetings(id) on delete cascade,
  job_type text not null,
  status text not null,
  stage text not null,
  elapsed_ms integer not null default 0,
  error text,
  retry_count integer not null default 0,
  payload jsonb not null default '{}'::jsonb,
  result jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  idempotency_key text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);--> statement-breakpoint

create table if not exists meeting.meeting_state (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  window_start double precision not null default 0,
  window_end double precision not null default 0,
  current_topic text,
  current_goal text,
  summary_bullets jsonb not null default '[]'::jsonb,
  decisions_forming jsonb not null default '[]'::jsonb,
  blockers jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  active_action_items jsonb not null default '[]'::jsonb,
  confidence double precision not null default 0,
  created_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.chapter_summaries (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  chapter_index integer not null,
  window_start double precision not null default 0,
  window_end double precision not null default 0,
  window_label text,
  boundary_source text,
  title text,
  summary_text text not null,
  decisions jsonb not null default '[]'::jsonb,
  action_items jsonb not null default '[]'::jsonb,
  open_questions jsonb not null default '[]'::jsonb,
  reference_refs jsonb not null default '[]'::jsonb,
  embedding vector(1536),
  created_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.decisions (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  chapter_summary_id text references meeting.chapter_summaries(id) on delete set null,
  text text not null,
  status text not null default 'open',
  owner_user_id text references meeting.users(id) on delete set null,
  evidence_refs jsonb not null default '[]'::jsonb,
  record_origin text not null default 'generated',
  review_status text not null default 'draft',
  confidence double precision not null default 0,
  promotion_reason text,
  source_window_start double precision,
  source_window_end double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.action_items (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  chapter_summary_id text references meeting.chapter_summaries(id) on delete set null,
  text text not null,
  status text not null default 'open',
  owner_user_id text references meeting.users(id) on delete set null,
  due_at timestamptz,
  evidence_refs jsonb not null default '[]'::jsonb,
  record_origin text not null default 'generated',
  review_status text not null default 'draft',
  confidence double precision not null default 0,
  promotion_reason text,
  source_window_start double precision,
  source_window_end double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.open_questions (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  chapter_summary_id text references meeting.chapter_summaries(id) on delete set null,
  text text not null,
  status text not null default 'open',
  evidence_refs jsonb not null default '[]'::jsonb,
  record_origin text not null default 'generated',
  review_status text not null default 'draft',
  confidence double precision not null default 0,
  promotion_reason text,
  source_window_start double precision,
  source_window_end double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.audio_assets (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  storage_path text not null,
  kind text not null,
  mime_type text not null,
  duration_ms integer not null default 0,
  retention_expires_at timestamptz,
  created_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.agent_invocations (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  speaker_label text,
  trigger_text text not null,
  detected_at timestamptz not null default now(),
  status text not null default 'captured'
);--> statement-breakpoint

create table if not exists meeting.agent_responses (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  invocation_id text references meeting.agent_invocations(id) on delete set null,
  response_text text not null,
  response_audio_asset_id text references meeting.audio_assets(id) on delete set null,
  source_kind text not null default 'meeting',
  tool_refs jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.meeting_links (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  meeting_id text not null references meeting.meetings(id) on delete cascade,
  linked_meeting_id text not null references meeting.meetings(id) on delete cascade,
  reason text not null,
  score double precision not null default 0,
  created_at timestamptz not null default now()
);--> statement-breakpoint

create table if not exists meeting.user_auth_identities (
  id text primary key,
  user_id text not null references meeting.users(id) on delete cascade,
  provider text not null,
  provider_user_id text not null,
  provider_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_user_id)
);--> statement-breakpoint

create table if not exists meeting.organization_memberships (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  user_id text not null references meeting.users(id) on delete cascade,
  role text not null default 'member',
  status text not null default 'active',
  invited_by_user_id text references meeting.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id)
);--> statement-breakpoint

create table if not exists meeting.organization_invitations (
  id text primary key,
  tenant_id text not null references meeting.tenants(id) on delete cascade,
  email text not null,
  role text not null default 'member',
  token_hash text not null unique,
  status text not null default 'pending',
  invited_by_user_id text references meeting.users(id) on delete set null,
  accepted_by_user_id text references meeting.users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);--> statement-breakpoint

comment on table meeting.tenants is 'Meeting tenant/workspace records from the Alembic baseline.';--> statement-breakpoint
comment on table meeting.users is 'Meeting API user records. Platform identity mapping is handled separately in platform schema.';--> statement-breakpoint
comment on table meeting.meetings is 'Meeting records owned and written by Meeting API.';--> statement-breakpoint
comment on table meeting.transcript_segments is 'Transcript segment records owned and written by Meeting API.';--> statement-breakpoint
comment on table meeting.jobs is 'Meeting async job records and idempotency keys.';--> statement-breakpoint

create index if not exists meeting_users_email_idx on meeting.users (lower(email));--> statement-breakpoint
create index if not exists meeting_meetings_owner_created_at_idx on meeting.meetings (owner_user_id, created_at desc);--> statement-breakpoint
create index if not exists meeting_meetings_tenant_created_at_idx on meeting.meetings (tenant_id, created_at desc);--> statement-breakpoint
create index if not exists meeting_transcript_segments_owner_meeting_timestamp_idx on meeting.transcript_segments (owner_user_id, meeting_id, timestamp_start);--> statement-breakpoint
create index if not exists meeting_transcript_segments_meeting_timestamp_idx on meeting.transcript_segments (meeting_id, timestamp_start);--> statement-breakpoint
create index if not exists meeting_summaries_owner_meeting_id_idx on meeting.summaries (owner_user_id, meeting_id);--> statement-breakpoint
create index if not exists meeting_chat_messages_owner_meeting_created_at_idx on meeting.chat_messages (owner_user_id, meeting_id, created_at);--> statement-breakpoint
create index if not exists meeting_jobs_owner_created_at_idx on meeting.jobs (owner_user_id, created_at desc);--> statement-breakpoint
create index if not exists meeting_jobs_meeting_status_scheduled_at_idx on meeting.jobs (meeting_id, status, scheduled_at);--> statement-breakpoint
create unique index if not exists meeting_jobs_idempotency_key_idx on meeting.jobs (idempotency_key) where idempotency_key is not null;--> statement-breakpoint
create index if not exists meeting_transcript_segments_text_search_idx on meeting.transcript_segments using gin (to_tsvector('simple', coalesce(text, '') || ' ' || coalesce(translated_text, '')));--> statement-breakpoint
create index if not exists meeting_chapter_summaries_meeting_chapter_index_idx on meeting.chapter_summaries (meeting_id, chapter_index);--> statement-breakpoint
create index if not exists meeting_decisions_meeting_created_at_idx on meeting.decisions (meeting_id, created_at);--> statement-breakpoint
create index if not exists meeting_action_items_meeting_status_created_at_idx on meeting.action_items (meeting_id, status, created_at);--> statement-breakpoint
create index if not exists meeting_open_questions_meeting_status_created_at_idx on meeting.open_questions (meeting_id, status, created_at);--> statement-breakpoint
create index if not exists meeting_user_auth_identities_user_id_idx on meeting.user_auth_identities (user_id);--> statement-breakpoint
create index if not exists meeting_org_memberships_tenant_user_idx on meeting.organization_memberships (tenant_id, user_id);--> statement-breakpoint
create index if not exists meeting_org_invites_tenant_email_status_idx on meeting.organization_invitations (tenant_id, email, status);--> statement-breakpoint
create unique index if not exists meeting_org_invites_tenant_email_pending_idx on meeting.organization_invitations (tenant_id, email) where status = 'pending';
