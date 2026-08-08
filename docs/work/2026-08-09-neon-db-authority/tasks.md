# Tasks: canonical Neon database authority

**Issue:** `59efc6dc-07a1-4b31-9942-ba2f1fcac8e1`
**Plan:** [`plan.md`](./plan.md)
**Base at PLAN:** `origin/main@42e30d88bc516dc6472c9f1bb837bd694844aa47`
**Execution:** sequential waves; one implementer owns each task; RED–GREEN–REFACTOR plus spec and quality review per `/dev`.

## Entry hard gate

Before Task 1:

1. Human approves the five locked decisions in `plan.md`.
2. Re-fetch `origin/main`; rebase this worktree; prove Forge lease ownership.
3. Re-run migration order. If another migration has taken `0019`, amend this task list and PR A's candidate slot together before code.
4. Install locked Bun and Python 3.13 dependencies. Establish a green untouched baseline or stop for explicit approval; do not weaken gates.
5. Capture the privacy-safe read-only live baseline and verify no DEV task would copy/drop/remigrate data.

## Wave 1 — authority contract

### Task 1: Freeze the supported Neon topology and URL-purpose validator

**Requirement anchor:** success criteria 1, 2, 8; A03/A05/A10 mitigations.
**OWNS:** `config/database-authority.json`; `scripts/check-database-authority.mjs`; `test/check-database-authority.test.js`; `package.json`
**Estimated size:** 4 files, 180–260 net LOC.

**What to implement:** Add a machine-readable contract that names Neon, `neondb`, `public`, active services, canonical Drizzle root/journal/commands, runtime pooled purpose, migration direct purpose, and historical roots. Add a pure validator/CLI that structurally parses URLs and validates scheme, exact `.neon.tech` hostname suffix, database, TLS, pooled/direct purpose, configured project/branch evidence, and absence of dual production DB settings. Export pure functions for tests. Never print or return a full URL, user, password, or query string.

**TDD steps:**

1. Write test: in `test/check-database-authority.test.js`, cover valid pooled runtime/direct migration Neon URLs; reject Supabase, lookalike hosts (`neon.tech.evil.example`), wrong database, non-TLS hosted URL, pooled migration URL, direct runtime when policy requires pooled, provider/host mismatch, two production URLs, and redacted errors.
2. Run test: `bun test test/check-database-authority.test.js`; confirm RED with `Cannot find module '../scripts/check-database-authority.mjs'`.
3. Implement: add contract, parser, validator, CLI, and root `check:database-authority` script. CLI reads secrets only from environment and emits provider/purpose/status/project/branch IDs, never values.
4. Run test: confirm all validator cases pass; run the CLI with synthetic Neon values and confirm no credential fragments appear.
5. Commit: `feat(db): freeze canonical Neon authority contract`.

**Expected output:** `Database authority check passed: provider=neon schema=public migration=drizzle` for valid config; deterministic redacted errors and nonzero exit for every invalid/dual config.

## Wave 2 — immutable history and cross-platform integrity

### Task 2: Preserve historical migrations and make applied-history checks line-ending safe

**Requirement anchor:** success criteria 3, 6; A08/A09 mitigations.
**OWNS:** `.gitattributes`; `docs/history/database-migrations/README.md`; `docs/history/database-migrations/manifest.json`; `scripts/check-historical-db-artifacts.mjs`; `scripts/check-migration-parity.mjs`; `test/check-historical-db-artifacts.test.js`; `test/check-migration-parity.test.js`; `package.json`
**Estimated size:** 8 files, 220–340 net authored LOC plus deterministic manifest entries.

**What to implement:** Record the four historical roots and hashes without editing their migration files. Add LF rules for migration SQL/JSON control files. Extend repository checks to understand the missing `0012`–`0018` snapshot history, require one deliberate complete snapshot at/after reconciliation, and distinguish accepted historical CRLF/LF hashes from semantic drift. The historical manifest is provenance only; it never determines pending Drizzle migrations.

**TDD steps:**

1. Write test: mutate fixture content semantically and by CRLF/LF only; assert semantic drift fails, recorded legacy line endings pass, an unrecorded file fails, duplicate/rewritten journal entries fail, and a fabricated intermediate snapshot fails.
2. Run test: `bun test test/check-historical-db-artifacts.test.js test/check-migration-parity.test.js`; confirm RED with missing checker/manifest assertions.
3. Implement: generate canonical manifest from Git content, record allowed legacy hashes, add checker and LF attributes, extend parity analysis without changing migration `0000`–`0018` or historical roots.
4. Run test: focused tests and `bun run check:migration-parity`; verify a clean checkout on Windows and LF-normalized temp fixture produce the same semantic result.
5. Commit: `test(db): lock historical migration provenance`.

**Expected output:** checks pass on the repository, identify `0000`–`0018` as immutable, explain accepted CRLF/LF legacy forms, and fail closed on content/order drift.

## Wave 3 — one reproducible schema chain

### Task 3: Add the complete Drizzle schema model and `0019` reconciliation checkpoint

**Requirement anchor:** success criteria 3, 4, 9, 10; PR A prerequisite.
**OWNS:** `packages/db/src/meeting-schema.ts`; `packages/db/src/schema.ts`; `packages/db/src/schema.test.ts`; `packages/db/migrations/0019_neon_authority_reconciliation.sql`; `packages/db/migrations/meta/0019_snapshot.json`; `packages/db/migrations/meta/_journal.json`; `packages/db/package.json`
**Estimated size:** 7 files, 500–800 net LOC including generated snapshot.

**What to implement:** Model the current public Meeting, tenant, identity, and membership tables in Drizzle and re-export them through the canonical schema. Generate normal migration `0019` from the stale `0011` snapshot to obtain a complete current snapshot. Review/rewrite only the new SQL into guarded additive/schema-qualified DDL that builds an empty database and converges on populated Neon. Include required indexes/constraints and `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. Do not create a `meeting` schema or touch data/history rows.

**TDD steps:**

1. Write test: extend schema tests and add an empty-Postgres schema contract fixture that expects all listed tables, types, nullability, FKs, uniques/checks, extensions, public-schema privilege, and absence of `meeting`/Supabase schemas. Add a static forbidden-SQL assertion for `DROP|TRUNCATE|DELETE|UPDATE|INSERT ... SELECT|CREATE SCHEMA meeting` in `0019`.
2. Run test: `bun run --cwd packages/db test`; confirm RED naming missing `meetings`, `tenants`, or `0019` checkpoint.
3. Implement: add schema model; run `bun run --cwd packages/db generate -- --name neon_authority_reconciliation`; keep the new full snapshot; review/rewrite only `0019` SQL into guarded additive DDL. Never synthesize `0012`–`0018` snapshots.
4. Run test: package tests/typecheck, parity/history checks, empty Postgres 17 migrate, then a no-change generation probe that reports `No schema changes, nothing to migrate` from the `0019` snapshot.
5. Commit: `feat(db): reconcile Neon schema under Drizzle`.

**Expected output:** empty Postgres reaches the current supported public schema using only Drizzle; populated-clone application changes no rows and appends one `0019` history row; next free filename is `0020_*`.

## Wave 4 — retire Meeting's second migration authority without changing its API

### Task 4: Make hosted Meeting Neon-only and switch readiness to the canonical schema

**Requirement anchor:** success criteria 2, 5, 6; API compatibility and fresh-clone behavior.
**OWNS:** `apps/meeting-api/backend/.env.example`; `apps/meeting-api/backend/config.py`; `apps/meeting-api/backend/db.py`; `apps/meeting-api/backend/requirements.txt`; `apps/meeting-api/tests/backend/test_config.py`; `apps/meeting-api/tests/backend/test_db.py`; `apps/meeting-api/tests/backend/test_schema_revision.py`; `apps/meeting-api/tests/backend/test_target_db_create_read_smoke.py`; `apps/meeting-api/tests/backend/test_target_db_smoke_config.py`
**Estimated size:** 9 files, 220–340 net LOC.

**What to implement:** Hosted default/provider becomes Neon; Supabase host/provider and dual DB config fail before connecting. OSS keeps local/general Postgres. Remove the `meeting,public` provider branch. Readiness verifies the canonical Drizzle floor/schema, not `alembic_version`. The smoke uses only `MEETING_TARGET_SMOKE_DATABASE_URL` and validates hosted Neon. Preserve all route/auth/response contracts.

**TDD steps:**

1. Write test: hosted omitted provider + pooled Neon passes; explicit Supabase provider/URL and lookalikes fail; OSS local Postgres passes; DB connection kwargs never install `meeting,public`; readiness passes on canonical clean schema without `alembic_version` and fails before `0019`; response key snapshots remain exact.
2. Run test: `bun run validate:meeting-api:test -- test_config.py test_db.py test_schema_revision.py test_target_db_smoke_config.py`; confirm RED because hosted still defaults `supabase` and readiness expects Alembic.
3. Implement: update config/pool/readiness/smoke seams and env example. Use the shared authority contract in tests; avoid duplicating permissive hostname logic.
4. Run test: focused Python tests, then full Meeting lint/test against the empty canonical database; verify no API snapshot changes.
5. Commit: `fix(meeting): enforce canonical Neon database authority`.

**Expected output:** hosted Meeting refuses Supabase before pool creation, OSS remains usable, canonical clean schema is ready, and public API shapes are unchanged.

### Task 5: Disable executable Alembic/raw migration runners while preserving their files

**Requirement anchor:** success criteria 3, 6; one total migration order.
**OWNS:** `apps/meeting-api/backend/alembic.ini` (delete); `apps/meeting-api/backend/alembic/env.py` (delete); `apps/meeting-api/backend/alembic/url_config.py` (delete); `apps/meeting-api/backend/alembic/__tests__/env.test.py` (delete); `apps/meeting-api/backend/alembic/__tests__/url_config.test.py` (delete); `apps/meeting-api/backend/migrate.py` (delete); `apps/meeting-api/README.md`; `apps/meeting-api/docs/deployment/HOSTED_FOUNDATION.md`; `apps/meeting-api/docs/deployment/PRODUCTION_HOSTED_LAUNCH_CHECKLIST.md`
**Estimated size:** 9 paths, net deletion 120–220 LOC plus 80–140 doc LOC.

**What to implement:** Remove configs/entrypoints that make historical Meeting migrations runnable as a supported plane. Do not modify `alembic/versions/**` or `backend/migrations/**`. Documentation points all fresh clone and hosted changes to the Drizzle owner and labels the retained files historical evidence.

**TDD steps:**

1. Write test: add assertions to Task 2's checker that historical files exist/hash-match, but no active package script, workflow, config, deployment doc, or runner invokes Alembic/raw Meeting migrations.
2. Run test: confirm RED naming `alembic.ini`, `alembic/env.py`, or `migrate.py` as active authority surfaces.
3. Implement: delete only runner/config/test surfaces, remove Alembic runtime dependency if unused, and update Meeting docs.
4. Run test: history checker, Meeting full tests, repository search for `alembic upgrade|python migrate.py`; only historical narrative/files may match.
5. Commit: `refactor(meeting): retire legacy migration runners`.

**Expected output:** historical SQL/version files remain byte-identical; no supported command can create a new Alembic/raw migration or apply that chain.

## Wave 5 — remove stale Supabase authority surfaces

### Task 6: Retire the Supabase cutover/live workflow and classify the legacy Roadmap app

**Requirement anchor:** success criteria 2, 6; out-of-scope legacy boundary.
**OWNS:** `.github/workflows/roadmap-supabase.yml` (delete); `scripts/check-supabase-exposure.mjs` (delete); `scripts/meeting-cutover-preflight.mjs` (delete); `test/check-supabase-exposure.test.js` (delete); `test/supabase-platform-schema.test.js` (delete); `test/meeting-cutover-preflight.test.js` (delete); `test/meeting-supabase-cutover-docs.test.js` (delete); `docs/deployment/MEETING_SUPABASE_CUTOVER.md` (move/archive or replace); `apps/roadmap-web/SUPABASE_SETUP.md`; `docs/deployment/service-registry.json`; `docs/deployment/SERVICE_INVENTORY.md`; `package.json`
**Estimated size:** 12 paths, net deletion 350–650 LOC plus 120–200 replacement doc LOC.

**What to implement:** Remove active Supabase database validation/cutover commands and classify their SQL roots through the immutable manifest. Mark Roadmap's inaccessible Supabase client application unsupported/archived in current service inventory, while preserving its source and historical migrations. Replace the cutover runbook with a concise historical pointer and canonical Neon rollout link. Root scripts/tests must not advertise Supabase as a live DB owner.

**TDD steps:**

1. Write test: extend `test/check-database-authority.test.js` to parse service registry/workflows/package scripts and fail when an active service or production command names Supabase DB, linked-project migration, dual write, or old cutover; explicitly allow only manifest-listed history and unsupported legacy source.
2. Run test: confirm RED naming `roadmap-supabase.yml`, `check:supabase-exposure`, or `preflight:meeting-cutover`.
3. Implement: delete active workflow/scripts/tests, update root scripts and service classification, archive/replace current-state docs without editing historical migration files.
4. Run test: authority/history/repo-tooling tests and a whole-repo blast search; every remaining Supabase match is categorized as auth/non-DB legacy, unsupported legacy app, immutable migration, or historical plan.
5. Commit: `chore(db): retire stale Supabase authority surfaces`.

**Expected output:** no supported production service/workflow/config uses a Supabase database; historical artifacts remain discoverable and hash-verified.

## Wave 6 — reproducible CI and exact-SHA deployment

### Task 7: Prove empty bootstrap and harden direct-migration versus pooled-runtime deployment

**Requirement anchor:** success criteria 7, 8, 9; rollout/rollback contract.
**OWNS:** `.github/workflows/meeting-api-ci.yml`; `.github/workflows/platform-api-deploy.yml`; `scripts/check-worker-secrets.mjs`; `test/check-worker-secrets.test.js`; `apps/platform-api/DEPLOY.md`; `docs/deployment/DATABASE_AUTHORITY.md`; `package.json`
**Estimated size:** 7 files, 260–420 net LOC.

**What to implement:** Meeting CI starts empty Postgres 17 and runs only canonical Drizzle migrate before Python tests. Platform deploy requires `MIGRATION_DATABASE_URL` direct and uses it only in migration steps; Worker `DATABASE_URL` remains pooled runtime. Extend current exact-main-SHA, environment approval, and concurrency gates with project/branch/provider/purpose validation, pre-migration restore evidence input, pending-list evidence, and post-migration history/schema/row-count checks. Do not print secrets or automatically delete Supabase secrets.

**TDD steps:**

1. Write test: workflow/tooling fixtures reject a pooled migration URL, non-Neon URL, missing restore evidence, migration after stale SHA, runtime secret in migration scope, missing empty-bootstrap step, and secret/error output containing DSN fragments.
2. Run test: focused worker/authority workflow tests; confirm RED because deploy uses `DATABASE_URL` for migration and Meeting CI invokes Alembic.
3. Implement: update workflows/scripts/docs/root commands. Keep `NEON_API_KEY` scoped only to branch/control-plane steps and direct URL scoped only to migrate/pre/postflight.
4. Run test: YAML/static tests, empty Postgres bootstrap, Meeting full suite, dry-run workflow simulation with synthetic redacted URLs, and migration parity/history checks.
5. Commit: `ci(db): enforce canonical Neon migration rollout`.

**Expected output:** CI can build from empty with Drizzle alone; deploy refuses wrong provider/purpose/SHA/restore evidence; logs contain revision/provider/branch/status only.

### Task 8: Add DB-backed readiness and required ephemeral-Neon conformance

**Requirement anchor:** success criteria 7–10; current Worker secret value is not externally readable.
**OWNS:** `apps/platform-api/src/db.ts`; `apps/platform-api/src/db.test.ts`; `apps/platform-api/src/app.ts`; `apps/platform-api/src/app.test.ts`; `apps/platform-api/test/db-contract/harness.ts`; `apps/platform-api/test/db-contract/neon-authority.test.ts`; `apps/platform-api/vitest.db-contract.config.ts`; `apps/platform-api/package.json`; `.github/workflows/db-contract.yml`
**Estimated size:** 9 files, 300–480 net LOC.

**What to implement:** Validate Neon before client creation. Add a minimal DB-backed readiness endpoint/smoke response that reveals no topology detail beyond `provider=neon` and `schemaReady`. Extend the existing branch harness to apply pending canonical migrations on an ephemeral branch, record before/after row counts and histories, prove `0019` preserves populated rows/Alembic marker, and clean up in `finally`. Required command must fail if credentials are missing or zero tests run.

**TDD steps:**

1. Write test: unit response/redaction tests plus real-DB cases for provider rejection, pending `0018→0019` order, unchanged row counts/history prefix/Alembic marker, canonical tables/constraints, no `meeting` schema, and branch deletion evidence.
2. Run test: unit tests RED with missing validator/readiness; required real command RED if credentials absent or migration evidence missing.
3. Implement: wire validator/readiness and harness; never return/log URL, role, content, row payload, or query error detail.
4. Run test: Platform lint/type/test; required ephemeral Neon command with credentials; confirm parent branch history/counts remain unchanged and cleanup evidence exists.
5. Commit: `test(db): prove Neon authority on ephemeral branch`.

**Expected output:** readiness proves the opaque runtime secret reaches canonical Neon; ephemeral branch shows ordered additive convergence and verified deletion; missing evidence is nonzero.

## Wave 7 — canonical documentation and stack handoff

### Task 9: Replace stale ownership docs and publish PR A's exact interface

**Requirement anchor:** success criteria 1, 10; stage exit context.
**OWNS:** `docs/architecture/schema-domain-ownership.md`; `README.md`; `DESIGN.md`; `docs/INDEX.md`; `docs/work/2026-08-09-neon-db-authority/decisions.md`; `docs/work/2026-08-09-neon-db-authority/plan.md`; `docs/work/2026-08-09-neon-db-authority/tasks.md`
**Estimated size:** 8 files, 180–300 net LOC.

**What to implement:** Make current architecture docs state one Neon/public physical topology and one Drizzle migration plane; retain links to historical Supabase/Alembic evidence. Record implementation decisions, exact applied floor, next revision, commands, active/dead/unverified deployments, rollout evidence, and privacy limits. Amend PR A's plan/task placeholders only through a separate owner/handoff after this issue lands; do not edit another worktree.

**TDD steps:**

1. Write test: extend authority/docs alignment assertions so current-state docs cannot say Supabase Postgres is source of truth, Meeting is moving to Supabase, or Alembic owns new migrations; require exact PR A handoff fields.
2. Run test: confirm RED naming stale ownership rows/current-state statements.
3. Implement: update canonical docs and decision log from verified live evidence; keep historical plans untouched.
4. Run test: docs/authority/history alignment, whole-repo categorized Supabase/Alembic search, full relevant validation, and `forge issue show` readback.
5. Commit: `docs(db): publish canonical Neon authority handoff`.

**Expected output:** a new session can recover provider/schema/model/root/journal/generate/apply/runtime/applied-floor/next-slot facts without reading historical PR19/PR20 material.

## Final validation and stage exit

After all tasks and reviews:

1. Re-prove Forge lease ownership.
2. Rebase on current main and rerun migration-order checks; update `0019/0020` only if required and rerun everything.
3. Run authority/history/parity checks, package DB lint/type/test, Meeting full validation, Platform API lint/type/test, empty Postgres bootstrap, required ephemeral Neon conformance, and workflow/docs alignment.
4. Verify `git diff` does not modify any manifest-listed historical migration file and contains no data-copy/drop/down-migration SQL.
5. Record Forge stage exit with `summary`, `decisions`, `artifacts`, and `next`.
6. Stop at VALIDATE/SHIP checkpoint. Do not push, deploy, rotate secrets, apply production migrations, open a PR, or begin PR A without the next explicit stage authorization.

## YAGNI audit

Every task maps to an issue acceptance criterion or an identified stale authority path. No task adds RLS, a new database abstraction, a Supabase compatibility adapter, automatic secret deletion, data migration, Roadmap API conversion, or PR A authorization behavior. If any becomes necessary, stop and amend the approved plan rather than absorb it.
