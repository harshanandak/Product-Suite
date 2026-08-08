# Canonical Neon database authority

**Feature:** `neon-db-authority`
**Issue:** `59efc6dc-07a1-4b31-9942-ba2f1fcac8e1`
**Date:** 2026-08-09
**Classification:** Critical — database authority, production schema, secrets, and migration workflow
**Status:** PLAN complete; human approval required before DEV
**Base:** `origin/main@42e30d88bc516dc6472c9f1bb837bd694844aa47`
**Branch/worktree:** `feat/neon-db-authority` / `.worktrees/neon-db-authority`

## Purpose

Make the repository describe and enforce the already-completed production reality: Neon is the sole live Postgres authority for supported Product-Suite services. Establish one total migration order, make a fresh clone reproducible without Alembic or Supabase CLI, reject dual/Supabase production database configuration, and preserve historical migrations without running or rewriting them.

This is the bottom PR in the meeting-authority stack. It must land and be deployed before issue `2660c6a4-3e8d-4f4e-b3bb-eb61446c3c98` (PR A) chooses a migration filename.

## User-canonical decisions

1. The Supabase-to-Neon database migration is complete.
2. Neon is the only live Postgres authority.
3. No data is remigrated, copied, dropped, or destructively rolled back.
4. Supabase/Alembic references must be classified from evidence: immutable history, removable stale adapter, or a real runtime path. A filename alone is not proof of current authority.
5. DEV is blocked on explicit human approval of this plan.

## Verified baseline

The read-only evidence is detailed in [`docs/research/canonicalize-neon-authority-and-retire-stale-supabase-database-configuration.md`](../../research/canonicalize-neon-authority-and-retire-stale-supabase-database-configuration.md).

- Neon project `cool-glitter-50094249`, default `production` branch, PostgreSQL 17, database `neondb`, current schema `public`.
- Only `public`, `drizzle`, and `neon_auth` application schemas exist. Meeting and Platform tables share `public`; `meeting` does not exist.
- Production is populated. The reconciliation must be additive and row-preserving.
- `drizzle.__drizzle_migrations` has 18 entries through `0017`; main carries `0018`, so production is one tracked migration behind.
- `public.alembic_version=0005_remove_workos_session_id` exists as legacy provenance.
- Mixed historical Drizzle hashes are explained by CRLF/LF execution, not semantic migration edits.
- A Cloudflare Platform API deployment and `DATABASE_URL` secret binding exist. The documented custom API name does not resolve.
- Documented Railway/Vercel services return provider 404s; those CLIs need reauthentication. No accessible live Supabase-backed service was found.
- GitHub still has stale Supabase credential names and a Supabase live-validation workflow; its last run was 2026-06-06.

## Success criteria

1. A machine-readable authority contract names Neon, database `neondb`, schema `public`, `packages/db/migrations`, Drizzle journal, runtime/migration URL purposes, active services, and historical roots.
2. Supported hosted configuration accepts exactly one Neon database authority. Meeting defaults to Neon, rejects a Supabase database provider/URL, and has no provider-dependent `meeting` search path or legacy Supabase smoke variable.
3. `packages/db` is the only supported schema/migration owner. New migrations have one root, one journal, one generation command, one apply command, and one deployment order.
4. Additive migration `0019_neon_authority_reconciliation.sql` makes the complete Drizzle chain sufficient to build the current supported public schema on an empty Postgres 17 database while producing no table/data copy or drop on populated Neon.
5. Meeting readiness checks the canonical Drizzle/schema contract rather than the Alembic head. Existing HTTP request/response fields and semantics remain unchanged.
6. Historical Supabase and Meeting Alembic/raw SQL migration files remain byte-for-byte preserved and hash-manifested. Their active runners, linked-project workflow, and current-authority documentation retire.
7. CI proves empty-database bootstrap, migration ordering/integrity, API compatibility, hosted URL rejection, and real-Neon convergence. Missing Neon credentials is INCOMPLETE/FAIL for the required conformance job, not PASS.
8. Deployment uses a direct `MIGRATION_DATABASE_URL`; application runtimes use pooled, least-privilege `DATABASE_URL` values. Validation proves provider, purpose, project, branch, exact SHA, and post-migration readiness without logging secrets.
9. Production rollout preserves row counts, `public.alembic_version`, existing historical Drizzle rows, and API response keys. Only pending Drizzle migrations are appended.
10. PR A receives a stable stack interface: canonical root/model/runner and next slot `0020`, conditional on production recording `0019` and a final rebase/order check.

## Out of scope

- Any Supabase-to-Neon data transfer, dump/restore, replication, or validation that treats Supabase as a populated source.
- Dropping or renaming schemas/tables/columns, deleting rows, editing migration history, or running down migrations.
- Rewriting historical PR19/PR20 plans or migration SQL to pretend they never existed.
- Migrating the unsupported legacy Roadmap application to the Platform API, or removing its full source tree.
- Auth-provider migration. Neon Auth, Clerk, local auth, and API token semantics remain separate from database-host authority.
- Meeting authority columns, origin backfill, authorization primitive, or response projection work owned by PR A.
- Production deployment, secret rotation, or database changes during PLAN.

## Approach selected

### One Drizzle plane plus an additive adoption migration

Keep the existing Platform migration plane and extend it to describe the already-live Meeting/identity tables:

| Contract | Canonical value after this PR |
| --- | --- |
| Provider/project/database | Neon / configured `NEON_PROJECT_ID` / `neondb` |
| Application schema | `public` |
| Schema model | `packages/db/src/schema.ts`, with Meeting/identity definitions split into and re-exported from `packages/db/src/meeting-schema.ts` |
| Migration root | `packages/db/migrations` |
| Journal | `packages/db/migrations/meta/_journal.json` |
| Generate | `bun run --cwd packages/db generate` |
| Repository checks | `bun run check:migration-parity` and new `bun run check:database-authority` |
| Apply | `MIGRATION_DATABASE_URL=<direct Neon URL> bun run --cwd packages/db migrate` |
| Runtime | `DATABASE_URL=<pooled Neon URL>` |
| P0 migration | `0019_neon_authority_reconciliation.sql` |
| PR A next slot | `0020_meeting_authority_foundation.sql` after rebase and live verification |

Do not use `drizzle-kit push` for tracked/shared schema. Do not create new Alembic revisions or Supabase migrations.

### Why `0019` is required

The existing Drizzle chain does not create the Meeting baseline, public users/tenants, or Meeting identity/membership tables. Merely declaring Drizzle canonical would make fresh clones depend on Alembic while claiming the opposite. `0019` closes that gap without changing the populated source of truth.

Drizzle metadata snapshots stop at `0011` even though hand-authored SQL/journal entries continue through `0018`. DEV must first add the complete current schema model, then run normal `drizzle-kit generate` against that known stale checkpoint. The resulting broad `0019` diff is the reconciliation input: review and rewrite **only the new `0019` SQL** into guarded additive DDL while retaining the generated `meta/0019_snapshot.json` as the first complete post-reconciliation checkpoint. Never synthesize fake intermediate `0012`–`0018` snapshots and never edit their applied SQL. A no-change generation probe after `0019` must report no diff; PR A then generates from the real `0019` snapshot.

The migration defines the current live shapes for:

- `users`, `tenants`, `user_auth_identities`, `organization_memberships`, `organization_invitations`;
- `meetings`, `transcript_segments`, `summaries`, `chat_messages`, `jobs`;
- `meeting_state`, `chapter_summaries`, `decisions`, `action_items`, `open_questions`;
- `audio_assets`, `agent_invocations`, `agent_responses`, `meeting_links`.

It uses schema-qualified, additive DDL. Tables/columns/indexes/constraints absent on an empty database are created. Existing production objects are verified and left in place. Where PostgreSQL lacks `ADD CONSTRAINT IF NOT EXISTS`, guarded catalog checks are used. It revokes `CREATE` on `public` from `PUBLIC` without changing the owner/runtime grants. It never creates `alembic_version` on a fresh database and never alters the existing production marker.

The migration must not use `DROP`, `TRUNCATE`, `DELETE`, `UPDATE`, `INSERT ... SELECT`, cross-database facilities, `CREATE SCHEMA meeting`, Supabase roles/functions, or data-dependent backfills.

## Runtime and API compatibility

### Meeting API

- Hosted mode defaults `DATABASE_PROVIDER` to `neon`; explicit `supabase` or a Supabase hostname fails before pool initialization.
- OSS mode continues accepting local/general PostgreSQL with provider `postgres`; hosted-only Neon enforcement does not break self-hosting.
- Remove provider-dependent `options=-c search_path=meeting,public`. Canonical table references resolve to `public`; changed SQL should schema-qualify `public` where touched.
- Replace `EXPECTED_ALEMBIC_VERSION` readiness with a minimum canonical Drizzle reconciliation/schema check. A production database retaining `alembic_version` and a clean database without it both pass when `0019` is applied.
- Remove `MEETING_SUPABASE_SMOKE_DATABASE_URL` fallback and Supabase default provider. The supported smoke variable is `MEETING_TARGET_SMOKE_DATABASE_URL`, and hosted smoke rejects non-Neon.
- Remove executable Alembic/raw runner surfaces only after the empty bootstrap proves parity. Historical version/raw SQL files stay unedited.
- No route model, serializer, status code, response key, auth claim, tenant mapping, or data-access outcome changes.

### Platform API

- `createDb`/`createSql` continue using the Neon HTTP driver and public API signatures.
- Connection validation occurs at the environment boundary before a client is created. No caller-supplied URL is accepted.
- Add a DB-backed readiness check used by deployment that reports only `ok`, `provider=neon`, and canonical schema revision readiness; it does not expose host, role, project, branch, table names, counts, or errors.

### Legacy Roadmap application

The inaccessible Vercel deployment and Supabase data client are not silently relabeled. The service registry marks the app as unsupported/archived, its Supabase live-validation workflow is removed, and conformance tests exclude it from supported production services. Its source remains for historical/product recovery; migrating it to Platform API is separate work.

## Historical migration preservation

Create `docs/history/database-migrations/manifest.json` and a checker covering exactly:

- `infra/supabase/migrations/**`;
- `apps/roadmap-web/supabase/migrations/**`;
- `apps/meeting-api/backend/alembic/versions/**`;
- `apps/meeting-api/backend/migrations/**`.

The manifest records relative path, canonical LF SHA-256, and where needed the observed legacy CRLF SHA-256. It records these roots as `historical_non_authoritative`; it is not a second journal and is never consulted to decide pending Neon migrations.

Current migration files `0000`–`0018` are immutable. Add `.gitattributes` for LF on SQL/JSON migration control files. The integrity checker recognizes existing CRLF/LF history but requires new migrations to match canonical LF content and fails on semantic drift, duplicate/non-contiguous order, unknown applied hashes, or edits to applied migration timestamps/tags. `meta/0019_snapshot.json` is a deliberate checkpoint, not evidence that missing intermediate snapshots existed.

## Fresh clone, local, CI, and deploy behavior

### Fresh clone/local

1. `bun install --frozen-lockfile`.
2. Start an empty PostgreSQL 17 database.
3. Set a direct local `MIGRATION_DATABASE_URL`; run only `bun run --cwd packages/db migrate`.
4. Run authority/migration integrity and schema conformance.
5. Start Meeting/Platform runtimes with `DATABASE_URL`; no Supabase CLI, Alembic, or raw Meeting runner is invoked.

Local OSS Meeting development may use local Postgres. Hosted configuration always validates Neon.

### Pull-request CI

1. Static authority, historical-manifest, URL-purpose, migration parity, and API-shape tests.
2. Empty Postgres 17 bootstrap from `0000` through `0019` using the canonical runner.
3. Meeting tests against that database, including readiness without `alembic_version`.
4. Ephemeral Neon branch from the configured production parent; apply pending Drizzle migrations; verify rows/schema converge and the parent remains untouched; delete in `finally`.
5. The real-Neon job fails when credentials are missing, no tests execute, cleanup fails, output is truncated, or evidence cannot be reconstructed.

### Production rollout order

1. Rebase on current `origin/main`; recalculate next migration order. Abort if another migration took `0019`.
2. Capture privacy-safe preflight: exact main SHA, Neon project/production branch, applied Drizzle tags/hashes, `alembic_version`, required table/column/constraint inventory, and per-table row counts only.
3. Create a Neon restore branch (or record a valid point-in-time restore timestamp) before applying. Verify it is ready; do not delete it during the acceptance window.
4. Configure GitHub environment secret `MIGRATION_DATABASE_URL` with a direct production-branch Neon URL. Keep Cloudflare/Meeting `DATABASE_URL` pooled. Validators must agree on project/branch/database/provider but never print either URL.
5. Human-approve one exact-main-SHA deploy run. Concurrency prevents another migration run; stale-main check runs immediately before apply.
6. Apply pending `0018`, then `0019`, in journal order with `bun run --cwd packages/db migrate`. Do not manually mark either applied.
7. Verify exactly two new Drizzle history rows relative to the observed baseline, no historical row changed, `alembic_version` unchanged, row counts unchanged, and required schema present.
8. Deploy Platform API. Exercise DB-backed readiness and a read-only authenticated API smoke.
9. Reauthenticate Railway only if Meeting deployment is to be restored; set its pooled Neon URL before deployment. Dead Vercel/Railway records are not treated as rollout success.
10. After the acceptance window and proof that no workflow consumes them, human-remove Supabase repository secrets/variables and archive/delete stale external projects. Secret deletion is not performed by repository code.

## Rollback

- Before migration: abort with no change if provenance, backup/restore, direct URL, exact SHA, or schema checks fail.
- During migration: rely on the migration transaction and stop. Do not repair/insert/delete history manually.
- After migration but before deploy: keep additive schema; fix forward. Do not run a down migration.
- After application failure: roll the Worker/service back to its previous version. `0019` is backwards-compatible and stays applied.
- Data recovery: use the verified Neon restore branch/point only for incident recovery under a separate human decision. Never repoint production to Supabase.
- Keep restore evidence until the acceptance window closes and PR A has confirmed its base.

## Secrets and security

- `MIGRATION_DATABASE_URL`: direct Neon, CI environment only, owner/migration privileges, scoped only to migration/preflight steps.
- `DATABASE_URL`: pooled Neon, runtime only, least-privilege application role. Platform and Meeting may share the physical database but not owner credentials.
- `NEON_API_KEY`: only branch create/inspect/delete steps; never application runtime.
- Structural URL validation: `postgres`/`postgresql` scheme, exact `.neon.tech` hostname suffix, `neondb`, TLS required, pooled/direct purpose, and control-plane project/branch match. Substring checks are insufficient.
- Logs/evidence include only revision, canonical hash, project/branch IDs, purpose, status, counts, and opaque deployment IDs. Redact URLs, usernames, passwords, tokens, auth claims, content, prompts, embeddings, and row payloads.
- Revoke `CREATE` on `public` from `PUBLIC`; use specific runtime grants. Do not add RLS as a substitute for current server-side authorization in this issue.

## Edge cases

- `0019` sees an existing object with an incompatible type/constraint: fail closed and report the object; do not coerce or drop it.
- Production remains at `0017`: normal deployment applies `0018` before `0019`; no manual leapfrog.
- A parallel PR claims `0019`: rebase and renumber this reconciliation and PR A's slot together before DEV/merge.
- CRLF vs LF hashes: accept only the precomputed historical forms; future files are LF-only.
- `alembic_version` exists on production but not clean bootstrap: readiness ignores it; the preservation checker forbids deleting it from production.
- A Supabase URL is supplied with provider `neon`, or vice versa: structural hostname validation wins and rejects.
- Neon control plane is unavailable: migration/deploy is INCOMPLETE and stops; no hostname-only fallback.
- Railway/Vercel remain inaccessible: update docs to `unverified/dead`; do not delay database authority or claim deployment completion.

## Technical Research

The full research bundle is in the linked research document. Material conclusions:

- Neon and Drizzle both support the selected runner; Neon recommends direct connections for migrations and pooling for application runtimes. [Neon Drizzle migration guide](https://neon.com/docs/guides/drizzle-migrations), [Neon connection choice](https://neon.com/docs/connect/choose-connection)
- Neon copy-on-write branches support isolated schema testing and recoverable pre-deploy checkpoints. [Neon branching](https://neon.com/docs/introduction/branching)
- Keeping Supabase CLI automation would keep a distinct remote migration-history protocol active; preserve its migrations as history and retire the linked workflow. [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction)
- PostgreSQL `search_path` trusts creators in searched schemas. Remove the provider-dependent path and restrict public schema creation. [PostgreSQL schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)
- OWASP-relevant controls cover access control, secret redaction, URL/SQL injection, single-history integrity, configuration fail-closed behavior, and auditable exact-SHA rollout.
- Required TDD covers hosted Neon acceptance, Supabase/dual config rejection, populated no-op reconciliation, historical hash/line-ending integrity, empty bootstrap, and application-only rollback.

## Exact implementation ownership and estimate

No two same-wave tasks own the same file. Sequential cross-wave edits are explicit in `tasks.md`.

| Wave | Owned surface | Estimate |
| --- | --- | --- |
| 1 | Authority contract/validator; historical manifest/checker; tests | 7–9 files, 300–450 net LOC plus generated manifest |
| 2 | Canonical Meeting/identity schema model and `0019` migration/journal/snapshot; schema tests | 5–7 files, 450–700 net LOC |
| 3 | Meeting hosted config/readiness and retirement of active Alembic/raw runners; tests | 12–16 changed/deleted files, 250–400 net LOC |
| 4 | Empty bootstrap, ephemeral Neon conformance, deploy URL split/readiness; workflows/tests/docs | 10–14 files, 350–550 net LOC |
| 5 | Supabase workflow retirement, legacy Roadmap/service classification, canonical docs and stack handoff | 8–11 changed/deleted files, 200–350 net LOC |

Expected PR: 34–45 paths including deletions and generated manifest, approximately 1,550–2,450 net authored LOC. The schema migration/model is the largest portion. If DEV discovery exceeds this bound or requires Roadmap data-client migration, stop and return to PLAN.

## PR A stack interface

After this PR is merged **and production records `0019`**, PR A consumes:

```text
database_provider: neon
database_name: neondb
application_schema: public
canonical_schema_model: packages/db/src/schema.ts (re-exporting meeting-schema.ts)
canonical_migration_root: packages/db/migrations
canonical_journal: packages/db/migrations/meta/_journal.json
canonical_generate: bun run --cwd packages/db generate
canonical_apply: MIGRATION_DATABASE_URL=<direct Neon URL> bun run --cwd packages/db migrate
runtime_url_contract: pooled Neon DATABASE_URL
canonical_applied_floor: 0019_neon_authority_reconciliation
pr_a_candidate_revision: 0020_meeting_authority_foundation.sql
historical_non_authoritative: Supabase migrations, Meeting Alembic versions/raw SQL
```

PR A must still rebase, rerun migration-order and live-applied-floor checks, and renumber if another migration lands. It creates no Alembic/Supabase file and does not modify the reconciliation migration.

## Baseline validation and coordination evidence

- Migration parity: PASS.
- Focused repository migration/cutover tests: 53 PASS, 0 FAIL on untouched base.
- `verify:db`: INCOMPLETE because the shared worktree install lacks `@eslint/js`; no source failure was observed before dependency resolution stopped.
- Meeting Python tests: INCOMPLETE because the available default Python lacks pytest and the Python 3.13 launcher did not complete in the bounded probe.
- Conflict merge simulation against main: no conflicts.
- Kernel-only conflict index: issue not indexed, so it cannot prove non-overlap.
- Merge-order helper reports a pre-existing dependency cycle; this plan does not mutate dependencies.
- Worktree is based exactly on `origin/main@42e30d88bc516dc6472c9f1bb837bd694844aa47`.

DEV must install the locked Bun/Python dependencies and establish a green untouched baseline before RED. A dependency/setup failure is not permission to weaken a gate.

## Ambiguity policy

Use the `/dev` 7-dimension decision rubric. At or above 80% confidence, choose the most conservative additive behavior and record it. Below 80%, or whenever a decision could copy/drop/remap data, change API output, alter auth/tenant semantics, introduce a second migration owner, or expand into Roadmap migration, stop for human review.

## Recommended approval gate

Approve DEV only if the human accepts all five locked decisions:

1. `packages/db` Drizzle becomes the only supported migration plane.
2. P0 owns additive reconciliation migration `0019`; PR A consumes candidate `0020` after live verification.
3. Historical Supabase/Alembic/raw migration files stay immutable, but their active runners/workflow retire.
4. Supported hosted services reject Supabase/dual DB configuration; the legacy Roadmap app is explicitly unsupported rather than migrated here.
5. Production rollout requires a direct migration URL, pre-migration Neon restore evidence, exact-SHA human approval, post-migration row/history proof, and forward-only rollback.

No DEV, push, PR, external secret mutation, or production database operation is authorized by this document.
