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

**What to implement:** Add a machine-readable contract that names Neon, `neondb`, `public`, active services, canonical Drizzle root/journal/commands, runtime pooled purpose, migration direct purpose, and historical roots. Add a pure validator/CLI that structurally parses URLs and validates scheme, exact `.neon.tech` hostname suffix, database, TLS, pooled/direct purpose, configured project/branch evidence, and absence of dual production DB settings. Export pure functions for tests. Never print or return a full URL, user, password, or query string.

**TDD steps:**

1. Write test: in `test/check-database-authority.test.js`, cover valid pooled runtime/direct migration Neon URLs; reject Supabase, lookalike hosts (`neon.tech.evil.example`), wrong database, non-TLS hosted URL, pooled migration URL, direct runtime when policy requires pooled, provider/host mismatch, two production URLs, and redacted errors.
2. Run test: `bun test test/check-database-authority.test.js`; confirm RED with `Cannot find module '../scripts/check-database-authority.mjs'`.
3. Implement: add contract, parser, validator, CLI, and root `check:database-authority` script. CLI reads secrets only from environment and emits provider/purpose/status/project/branch IDs, never values.
4. Run test: confirm all validator cases pass; run the CLI with synthetic Neon values and confirm no credential fragments appear.
5. Commit: `feat(db): freeze canonical Neon authority contract`.

**Expected output:** `Database authority check passed: provider=neon schema=public migration=drizzle` for valid config; deterministic redacted errors and nonzero exit for every invalid/dual config.

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

**What to implement:** Model the full current schema, generate normal `0019` from the real `0011` snapshot, and retain the complete new snapshot. Rewrite only new SQL into transactional additive DDL. Every creation guard is followed by exact catalog assertions for relation kind; column type/typmod/collation/null/default/identity/generated; enum order; constraint definition/FK actions; and index method/keys/opclass/include/predicate. Add the five deferred FKs and exact service grants/default privileges. Mismatch raises and rolls back; no `0019` journal row remains. A token-aware firewall bans `INSERT/UPDATE/DELETE/MERGE/COPY/TRUNCATE` plus destructive DDL in authored repair/0019 SQL.

**TDD steps:**

1. Write test: exact catalog fixtures cover types/null/defaults/enums/index predicates/opclasses/FK actions; inject one incompatibility per category and assert SQLSTATE/error object plus full transactional rollback. Firewall fixtures cover comments/strings/dollar quotes and ban `INSERT|UPDATE|DELETE|MERGE|COPY|TRUNCATE` tokens in executable SQL.
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
**OWNS:** `scripts/migrate-database.mjs`; `scripts/migration-evidence.mjs`; `test/migrate-database.test.js`; `test/migration-evidence.test.js`; `.github/workflows/meeting-api-ci.yml`; `.github/workflows/platform-api-deploy.yml`; `scripts/check-worker-secrets.mjs`; `test/check-worker-secrets.test.js`; `apps/platform-api/DEPLOY.md`; `docs/deployment/DATABASE_AUTHORITY.md`; `package.json`
**Estimated size:** 11 files, 500–780 net LOC.

**What to implement:** Add one canonical runner with `bootstrap` and `deploy` modes. Bootstrap requires a truly empty digest-pinned PostgreSQL 17 + pgvector target and the repaired history variant. Deploy requires original production history, acquires a fixed advisory lock, re-reads history in the apply session, and accepts exactly ordered `{0018,0019}` or `{0019}` with expected tags/timestamps/hashes/count. Platform deploy additionally requires a ready, test-restored Neon snapshot at exact LSN/timestamp whose expiry exceeds P0 acceptance plus PR A contingency. Preserve direct migration versus pooled runtime URLs and exact-SHA approval.

**TDD steps:**

1. Write test: runner fixtures reject dirty nonempty bootstrap; non-PG17/no-vector; repaired/mixed deploy prefix; original-prefix bootstrap; pending `{}`, `{0018}`, `{0017,0018,0019}`, reordered/unknown/extra sets; wrong ordered hash/count; TOCTOU mutation after preflight; pooled/non-Neon migration URL; stale SHA; insufficient/expired/unrestored snapshot; secret leakage.
2. Run test: `bun test test/migrate-database.test.js test/migration-evidence.test.js test/check-worker-secrets.test.js`; confirm RED on missing runner and current workflow behavior.
3. Implement: update workflows/scripts/docs/root commands. Keep `NEON_API_KEY` scoped only to branch/control-plane steps and direct URL scoped only to migrate/pre/postflight.
4. Run test: focused tests; `bun run migrate:database --mode bootstrap` against pinned pgvector/PostgreSQL 17; second-run no-op; deploy-mode production fixture for both accepted sets; concurrency/TOCTOU rejection; YAML/static tests and redaction snapshot.
5. Commit: `ci(db): enforce canonical Neon migration rollout`.

**Expected output:** empty and existing-live paths are independently proven; deploy applies only the exact allowed suffix under lock; restore evidence is retained and sufficient; logs reveal no credentials.

### Task 8: Rotate to least-privilege runtime roles and prove real-Neon conformance

**Requirement anchor:** success criteria 7–10; current Worker secret value is not externally readable.
**OWNS:** `apps/platform-api/src/db.ts`; `apps/platform-api/src/db.test.ts`; `apps/platform-api/src/app.ts`; `apps/platform-api/src/app.test.ts`; `apps/platform-api/test/db-contract/harness.ts`; `apps/platform-api/test/db-contract/neon-authority.test.ts`; `apps/platform-api/test/db-contract/role-privileges.test.ts`; `apps/platform-api/vitest.db-contract.config.ts`; `apps/platform-api/package.json`; `.github/workflows/db-contract.yml`
**Estimated size:** 10 paths, 420–660 net LOC.

**What to implement:** Define exact Platform and Meeting grant manifests, NOLOGIN group roles and separate LOGIN credentials. `0019` revokes public schema creation, grants enumerated tables/sequences, and sets owner default privileges; login passwords remain out-of-band. Deploy rotates pooled secrets away from observed `neondb_owner`, validates `current_user` is not owner/admin, proves allowed queries and denies create/alter/drop, role escalation, and unlisted cross-service access, then invalidates the superseded runtime owner credential when distinct from migration secret. Add opaque DB readiness. Real Neon runs both empty bootstrap and production-derived deploy proofs and cleans up in `finally`.

**TDD steps:**

1. Write test: unit readiness/redaction plus real DB allowed CRUD/readiness and denied DDL/ownership/role membership/cross-service access; assert old owner runtime URL is rejected. Cover empty repaired history, live original history, both allowed pending sets, exact catalog, unchanged rows/Alembic marker, incompatibility rollback, and branch cleanup.
2. Run test: unit tests RED with missing validator/readiness; required real command RED if credentials absent or migration evidence missing.
3. Implement: wire validator/readiness and harness; never return/log URL, role, content, row payload, or query error detail.
4. Run test: `bun run --cwd apps/platform-api lint`; `bun run --cwd apps/platform-api typecheck`; `bun run --cwd apps/platform-api test`; `bun run test:db-contract:required`; confirm both branch modes, privilege negatives, parent immutability, credential rotation evidence, and cleanup.
5. Commit: `test(db): prove Neon authority on ephemeral branch`.

**Expected output:** runtime authenticates as non-owner least-privilege roles; required calls pass and forbidden capabilities fail; both migration histories converge; missing proof/cleanup/rotation is nonzero.

## Wave 7 — canonical documentation and stack handoff

### Task 9: Replace stale ownership docs and publish PR A's exact interface

**Requirement anchor:** success criteria 1, 10; stage exit context.
**OWNS:** `docs/architecture/schema-domain-ownership.md`; `README.md`; `DESIGN.md`; `docs/INDEX.md`; `docs/work/2026-08-09-neon-db-authority/decisions.md`; `docs/work/2026-08-09-neon-db-authority/plan.md`; `docs/work/2026-08-09-neon-db-authority/tasks.md`
**Estimated size:** 8 files, 180–300 net LOC.

**What to implement:** Make current architecture docs state one Neon/public physical topology and one Drizzle migration plane; retain links to historical Supabase/Alembic evidence. Record implementation decisions, exact applied floor, next revision, commands, active/dead/unverified deployments, rollout evidence, and privacy limits. Amend PR A's plan/task placeholders only through a separate owner/handoff after this issue lands; do not edit another worktree.

**TDD steps:**

1. Write test: extend authority/docs alignment assertions so current-state docs cannot say Supabase Postgres is source of truth, Meeting is moving to Supabase, or Alembic owns new migrations. Require PR A fields for original-production history variant, guarded deploy command, applied `0019` floor, candidate `0020`, exact catalog/grant contract, and prohibition on touching the five-block repair.
2. Run test: `bun test test/check-database-authority.test.js test/check-historical-db-artifacts.test.js`; confirm RED naming stale ownership rows/current-state statements or missing handoff fields.
3. Implement: update canonical docs and decision log from verified live evidence; keep historical plans untouched.
4. Run test: `bun run check:database-authority`; `bun run check:historical-db-artifacts`; whole-repo categorized Supabase/Alembic search; full relevant validation; `forge issue show 59efc6dc-07a1-4b31-9942-ba2f1fcac8e1 --json` readback.
5. Commit: `docs(db): publish canonical Neon authority handoff`.

**Expected output:** a new session can recover provider/schema/model/root/journal/generate/guarded-apply/runtime-role/history-variant/applied-floor/next-slot facts without reading historical PR19/PR20 material.

## Final validation and stage exit

After all tasks and reviews:

1. Re-prove Forge lease ownership.
2. Rebase on current main and rerun migration-order checks; update `0019/0020` only if required and rerun everything. Recompute manifest-approved repaired hashes without touching production history.
3. Run authority/history/parity, package DB lint/type/catalog/firewall/rollback, Meeting full validation, Platform API lint/type/test, digest-pinned PG17+pgvector bootstrap, both required ephemeral Neon modes, least-privilege negatives, apply-time pending fixtures, and workflow/docs alignment.
4. Verify `git diff` changes only the five allowlisted blocks in `0000`/`0004`, modifies no other historical SQL, and contains no DML/data-copy/drop/down-migration SQL.
5. Record Forge stage exit with `summary`, `decisions`, `artifacts`, and `next`.
6. Stop at VALIDATE/SHIP checkpoint. Do not push, deploy, rotate secrets, apply production migrations, open a PR, or begin PR A without the next explicit stage authorization.

## YAGNI audit

Every task maps to an issue acceptance criterion or identified stale path. The `0000`/`0004` five-block repair is the sole historical Drizzle edit; any sixth change stops DEV. No task adds RLS, a second baseline/root, Supabase adapter, automatic external secret deletion, data migration, Roadmap API conversion, or PR A authorization behavior. If any becomes necessary, stop and amend the approved plan.
