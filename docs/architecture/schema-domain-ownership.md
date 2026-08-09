# Schema and domain ownership

## Current authority (2026-08-09)

Product Suite has one supported database topology: Neon PostgreSQL, database
`neondb`, schema `public`. `packages/db/src/schema.ts` is the shared schema
model and `packages/db/migrations` is the only supported Drizzle migration
root. Its journal, `packages/db/migrations/meta/_journal.json`, is the only
pending-migration authority; the historical manifest is validation/provenance,
not a second journal.

## Ownership Matrix

| Domain | Runtime owner | Current database | Current schema/model |
| --- | --- | --- | --- |
| Workboard, teams, projects, statuses, work items | Platform API | Neon `neondb` | `packages/db/src/schema.ts` |
| Meetings, transcripts, summaries, jobs, meeting links | Platform/Meeting services | Neon `neondb` | `packages/db/src/meeting-schema.ts` re-exported by `schema.ts` |
| Agent runs, proposals, memories, knowledge | Platform API / agent module | Neon `neondb` | `packages/db/src/schema.ts` |
| Realtime transport | Hocuspocus service | Neon `neondb` when persisted by Product Suite | service-owned tables in `public` |

All supported runtimes use pooled Neon `DATABASE_URL`; direct
`MIGRATION_DATABASE_URL` is reserved for the guarded migration/role authority.
Runtime roles are per-service LOGIN identities granted only the corresponding
pre-provisioned NOLOGIN role. `0019_neon_authority_reconciliation` is the
applied floor. New work starts at PR A candidate
`0020_meeting_authority_foundation.sql` and must apply/verify on both recognized
history variants:

- production: `original-production`;
- fresh, staging, and test: `repaired-bootstrap`.

The five-block bootstrap repair in Drizzle `0000`/`0004` is immutable after its
audited change. No current task may edit or regenerate that repair.

## Historical evidence (not current authority)

These roots remain byte-preserved evidence and are never consulted for pending
Neon migrations:

- [`infra/supabase/migrations`](../../infra/supabase/migrations) — historical
  Supabase-era schema;
- [`apps/roadmap-web/supabase/migrations`](../../apps/roadmap-web/supabase/migrations)
  — unsupported legacy Roadmap source;
- [`apps/meeting-api/backend/alembic/versions`](../../apps/meeting-api/backend/alembic/versions)
  — retained Meeting provenance;
- [`apps/meeting-api/backend/migrations`](../../apps/meeting-api/backend/migrations)
  — retained raw-SQL provenance.

The historical manifest at
[`docs/history/database-migrations/manifest.json`](../history/database-migrations/manifest.json)
is `historical_non_authoritative` and validation-only. It records original and
repaired hashes, line-ending forms, and the exactly five permitted FK guards;
it is not a pending journal.

## Overlap Notes

### users and identity

Identity and authorization remain application concerns; database rows use
internal Product Suite user IDs. Historical provider tables do not become a
second current authority.

### Conversation and artifacts

Meeting conversation stays scoped to meeting records and their evidence.
Workboard and canvas artifacts stay in the shared Neon model, while transcript
and summary artifacts stay in the meeting domain.

## Non-Goals

- Re-activating the historical Supabase, Roadmap, or Meeting Alembic roots as
  supported runtime databases.
- Adding a second migration journal or copying the Neon public schema into a
  compatibility database.
- Rewriting or regenerating the audited five-block bootstrap repair.

## Contract boundary

Shared API contracts may be extracted only above these domain owners. A similar
table or noun in a historical root does not create a second live owner. Auth
providers (Clerk, Neon Auth, and local development auth) remain separate from
database-host authority. The unsupported Roadmap application is preserved for
historical/product recovery; migrating it to Platform API is separate work.

## Handoff

Use the guarded runner and explicit variant for every operation:

```text
bun run migrate:database -- apply --history-variant <variant> --expected-pending <ordered-tags>
bun run migrate:database -- verify --history-variant <variant> --expected-floor <tag>
```

`verify` with no pending work emits a zero-write `NOOP`. A real-Neon proof that
requires disposable project credentials is `INCOMPLETE` when those credentials
are absent; a skipped lane is not evidence of conformance.
