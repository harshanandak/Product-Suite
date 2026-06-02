-- PR19 unified Product Suite platform schema.
-- Creates shared platform identity tables and reserves private module schemas.
-- Supabase owns the built-in realtime schema; PR19 does not alter it.
-- Meeting data remains on Neon until PR20.

create extension if not exists pgcrypto with schema extensions;

create schema if not exists platform;
create schema if not exists meeting;
create schema if not exists roadmap;
create schema if not exists agent;

comment on schema platform is 'Private Product Suite platform identity, workspace, membership, auth identity, and audit schema.';
comment on schema meeting is 'Private Meeting module schema reserved from the live Neon baseline; PR20 owns table cutover.';
comment on schema roadmap is 'Roadmap compatibility schema reservation; current Roadmap public-schema tables stay public during PR19.';
comment on schema agent is 'Private Agent module schema reservation for agent runtime and invocation ownership.';

revoke all on schema platform from public, anon, authenticated;
revoke all on schema meeting from public, anon, authenticated;
revoke all on schema roadmap from public, anon, authenticated;
revoke all on schema agent from public, anon, authenticated;

grant usage on schema platform to postgres, service_role;
grant usage on schema meeting to postgres, service_role;
grant usage on schema roadmap to postgres, service_role;
grant usage on schema agent to postgres, service_role;

create table if not exists platform.users (
  id uuid primary key default gen_random_uuid(),
  clerk_user_id text not null unique,
  primary_email text,
  display_name text,
  image_url text,
  status text not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_users_status_check check (status in ('active', 'disabled', 'deleted'))
);

create table if not exists platform.workspaces (
  id uuid primary key default gen_random_uuid(),
  clerk_organization_id text unique,
  slug text not null unique,
  name text not null,
  status text not null default 'active',
  created_by_user_id uuid references platform.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint platform_workspaces_status_check check (status in ('active', 'disabled', 'deleted'))
);

create table if not exists platform.memberships (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references platform.workspaces(id) on delete cascade,
  user_id uuid not null references platform.users(id) on delete cascade,
  clerk_membership_id text unique,
  role text not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, user_id),
  constraint platform_memberships_role_check check (role in ('owner', 'admin', 'member', 'viewer')),
  constraint platform_memberships_status_check check (status in ('active', 'invited', 'disabled', 'deleted'))
);

create table if not exists platform.auth_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references platform.users(id) on delete cascade,
  provider text not null,
  provider_subject text not null,
  provider_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_subject)
);

create table if not exists platform.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references platform.workspaces(id) on delete set null,
  actor_user_id uuid references platform.users(id) on delete set null,
  event_type text not null,
  resource_type text not null,
  resource_id text,
  metadata jsonb not null default '{}'::jsonb,
  request_id text,
  created_at timestamptz not null default now()
);

comment on table platform.users is 'Internal Product Suite users projected from Clerk users.';
comment on table platform.workspaces is 'Internal Product Suite workspaces projected from Clerk organizations or app-created workspaces.';
comment on table platform.memberships is 'Workspace membership and role assignments projected from Clerk and enforced by backend authorization.';
comment on table platform.auth_identities is 'Provider identity mapping; Clerk subject is mapped here instead of assuming auth.uid() equals an internal UUID.';
comment on table platform.audit_events is 'Append-only platform audit trail for sensitive workspace and identity operations.';

create index if not exists platform_users_primary_email_idx on platform.users (lower(primary_email));
create index if not exists platform_workspaces_clerk_org_idx on platform.workspaces (clerk_organization_id);
create index if not exists platform_memberships_user_idx on platform.memberships (user_id);
create index if not exists platform_memberships_workspace_role_idx on platform.memberships (workspace_id, role);
create index if not exists platform_auth_identities_user_idx on platform.auth_identities (user_id);
create index if not exists platform_audit_events_workspace_created_idx on platform.audit_events (workspace_id, created_at desc);
create index if not exists platform_audit_events_actor_created_idx on platform.audit_events (actor_user_id, created_at desc);

alter table platform.users enable row level security;
alter table platform.workspaces enable row level security;
alter table platform.memberships enable row level security;
alter table platform.auth_identities enable row level security;
alter table platform.audit_events enable row level security;

revoke all on all tables in schema platform from anon, authenticated;
grant select, insert, update, delete on all tables in schema platform to service_role;
revoke update, delete on table platform.audit_events from service_role;
grant usage, select on all sequences in schema platform to service_role;
