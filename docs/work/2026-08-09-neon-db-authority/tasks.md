# Tasks: canonical Neon database authority

**Issue:** `59efc6dc-07a1-4b31-9942-ba2f1fcac8e1`
**Plan:** [`plan.md`](./plan.md)
**Base at PLAN:** `origin/main@42e30d88bc516dc6472c9f1bb837bd694844aa47`
**Execution:** sequential waves; one implementer owns each task; RED–GREEN–REFACTOR plus spec and quality review per `/dev`.

## Entry hard gate

Before Task 1:

1. Human approves the seven locked decisions in `plan.md`.
2. Re-fetch `origin/main`; rebase this worktree; prove Forge lease ownership.
3. Re-run migration order. If another migration has taken `0019`, amend this task list and PR A's candidate slot together before code.
4. Install locked Bun and Python 3.13 dependencies. Establish a green untouched baseline or stop for explicit approval; do not weaken gates.
5. Capture the privacy-safe read-only live baseline, original production migration hashes, exact catalog, current runtime role, and current LSN/timestamp; verify no DEV task would copy/drop/remigrate data.

## Wave 1 — authority contract

### Task 1: Freeze the supported Neon topology and URL-purpose validator

**Requirement anchor:** success criteria 1, 2, 8; A03/A05/A10 mitigations.
**OWNS:** `config/database-authority.json`; `scripts/check-database-authority.mjs`; `test/check-database-authority.test.js`; `package.json`
**Estimated size:** 4 files, 180–260 net LOC.

**What to implement:** Add a machine-readable contract that names Neon, `neondb`, `public`, active services, Drizzle root/journal/commands, historical roots, and environment history pins: production=`original-production`, fresh/staging/test=`repaired-bootstrap`. Define P0's allowed suffixes and future exact contiguous suffix declaration. Add structural URL/project/branch/environment validation and reject dual DB settings or CLI variant differing from the environment pin. Never expose URL/user/password/query values.

**TDD steps:**

1. Write test: cover pooled/direct Neon URLs and valid environment pins; reject Supabase/lookalike/wrong DB/non-TLS, provider mismatch, two production URLs, production+repaired variant, fresh/staging+original variant, undeclared environment, and redaction failure.
2. Run test: `bun test test/check-database-authority.test.js`; confirm RED with `Cannot find module '../scripts/check-database-authority.mjs'`.
3. Implement: add contract, parser, validator, CLI, and root `check:database-authority` script. CLI reads secrets only from environment and emits provider/purpose/status/project/branch IDs, never values.
4. Run test: confirm URL and environment/variant cases pass; run the CLI with synthetic values and confirm no credential fragments appear.
5. Commit: `feat(db): freeze canonical Neon authority contract`.

**Expected output:** valid output includes provider/schema/migration/history-variant only; every invalid URL, dual config, or environment/variant mismatch is redacted and nonzero.

## Wave 2 — immutable history and cross-platform integrity

### Task 2: Repair the five unreachable FK blocks and lock both history variants

**Requirement anchor:** success criteria 3, 6; A08/A09 mitigations.
**OWNS:** `.gitattributes`; `packages/db/migrations/0000_stale_jamie_braddock.sql`; `packages/db/migrations/0004_minor_lockheed.sql`; `docs/history/database-migrations/README.md`; `docs/history/database-migrations/manifest.json`; `scripts/check-historical-db-artifacts.mjs`; `scripts/check-migration-parity.mjs`; `test/check-historical-db-artifacts.test.js`; `test/check-migration-parity.test.js`; `test/fixtures/db-history/**`; `package.json`
**Estimated size:** 10–12 paths, 320–500 net authored LOC plus deterministic manifest entries.

**What to implement:** Prove the untouched chain fails on empty PostgreSQL because five FK blocks precede `tenants/users`. Change only those blocks to add the exact original FK when the referenced relation exists and otherwise defer it to `0019`. Record original LF/CRLF production hashes and repaired-bootstrap hashes; AST/assertion logic permits only the guard and requires unchanged names/columns/actions. Drizzle `0001`–`0003`, `0005`–`0018`, and all Supabase/Alembic/raw SQL remain byte-identical. Define two valid prefixes: original-production and repaired-bootstrap; reject mixed/unknown. The manifest is provenance/validation, never a second pending journal.

**TDD steps:**

1. Write test: execute untouched fixtures on empty PostgreSQL 17 and assert RED at `0000` missing `public.tenants`; test all five guards, exact semantic diff, original-production/repaired-bootstrap acceptance, mixed/unknown rejection, CRLF/LF handling, and fabricated snapshot rejection.
2. Run test: `bun test test/check-historical-db-artifacts.test.js test/check-migration-parity.test.js`; then `bun run test:db-bootstrap-history -- --stop-after 0004`; capture the expected `undefined_table` RED.
3. Implement: modify only the five blocks, generate before/after manifest entries, add LF rules and semantic checker. Do not rewrite any live journal row or any other migration.
4. Run test: the focused Bun tests; `bun run check:migration-parity`; `bun run test:db-bootstrap-history -- --stop-after 0004` now passes; mutation fixtures prove every sixth edit or mixed hash variant fails.
5. Commit: `test(db): lock historical migration provenance`.

**Expected output:** checks name exactly five allowed repair blocks; existing-live original hashes and fresh repaired hashes each pass in their mode; mixed/unknown variants fail; no production history rewrite is proposed.

## Wave 3 — one reproducible schema chain

### Task 3: Add the complete Drizzle schema model and `0019` reconciliation checkpoint

**Requirement anchor:** success criteria 3, 4, 9, 10; PR A prerequisite.
**OWNS:** `config/database-grants.json`; `packages/db/src/meeting-schema.ts`; `packages/db/src/schema.ts`; `packages/db/src/schema.test.ts`; `packages/db/src/catalog-contract.ts`; `packages/db/src/catalog-contract.test.ts`; `packages/db/migrations/0019_neon_authority_reconciliation.sql`; `packages/db/migrations/meta/0019_snapshot.json`; `packages/db/migrations/meta/_journal.json`; `packages/db/test/catalog-rollback.test.ts`; `packages/db/test/sql-firewall.test.ts`; `packages/db/package.json`
**Estimated size:** 12 files, 800–1,180 net LOC including generated snapshot.

**What to implement:** Model the full current schema, generate normal `0019` from the real `0011` snapshot, and retain the complete new snapshot. Rewrite only new SQL into transactional additive DDL. Every creation guard is followed by exact catalog assertions for relation kind; column type/typmod/collation/null/default/identity/generated; enum order; constraint definition/FK actions; and index method/keys/opclass/include/predicate. Require pre-existing NOLOGIN roles `product_suite_platform_runtime` and `product_suite_meeting_runtime`; missing/wrong-kind roles fail before object DDL. Add the five deferred FKs and exact grants/default privileges to those roles. Mismatch raises and rolls back; no `0019` journal row remains. A token-aware firewall bans `INSERT/UPDATE/DELETE/MERGE/COPY/TRUNCATE` plus destructive DDL in authored repair/0019 SQL.

**TDD steps:**

1. Write test: exact catalog fixtures cover types/null/defaults/enums/index predicates/opclasses/FK actions; inject one incompatibility per category and assert SQLSTATE/error object plus rollback. Add missing-role, LOGIN-instead-of-NOLOGIN, and unauthorized-membership fixtures that fail before table DDL. Firewall fixtures cover comments/strings/dollar quotes and banned DML tokens.
2. Run test: `bun run --cwd packages/db test`; `bun run --cwd packages/db test:catalog-rollback`; `bun run --cwd packages/db test:sql-firewall`; confirm RED on missing model/assertions/migration.
3. Implement: add schema model; run `bun run --cwd packages/db generate -- --name neon_authority_reconciliation`; keep the new full snapshot; review/rewrite only `0019` SQL into guarded additive DDL. Never synthesize `0012`–`0018` snapshots.
4. Run test: `bun run --cwd packages/db lint`; `bun run --cwd packages/db typecheck`; `bun run --cwd packages/db test`; `bun run --cwd packages/db test:catalog-rollback`; `bun run --cwd packages/db test:sql-firewall`; history/parity checks; then no-change generation reports `No schema changes, nothing to migrate`.
5. Commit: `feat(db): reconcile Neon schema under Drizzle`.

**Expected output:** exact-compatible catalogs converge; any same-name incompatibility rolls back everything; authored migration SQL has zero DML; next free filename is `0020_*`.

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
**OWNS:** `.github/workflows/roadmap-supabase.yml` (delete); `.github/workflows/roadmap-web-playwright.yml` (delete); `scripts/check-supabase-exposure.mjs` (delete); `scripts/meeting-cutover-preflight.mjs` (delete); `test/check-supabase-exposure.test.js` (delete); `test/supabase-platform-schema.test.js` (delete); `test/meeting-cutover-preflight.test.js` (delete); `test/meeting-supabase-cutover-docs.test.js` (delete); `docs/deployment/MEETING_SUPABASE_CUTOVER.md` (archive/replace); `apps/roadmap-web/SUPABASE_SETUP.md`; `docs/deployment/service-registry.json`; `docs/deployment/SERVICE_INVENTORY.md`; `package.json`
**Estimated size:** 13 paths, net deletion 430–760 LOC plus 120–200 replacement doc LOC.

**What to implement:** Remove both active Supabase workflows. `roadmap-web-playwright.yml` is in scope because it passes `NEXT_PUBLIC_SUPABASE_URL`, anon key, service-role key, and live test-user secrets into CI. Retire active cutover commands, mark Roadmap unsupported/archived, preserve source/history, and require consumer-proof before humans delete repository secrets.

**TDD steps:**

1. Write test: parse registry, all workflows, package scripts, and active docs; fail on Supabase DB, linked migration, dual write, or any secret reference including the Roadmap Playwright workflow; allow only manifest history and unsupported source.
2. Run test: `bun test test/check-database-authority.test.js test/check-historical-db-artifacts.test.js`; confirm RED naming both Roadmap workflows and active commands.
3. Implement: delete active workflow/scripts/tests, update root scripts and service classification, archive/replace current-state docs without editing historical migration files.
4. Run test: authority/history/repo-tooling tests and a whole-repo blast search; every remaining Supabase match is categorized as auth/non-DB legacy, unsupported legacy app, immutable migration, or historical plan.
5. Commit: `chore(db): retire stale Supabase authority surfaces`.

**Expected output:** no supported production service/workflow/config uses a Supabase database; historical artifacts remain discoverable and hash-verified.

## Wave 6 — reproducible CI and exact-SHA deployment

### Task 7: Build the guarded runner and prove both migration histories

**Requirement anchor:** success criteria 7, 8, 9; rollout/rollback contract.
**OWNS:** `scripts/provision-database-roles.mjs`; `scripts/migrate-database.mjs`; `scripts/migration-evidence.mjs`; `test/provision-database-roles.test.js`; `test/migrate-database.test.js`; `test/migration-evidence.test.js`; `.github/workflows/meeting-api-ci.yml`; `.github/workflows/platform-api-deploy.yml`; `scripts/check-worker-secrets.mjs`; `test/check-worker-secrets.test.js`; `apps/platform-api/DEPLOY.md`; `docs/deployment/DATABASE_AUTHORITY.md`; `package.json`
**Estimated size:** 13 files, 620–900 net LOC.

**What to implement:** Add one runner with `bootstrap`, `apply`, and `verify`. Environment config pins its history variant; the CLI must declare the same variant. Bootstrap requires empty PG17+pgvector and repaired-bootstrap. Apply accepts a complete recognized prefix of either variant and only an exact declared contiguous suffix after an advisory-locked re-read; P0 production additionally allows only `{0018,0019}` or `{0019}`. Verify requires a recognized declared variant, expected floor, and zero pending, emits `NOOP`, and never writes. This contract must support PR A `0020+` on both variants. Add a prerequisite role provisioner: Neon admin is LOGIN/control-plane authority; direct `neondb_owner` (or explicitly approved equivalent) is SQL authority for creating/validating NOLOGIN roles and memberships. Passwords never enter repo/CLI output.

**TDD steps:**

1. Write test: provisioning fixtures cover missing `CREATEROLE`/ADMIN OPTION, missing roles, wrong rolcanlogin, unauthorized/wrong LOGIN membership, idempotent valid roles, and redaction. Runner fixtures cover environment/flag mismatch; both recognized variants applying exact `0020`; mixed/unknown histories; zero-pending verify `NOOP`; apply with undeclared/extra/reordered suffix; wrong floor/hash/count; TOCTOU; P0 production allowlist; non-PG17/no-vector; wrong URL/SHA/snapshot; secret leakage.
2. Run test: `bun test test/provision-database-roles.test.js test/migrate-database.test.js test/migration-evidence.test.js test/check-worker-secrets.test.js`; confirm RED on missing provisioner/runner and current workflow behavior.
3. Implement: add provisioner and three-operation runner; bind environment-to-variant in the authority contract; update workflows/docs/root commands. Keep control-plane key, direct URL, and LOGIN credentials in separate scopes.
4. Run test: focused tests; provision roles; bootstrap repaired history; `verify --history-variant repaired-bootstrap --expected-floor 0019` returns `NOOP`; original/repaired fixtures each apply synthetic `0020` then verify; P0 production fixtures accept only its two sets; concurrency/TOCTOU and unauthorized role cases fail.
5. Commit: `ci(db): enforce canonical Neon migration rollout`.

**Expected output:** either recognized pinned variant can advance beyond `0019` and verify at zero pending; mixed/unknown/mismatched variants fail; roles exist before migration under named authority; logs reveal no credentials.

### Task 8: Rotate to least-privilege runtime roles and prove real-Neon conformance

**Requirement anchor:** success criteria 7–10; current Worker secret value is not externally readable.
**OWNS:** `apps/platform-api/src/db.ts`; `apps/platform-api/src/db.test.ts`; `apps/platform-api/src/app.ts`; `apps/platform-api/src/app.test.ts`; `apps/platform-api/test/db-contract/harness.ts`; `apps/platform-api/test/db-contract/neon-authority.test.ts`; `apps/platform-api/test/db-contract/role-privileges.test.ts`; `apps/platform-api/vitest.db-contract.config.ts`; `apps/platform-api/package.json`; `.github/workflows/db-contract.yml`
**Estimated size:** 10 paths, 420–660 net LOC.

**What to implement:** Define exact grants and separate LOGIN credentials. Create the empty real-Neon proof only by provisioning a disposable test-only project/root with empty `neondb`; validate project ID differs from production, root/default status, test authority/variant, and empty catalog, then delete the entire project in `finally` and prove deletion. Separately use a production-derived branch for original history. On both, provision NOLOGIN roles before `0019`. Rotate pooled secrets away from owner and prove allowed access plus denied DDL/escalation/cross-service access. Add opaque readiness.

**TDD steps:**

1. Write test: reject production project ID, production child claimed empty, non-root test branch, nonempty catalog, missing test-only authority, missing cleanup, and absent/unauthorized NOLOGIN provisioning. Positive path creates disposable project/root, bootstraps repaired history, verifies NOOP, deletes project, and verifies deletion. Original path uses a production-derived branch. Both include allowed/denied runtime privilege probes.
2. Run test: unit tests RED with missing validator/readiness; required real command RED if credentials absent or migration evidence missing.
3. Implement: wire validator/readiness and harness; never return/log URL, role, content, row payload, or query error detail.
4. Run test: `bun run --cwd apps/platform-api lint`; `bun run --cwd apps/platform-api typecheck`; `bun run --cwd apps/platform-api test`; `bun run test:db-contract:required`; confirm disposable-project/root cleanup, production-derived branch isolation, both variants, privilege negatives, and credential rotation evidence.
5. Commit: `test(db): prove Neon authority on ephemeral branch`.

**Expected output:** disposable empty project and production-derived branch prove distinct variants; both provision roles first and support future suffixes; project/branch cleanup and privilege rotation are mandatory evidence.

## Wave 7 — canonical documentation and stack handoff

### Task 9: Replace stale ownership docs and publish PR A's exact interface

**Requirement anchor:** success criteria 1, 10; stage exit context.
**OWNS:** `docs/architecture/schema-domain-ownership.md`; `README.md`; `DESIGN.md`; `docs/INDEX.md`; `docs/work/2026-08-09-neon-db-authority/decisions.md`; `docs/work/2026-08-09-neon-db-authority/plan.md`; `docs/work/2026-08-09-neon-db-authority/tasks.md`
**Estimated size:** 8 files, 180–300 net LOC.

**What to implement:** Make current architecture docs state one Neon/public physical topology and one Drizzle migration plane; retain links to historical Supabase/Alembic evidence. Record implementation decisions, exact applied floor, next revision, commands, active/dead/unverified deployments, rollout evidence, and privacy limits. Amend PR A's plan/task placeholders only through a separate owner/handoff after this issue lands; do not edit another worktree.

**TDD steps:**

1. Write test: require PR A fields for both history variants, exact `0020` apply and verify/no-op commands, production variant pin, pre-0019 NOLOGIN provisioning authority, applied floor, catalog/grant contract, and prohibition on touching the repair.
2. Run test: `bun test test/check-database-authority.test.js test/check-historical-db-artifacts.test.js`; confirm RED naming stale ownership rows/current-state statements or missing handoff fields.
3. Implement: update canonical docs and decision log from verified live evidence; keep historical plans untouched.
4. Run test: `bun run check:database-authority`; `bun run check:historical-db-artifacts`; whole-repo categorized Supabase/Alembic search; full relevant validation; `forge issue show 59efc6dc-07a1-4b31-9942-ba2f1fcac8e1 --json` readback.
5. Commit: `docs(db): publish canonical Neon authority handoff`.

**Expected output:** a new session can recover both-variant apply/verify semantics, disposable-empty topology, role-provisioning authority, and PR A `0020` contract without historical material.

## Final validation and stage exit

After all tasks and reviews:

1. Re-prove Forge lease ownership.
2. Rebase on current main and rerun migration-order checks; update `0019/0020` only if required and rerun everything. Recompute manifest-approved repaired hashes without touching production history.
3. Run authority/history/parity, package DB lint/type/catalog/firewall/rollback, Meeting full validation, Platform API lint/type/test, role-provisioning negatives, digest-pinned PG17+pgvector bootstrap/no-op, disposable Neon project/root cleanup, production-derived branch isolation, both-variant `0020` suffix fixtures, P0 pending fixtures, and workflow/docs alignment.
4. Verify `git diff` changes only the five allowlisted blocks in `0000`/`0004`, modifies no other historical SQL, and contains no DML/data-copy/drop/down-migration SQL.
5. Record Forge stage exit with `summary`, `decisions`, `artifacts`, and `next`.
6. Stop at VALIDATE/SHIP checkpoint. Do not push, deploy, rotate secrets, apply production migrations, open a PR, or begin PR A without the next explicit stage authorization.

## YAGNI audit

Every task maps to an issue acceptance criterion or identified stale path. The `0000`/`0004` five-block repair is the sole historical Drizzle edit; any sixth change stops DEV. No task adds RLS, a second baseline/root, Supabase adapter, automatic external secret deletion, data migration, Roadmap API conversion, or PR A authorization behavior. If any becomes necessary, stop and amend the approved plan.
