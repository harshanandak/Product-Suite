# PR3 Schema And Domain Inventory Research

Date: 2026-04-24
Issue: `product-suite-waq`

## Goal
Verify the current schema and ownership split across roadmap and meeting surfaces so PR3 can write one canonical ownership inventory before PR4 contracts work starts.

## Verified Sources

### Root and durable planning sources
- `package.json`
- `docs/plans/building-blocks-transformation-pr-plan.md`

### Roadmap sources
- `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql`
- `apps/roadmap-web/src/lib/supabase/types.ts`
- `apps/roadmap-web/src/middleware.ts`
- `apps/roadmap-web/SUPABASE_SETUP.md`

### Meeting sources
- `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py`
- `apps/meeting-api/backend/migrations/0001_initial.sql`
- `apps/meeting-api/backend/security.py`
- `apps/meeting-web/src/lib/api.js`

## Findings

### 1. Roadmap is the current team/workspace/planning system of record
The initial roadmap SQL migration defines:
- `users`
- `teams`
- `team_members`
- `subscriptions`
- `workspaces`
- `mind_maps`
- `mind_map_nodes`
- `mind_map_edges`
- `features`
- `timeline_items`
- `linked_items`
- `review_links`
- `feedback`
- `custom_dashboards`
- `success_metrics`
- `ai_usage`
- `invitations`

This is the strongest verified source for:
- `team`
- `workspace`
- planning/task data
- workspace-scoped analytics and feedback

### 2. Roadmap generated types show schema expansion beyond the initial migration
`apps/roadmap-web/src/lib/supabase/types.ts` includes additional verified tables such as:
- `chat_threads`
- `chat_messages`
- `blocksuite_documents`
- `ai_action_history`
- `compression_jobs`

This matters because the old manual setup document under-represents the actual roadmap schema currently used by the app.

### 3. Meeting API is the current meeting/transcript/job system of record
The Alembic migration defines:
- `users`
- `meetings`
- `transcript_segments`
- `summaries`
- `chat_messages`
- `jobs`

These tables are keyed around:
- `owner_user_id`
- `meeting_id`

This is the strongest verified source for:
- `meeting`
- transcript artifacts
- summary artifacts
- meeting-scoped chat
- meeting processing jobs

### 4. Meeting API migration history currently has drift
`apps/meeting-api/backend/migrations/0001_initial.sql` is older and only contains:
- `meetings`
- `transcript_segments`
- `summaries`
- `chat_messages`

It does not define:
- `users`
- `jobs`
- `owner_user_id`

So PR3 must explicitly record that the current canonical migration path for meeting-api is not represented by one single historical file.

### 5. Auth boundaries differ by product surface
- Roadmap middleware is Supabase-session driven.
- Meeting web uses hosted Neon auth/session exchange and forwards bearer tokens to meeting-api.
- Meeting API security code normalizes tenant and organization claims, but its underlying schema is still meeting-centric rather than workspace/team-centric.

This means PR3 should avoid pretending auth convergence already happened. It should only document which domains depend on which identity boundary today.

## Shared Entity Draft Map

### `team`
- Current owner: roadmap
- Future owner: roadmap
- Notes: tied to membership, billing, invitations, and workspace access

### `workspace`
- Current owner: roadmap
- Future owner: roadmap
- Notes: canonical container for planning, canvas, charting, feedback, and chat threads

### `thread`
- Current owner: roadmap
- Future owner: roadmap
- Notes: roadmap has explicit `chat_threads` and thread-scoped `chat_messages`; meeting-api chat remains meeting-scoped, not workspace-thread-scoped

### `meeting`
- Current owner: meeting-api
- Future owner: meeting-api
- Notes: meeting-web is a shell, not the canonical owner

### `artifact`
- Current state: split by artifact type
- Future shape: explicitly split
- Notes:
  - meeting transcript/summary artifacts belong to meeting-api
  - workspace planning/canvas artifacts such as `blocksuite_documents` belong to roadmap
  - PR3 should document the split rather than create one fake artifact owner

### `task`
- Current owner: roadmap
- Future owner: roadmap
- Notes: roadmap `features`, `timeline_items`, and related planning entities are the canonical task/work item layer

## Contradictions PR3 Must Capture
- `users` exists in both roadmap and meeting-api
- `chat_messages` exists in both roadmap and meeting-api with different semantics
- roadmap setup docs lag behind generated schema types
- meeting-api raw SQL migration path lags Alembic migration truth

## Implementation Implication For PR3
PR3 should be a documentation-and-guard slice:
- durable ownership inventory doc
- overlap notes
- migration-path notes
- minimal discoverability test so the inventory cannot disappear silently
