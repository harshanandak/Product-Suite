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
3. `packages/db` is the only supported schema/migration owner. New migrations have one root, one journal, one generation command, and one guarded runner whose caller-declared history variant is pinned by environment authority: production=`original-production`; fresh/staging=`repaired-bootstrap`.
4. A narrowly audited repair to the five premature foreign-key blocks in `0000`/`0004`, followed by additive `0019_neon_authority_reconciliation.sql`, makes the Drizzle chain bootstrappable on empty PostgreSQL 17 with pgvector. Existing production history rows and hashes are never edited; the runner recognizes the original-history and repaired-bootstrap variants explicitly and rejects mixed or unknown histories.
5. Meeting readiness checks the canonical Drizzle/schema contract rather than the Alembic head. Existing HTTP request/response fields and semantics remain unchanged.
6. Historical Supabase and Meeting Alembic/raw SQL remain byte-for-byte preserved and hash-manifested. Drizzle `0001`–`0003` and `0005`–`0018` remain byte-for-byte preserved; `0000`/`0004` have one reviewed bootstrap-only exception recorded before/after by hash and semantic assertion. Active Alembic/raw/Supabase runners, both Supabase workflows, and current-authority documentation retire.
7. CI proves empty-database bootstrap, migration ordering/integrity, API compatibility, hosted URL rejection, and real-Neon convergence. Missing Neon credentials is INCOMPLETE/FAIL for the required conformance job, not PASS.
8. Deployment uses a direct owner-scoped `MIGRATION_DATABASE_URL`; application runtimes rotate from the currently observed `neondb_owner` credential to pooled, per-service least-privilege roles. Positive data access and negative DDL/role-escalation probes are required before traffic.
9. Under one advisory-locked apply session, P0 production accepts exactly `{0018,0019}` or `{0019}` with expected tags, timestamps, hashes, and count. The same suffix runner accepts later exact contiguous migrations on either complete recognized variant when the environment-pinned variant and caller-declared pending list agree; `verify` handles zero-pending recognized histories as a successful no-op.
10. PR A receives a stable interface for candidate `0020` that applies and verifies on both `original-production` and `repaired-bootstrap`, conditional on production recording `0019` and a final rebase/order check.

## Out of scope

- Any Supabase-to-Neon data transfer, dump/restore, replication, or validation that treats Supabase as a populated source.
- Dropping or renaming schemas/tables/columns, deleting rows, editing database migration-history rows, or running down migrations.
- Rewriting historical PR19/PR20 plans or migration SQL to pretend they never existed.
- Migrating the unsupported legacy Roadmap application to the Platform API, or removing its full source tree.
- Auth-provider migration. Neon Auth, Clerk, local auth, and API token semantics remain separate from database-host authority.
- Meeting authority columns, origin backfill, authorization primitive, or response projection work owned by PR A.
- Production deployment, secret rotation, or database changes during PLAN.

## Approach selected

### One Drizzle plane, a tightly audited bootstrap repair, and additive adoption

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
| Bootstrap | `bun run migrate:database -- bootstrap --history-variant repaired-bootstrap --expected-pending <0000..0019>` |
| Apply suffix | `bun run migrate:database -- apply --history-variant <original-production|repaired-bootstrap> --expected-pending <ordered-tags>` |
| Verify/no-op | `bun run migrate:database -- verify --history-variant <variant> --expected-floor <tag>` |
| Runtime | `DATABASE_URL=<pooled Neon URL>` |
| P0 migration | `0019_neon_authority_reconciliation.sql` |
| PR A next slot | `0020_meeting_authority_foundation.sql` after rebase and live verification |

Do not use `drizzle-kit push` for tracked/shared schema. Do not create new Alembic revisions or Supabase migrations.

### Bootstrap strategy: repair the premature historical FK blocks, then reconcile in `0019`

The current chain cannot reach `0019` on an empty database: `0000` adds three tenant FKs plus `work_items.assignee_id -> public.users`, and `0004` adds `projects.lead_id -> public.users`, before `tenants` or `users` exists. PostgreSQL raises `undefined_table`; a repair-only `0019` is therefore unreachable. The selected strategy is a tightly bounded historical bootstrap repair, not a squashed second baseline:

1. In `0000` and `0004`, change only those five `DO` blocks so they add the original, byte-identical FK definition when `to_regclass('public.tenants')` or `to_regclass('public.users')` exists and otherwise defer it. Do not change table/column/type/index creation, ordering, timestamps, tags, or any other migration.
2. Record canonical LF/legacy CRLF hashes of the production-applied originals and canonical hashes of the repaired files in the historical manifest. A semantic checker requires exactly those five guard changes and the unchanged FK names, columns, referenced columns, and actions.
3. The canonical runner has three operations. `bootstrap` requires a genuinely empty database and `repaired-bootstrap`, then records repaired `0000`/`0004` hashes. `apply` accepts a complete recognized prefix of either variant, but its explicit `--history-variant` must match the environment's authority contract and the observed hashes; it applies only the exact caller-declared contiguous suffix after re-reading under lock. `verify` requires a recognized complete prefix at the declared floor and zero pending, then exits successfully with `NOOP` and no journal/DDL write. Mixed/unknown variants, variant/environment mismatch, or undeclared pending migrations fail.
4. `0019` creates/asserts the missing canonical baseline and adds the five deferred FKs. Thus an empty database reaches the same catalog as production, while production applies only its pending suffix.

This is the only exception to historical Drizzle immutability. Supabase, Alembic, raw Meeting SQL, and Drizzle `0001`–`0003` plus `0005`–`0018` remain byte-for-byte unchanged.

Drizzle metadata snapshots stop at `0011` even though hand-authored SQL/journal entries continue through `0018`. DEV must first add the complete current schema model, then run normal `drizzle-kit generate` against that known stale checkpoint. The resulting broad `0019` diff is the reconciliation input: review and rewrite **only the new `0019` SQL** into guarded additive DDL while retaining the generated `meta/0019_snapshot.json` as the first complete post-reconciliation checkpoint. Never synthesize fake intermediate `0012`–`0018` snapshots or edit migrations beyond the separately audited five blocks in `0000`/`0004`. A no-change generation probe after `0019` must report no diff; PR A then generates from the real `0019` snapshot.

The migration defines the current live shapes for:

- `users`, `tenants`, `user_auth_identities`, `organization_memberships`, `organization_invitations`;
- `meetings`, `transcript_segments`, `summaries`, `chat_messages`, `jobs`;
- `meeting_state`, `chapter_summaries`, `decisions`, `action_items`, `open_questions`;
- `audio_assets`, `agent_invocations`, `agent_responses`, `meeting_links`.

It uses schema-qualified, additive DDL in one transaction. Creation guards are followed by exact catalog assertions; `IF NOT EXISTS` is never treated as compatibility proof. For every same-named object, assertions cover relation kind/schema; column type OID/typmod, collation, nullability, identity/generated state, and normalized default; enum label/order; constraint definition, referenced columns, match mode, deferrability, and `ON UPDATE`/`ON DELETE`; and index uniqueness, access method, key/expression order, opclass, included columns, and normalized predicate. Any mismatch raises with an object identifier, rolls the transaction back, and leaves no `0019` journal row. It requires the pre-provisioned NOLOGIN roles `product_suite_platform_runtime` and `product_suite_meeting_runtime`, creates the five deferred FKs, revokes `CREATE` on `public` from `PUBLIC`, installs exact grants/default privileges to those roles, never creates `alembic_version` on fresh databases, and never alters the production marker.

The authored repair and `0019` SQL pass a token-aware DML firewall banning `INSERT`, `UPDATE`, `DELETE`, `MERGE`, `COPY`, and `TRUNCATE` in every form, plus `DROP`, cross-database facilities, `CREATE SCHEMA meeting`, Supabase roles/functions, and data-dependent backfills. The runner's own append to `drizzle.__drizzle_migrations` is the sole allowed write outside DDL and is tested separately.

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

The inaccessible Vercel deployment and Supabase data client are not silently relabeled. The service registry marks the app unsupported/archived; both `.github/workflows/roadmap-supabase.yml` and `.github/workflows/roadmap-web-playwright.yml` are removed because the latter still injects live Supabase URL, anon, service-role, and test-user secrets. Conformance excludes the app from supported production services. Its source remains for historical/product recovery; migrating it to Platform API is separate work.

## Historical migration preservation

Create `docs/history/database-migrations/manifest.json` and a checker covering exactly:

- `infra/supabase/migrations/**`;
- `apps/roadmap-web/supabase/migrations/**`;
- `apps/meeting-api/backend/alembic/versions/**`;
- `apps/meeting-api/backend/migrations/**`.

The manifest records relative path, canonical LF SHA-256, and where needed the observed legacy CRLF SHA-256. It records these roots as `historical_non_authoritative`; it is not a second journal and is never consulted to decide pending Neon migrations.

Drizzle `0001`–`0003` and `0005`–`0018` are immutable. The manifest records original and repaired variants for only `0000` and `0004`, and the checker AST-compares the five permitted guard edits. Add `.gitattributes` for LF on SQL/JSON control files. Production must retain the original applied hashes; empty bootstrap records repaired hashes. The checker rejects mixed variants, semantic drift, duplicate/non-contiguous order, unknown hashes, or timestamp/tag edits. `meta/0019_snapshot.json` is a deliberate checkpoint, not evidence that missing intermediate snapshots existed.

## Fresh clone, local, CI, and deploy behavior

### Fresh clone/local

1. `bun install --frozen-lockfile`.
2. Start a digest-pinned PostgreSQL 17 image with pgvector; assert `server_version_num` is PostgreSQL 17 and `CREATE EXTENSION vector` succeeds.
3. As the local SQL administrator, run `bun run provision:database-roles`; assert both required NOLOGIN grant roles exist and the configured test LOGIN role has only its intended membership.
4. Set a direct local `MIGRATION_DATABASE_URL`; run `bun run migrate:database -- bootstrap --history-variant repaired-bootstrap --expected-pending <0000..0019>`. Then run `verify --history-variant repaired-bootstrap --expected-floor 0019` and require `NOOP`.
5. Start Meeting/Platform runtimes with `DATABASE_URL`; no Supabase CLI, Alembic, or raw Meeting runner is invoked.

Local OSS Meeting development may use local Postgres. Hosted configuration always validates Neon.

### Pull-request CI

1. Static authority, historical-manifest, URL-purpose, migration parity, and API-shape tests.
2. Empty digest-pinned PostgreSQL 17 + pgvector bootstrap through `0019`, asserting repaired `0000`/`0004` hashes and exact catalog; follow with the separate `verify` operation and require a zero-write `NOOP`.
3. Meeting tests against that database, including readiness without `alembic_version`.
4. Two real-DB proofs: (a) create a disposable test-only Neon project whose root branch has an empty `neondb`; prove its project ID differs from production, authority contract says `test-only/repaired-bootstrap`, provision NOLOGIN roles, bootstrap, verify/no-op, then delete the entire project in `finally` and verify deletion; (b) create a production-derived branch, pin `original-production`, provision/verify roles, apply the P0 suffix, and prove parent isolation. A child branch of populated production is never described as empty.
5. The real-Neon job fails when credentials are missing, no tests execute, cleanup fails, output is truncated, or evidence cannot be reconstructed.

### Production rollout order

1. Rebase on current `origin/main`; recalculate next migration order. Abort if another migration took `0019`.
2. Capture privacy-safe preflight: exact main SHA, Neon project/root production branch, applied Drizzle tags/timestamps/hashes/count, `alembic_version`, exact catalog inventory, current LSN/timestamp, and per-table row counts only.
3. Create a retained Neon snapshot of the production root branch at that exact LSN (timestamp only if LSN is unavailable). Verify snapshot state and a test restore to an isolated branch. Its `expires_at` must be later than the full acceptance window plus PR A's planned rollout and contingency buffer; if the plan/feature cannot provide sufficient retention, deployment is blocked. Record snapshot ID/LSN/expiry, never a credential.
4. Configure GitHub environment secret `MIGRATION_DATABASE_URL` with a direct production-branch Neon URL. Keep Cloudflare/Meeting `DATABASE_URL` pooled. Validators must agree on project/branch/database/provider but never print either URL.
5. Neon project administrators are the control-plane authority for creating/rotating LOGIN identities and credentials out of band. Before `0019`, the direct SQL authority named by `MIGRATION_DATABASE_URL` must be `neondb_owner` (or an explicitly approved equivalent with role-administration authority) and run `provision:database-roles` to create/validate the two NOLOGIN grant roles and grant each environment LOGIN only its intended membership. Missing `CREATEROLE`/ADMIN OPTION, missing roles, or unauthorized membership blocks every path before migration.
6. Human-approve one exact-main-SHA deploy run pinned to `original-production`. The direct runner acquires a fixed advisory lock, re-reads history inside the apply session, and accepts exactly `{0018,0019}` or `{0019}` with expected tag/timestamp/hash/count. Reject empty, extra, missing, reordered, unknown, repaired-bootstrap, or environment/flag mismatch before DDL.
7. Apply with `apply --history-variant original-production --expected-pending <observed-approved-set>`; never manually mark history. Then run `verify --history-variant original-production --expected-floor 0019`, require `NOOP`, and verify the accepted row count, immutable history, unchanged `alembic_version`/rows, exact catalog, and no open transaction.
8. Rotate Cloudflare Platform and any restored Meeting runtime `DATABASE_URL` to their pooled least-privilege login. Prove positive required CRUD/readiness and negative `CREATE/ALTER/DROP`, cross-service table access, role membership, and owner/superuser capabilities before traffic; then invalidate the former runtime owner credential if it is not the migration credential.
9. Deploy Platform API and exercise DB-backed readiness plus read-only authenticated API smoke. Reauthenticate Railway only if Meeting is restored; dead Vercel/Railway records are not rollout success.
10. After both Supabase workflows are gone and repository consumers are proven absent, human-remove Supabase repository secrets/variables and archive/delete stale external projects. Repository code never deletes secrets.

## Rollback

- Before migration: abort with no change if provenance, backup/restore, direct URL, exact SHA, or schema checks fail.
- During migration: catalog assertion, DML-firewall, or apply error rolls back all `0019` DDL and its journal append while the advisory lock is held. Do not repair/insert/delete history manually.
- After migration but before deploy: keep additive schema; fix forward. Do not run a down migration.
- After application failure: roll the Worker/service back to its previous version. `0019` is backwards-compatible and stays applied.
- Data recovery: use the verified retained snapshot/LSN only under a separate incident approval; restoring overwrites the root branch and is not an application rollback. Never repoint production to Supabase.
- Keep the snapshot until its verified expiry exceeds P0 acceptance and PR A's rollout/contingency window; extend or replace it before expiry if either window slips.

## Secrets and security

- `MIGRATION_DATABASE_URL`: direct Neon, CI environment only, owner/migration privileges, scoped only to migration/preflight steps.
- `DATABASE_URL`: pooled Neon, runtime only, distinct Platform/Meeting login roles that inherit checked NOLOGIN grant roles. Neither role owns objects, has `CREATE` on `public`, belongs to an owner/admin role, or can access tables outside its enumerated manifest.
- `NEON_API_KEY`: only branch create/inspect/delete steps; never application runtime.
- Structural URL validation: `postgres`/`postgresql` scheme, exact `.neon.tech` hostname suffix, `neondb`, TLS required, pooled/direct purpose, and control-plane project/branch match. Substring checks are insufficient.
- Logs/evidence include only revision, canonical hash, project/branch IDs, purpose, status, counts, and opaque deployment IDs. Redact URLs, usernames, passwords, tokens, auth claims, content, prompts, embeddings, and row payloads.
- Revoke `CREATE` on `public` from `PUBLIC`; install checked current/default grants and rotate runtime secrets away from the observed `neondb_owner`. Do not add RLS as a substitute for current server-side authorization in this issue.

## Edge cases

- `0019` sees any same-name object with incompatible kind, type/typmod, nullability, default, enum order, index predicate/opclass, or FK action: raise and roll back the whole migration; do not coerce, drop, or accept `IF NOT EXISTS` as proof.
- Bootstrap encounters application objects/history or a non-disposable Neon target: fail. P0 production apply rejects any variant except environment-pinned `original-production` and any pending set except `{0018,0019}` or `{0019}`. Generic post-P0 suffix apply accepts either recognized environment-pinned variant with an exact declared contiguous suffix; mixed/unknown/mismatched variants always fail.
- Verify sees a recognized declared variant at the expected floor and zero pending: return `NOOP` without mutation. Pending migrations, wrong floor, wrong variant, or unknown hashes fail.
- Required NOLOGIN grant roles are absent or SQL authority cannot create/validate/grant them: fail before `0019`; never create LOGIN credentials inside migration SQL.
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
- Neon branches support isolated schema testing. Durable rollback evidence uses a snapshot captured at a timestamp/LSN with explicit expiry; root-branch instant restore is overwrite-not-merge and only works inside the configured history window. [Neon backup and restore](https://neon.com/docs/guides/backup-restore), [Neon instant restore](https://neon.com/docs/introduction/branch-restore)
- Keeping Supabase CLI automation would keep a distinct remote migration-history protocol active; preserve its migrations as history and retire the linked workflow. [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction)
- PostgreSQL `search_path` trusts creators in searched schemas. Remove the provider-dependent path and restrict public schema creation. [PostgreSQL schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)
- OWASP-relevant controls cover access control, secret redaction, URL/SQL injection, single-history integrity, configuration fail-closed behavior, and auditable exact-SHA rollout.
- Required TDD covers hosted Neon acceptance, Supabase/dual config rejection, populated no-op reconciliation, historical hash/line-ending integrity, empty bootstrap, and application-only rollback.

## Exact implementation ownership and estimate

No two same-wave tasks own the same file. Sequential cross-wave edits are explicit in `tasks.md`.

| Wave | Owned surface | Estimate |
| --- | --- | --- |
| 1 | Authority contract/validator; historical manifest/checker; five-block `0000`/`0004` bootstrap repair; tests | 9–12 files, 450–700 net LOC plus generated manifest |
| 2 | Canonical Meeting/identity model, exact catalog assertions/grants, `0019` migration/journal/snapshot; schema tests | 7–10 files, 700–1,050 net LOC |
| 3 | Meeting hosted config/readiness and retirement of active Alembic/raw runners; tests | 12–16 changed/deleted files, 250–400 net LOC |
| 4 | Canonical guarded runner, pg17+pgvector bootstrap, two ephemeral Neon proofs, URL split/readiness, least-privilege rotation; workflows/tests/docs | 14–19 files, 650–950 net LOC |
| 5 | Both Supabase workflow retirements, legacy Roadmap/service classification, canonical docs and stack handoff | 9–12 changed/deleted files, 220–380 net LOC |

Expected PR: 43–57 paths including deletions and generated manifest, approximately 2,300–3,500 net authored LOC. Catalog assertions, the guarded runner, and real-DB proofs are the largest portions. If DEV discovery exceeds this bound or requires Roadmap data-client migration, stop and return to PLAN.

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
canonical_apply: bun run migrate:database -- apply --history-variant <environment-pinned-variant> --expected-pending <ordered-tags>
canonical_verify: bun run migrate:database -- verify --history-variant <variant> --expected-floor <tag>
runtime_url_contract: pooled Neon DATABASE_URL
history_contract: production pins original-production; fresh/staging pins repaired-bootstrap; suffix apply and verify support both; mixed/unknown fail
canonical_applied_floor: 0019_neon_authority_reconciliation
pr_a_candidate_revision: 0020_meeting_authority_foundation.sql
historical_non_authoritative: Supabase migrations, Meeting Alembic versions/raw SQL
```

PR A must run its `0020` apply and zero-pending verify suites against both history variants, while production remains pinned to `original-production`. It still rebases, reruns order/live-floor checks, and renumbers if another migration lands. It creates no Alembic/Supabase file and does not modify the repair or reconciliation migration.

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

Approve DEV only if the human accepts all seven locked decisions:

1. `packages/db` Drizzle becomes the only supported migration plane.
2. P0 owns the manifest-audited five-block bootstrap repair in `0000`/`0004` plus additive/cross-catalog-asserting `0019`; production history rows/hashes are never rewritten. PR A consumes candidate `0020` after live verification.
3. Drizzle `0001`–`0003`, `0005`–`0018`, and all Supabase/Alembic/raw migration files stay immutable; active runners and both Supabase workflows retire.
4. Supported hosted services reject Supabase/dual DB configuration; the legacy Roadmap app is explicitly unsupported rather than migrated here.
5. P0 production accepts only `{0018,0019}` or `{0019}` under a lock; later exact suffixes and zero-pending verification work on both environment-pinned recognized variants, including PR A `0020`.
6. Neon administrators own LOGIN lifecycle; the direct SQL authority provisions/validates required NOLOGIN grant roles before `0019` on every path. Runtime secrets rotate from `neondb_owner` to tested least-privilege LOGIN roles out of band.
7. Rollout requires a retained, test-restored Neon snapshot at exact LSN/timestamp with expiry beyond P0 plus PR A contingency, exact-SHA approval, post-migration row/history/catalog proof, and forward-only application rollback.

No DEV, push, PR, external secret mutation, or production database operation is authorized by this document.
