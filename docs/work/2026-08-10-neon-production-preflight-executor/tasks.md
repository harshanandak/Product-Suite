# Tasks: protected Neon production preflight executor

**Issue:** `544a6a1c-6b21-4776-8e2d-493d4e885190`
**Plan:** `docs/work/2026-08-10-neon-production-preflight-executor/plan.md`
**Execution:** sequential waves; no production call; stop after validated implementation until separate dispatch approval.

## Wave 1 — Canonical read-only verifier and evidence

### Task 1: Make canonical `verify` produce fail-closed preflight evidence

**OWNS:** `config/neon-production-preflight-grants.json`; `scripts/migrate-database.mjs`; `scripts/migration-evidence.mjs`; `test/migrate-database.test.js`; `test/migration-evidence.test.js`

**Files:** same as `OWNS`.

**What to implement:** Define the named `product-suite-neon-preflight-reader-v1` grant contract and extend only the canonical `verify` path. Pin the signed attestation's approved LOGIN identifier and grant digest; reject owner/apply/other LOGINs and mismatches. Evaluate `has_schema_privilege`, `has_table_privilege`, and `has_sequence_privilege` negatives for every ledger/migration table/sequence across direct, transitive inherited, `PUBLIC`, PostgreSQL built-in/default-role, and default-ACL paths; require all autocommit and transaction `INSERT`/`UPDATE`/`DELETE`/DDL/`nextval` denial probes to fail safely. Then verify the history, target, recovery, catalog/grants, and row-count contract and emit the catalog/grant/role digests in deny-by-default evidence. Preserve floor `0019` zero-pending `NOOP`; do not add arbitrary SQL/operation input, provisioning, apply/bootstrap, successful DDL/DML, Neon mutation, or secret-bearing fields.

**TDD steps:**

1. Write tests that spy every adapter call and assert the happy path verifies the pinned LOGIN/grant digest, enumerates all direct/inherited/`PUBLIC`/default-ACL paths, performs the explicit privilege functions and safe denial probes, returns `PREFLIGHT_READY` for count `18`/floor `0017`/pending `0018,0019`, binds the catalog/grant digest, and preserves `NOOP` at floor `0019`.
2. Run `bun test test/migrate-database.test.js test/migration-evidence.test.js`; confirm RED because preflight evidence/identity/privilege/catalog/count contracts do not exist.
3. Add adversarial tests for owner/apply/other LOGIN, role/grant digest mismatch, admin/schema-CREATE/temporary authority, table write privilege, sequence `USAGE`/`UPDATE`/`SELECT`, inherited/`PUBLIC`/default-ACL write paths, and successful autocommit or transaction `INSERT`/`UPDATE`/`DELETE`/DDL/`nextval`. Also cover unknown history, identity/recovery, catalog/count, driver-secret, and evidence-redaction failures. Every case must fail with a stable code; deny probes must never target business rows.
4. Implement the smallest pure validators and `verify` orchestration. Keep `applyMigrations`, `bootstrapMigrations`, and role provisioning unchanged. Ensure the CLI writes a validated artifact on PASS and a redacted structured failure when possible without printing secrets.
5. Run the focused tests and confirm PASS; inspect the query spy and serialized fixture to prove no mutating SQL or secret-bearing field.
6. Commit with the later single implementation commit only after all tasks pass: `feat(db): add protected Neon preflight executor`.

**Expected output:** the fixed canonical command returns nonzero on ambiguity; on the approved fixture it emits one schema-valid redacted `PREFLIGHT_READY` artifact bound to exact inputs, and no test observes a database mutation.

## Wave 2 — Isolated protected workflow

### Task 2: Add a workflow that can execute only the canonical verify command

**OWNS:** `config/neon-production-preflight-attestation.schema.json`; `config/neon-production-preflight-attestation.json`; `config/neon-production-preflight-trust.json`; `.github/workflows/neon-production-preflight.yml`; `test/neon-production-preflight-workflow.test.js`; `package.json`

**Files:** same as `OWNS`.

**What to implement:** Define the exact signed attestation JSON Schema, repository-pinned Ed25519 trust key, and checked-in immutable attestation sourced from a control-plane export or independently signed export. It must bind exact project/production-branch/endpoint/`neondb`/`public`, pinned LOGIN/grant digest, recovery kind/ID/source branch, source hash/time, validity window, canonical payload hash, key ID, and signature. Add the dedicated workflow and validate schema, signature, source hash, freshness, Git blob ID/file SHA-256, and exact run SHA before secrets are in scope. Then run the one fixed verify command with only the read-only secret and upload the bound artifact. Operator-entered ID shape alone is forbidden.

**TDD steps:**

1. Write a structural workflow test that first fails because the files are absent. Assert the full trigger/SHA/permission/secret/command boundary plus schema, trust key, canonical payload hash/signature, source hash, freshness, Git blob/file digest, exact run-SHA binding, and complete project/production-branch/endpoint/database/schema/role/grant/recovery fields.
2. Add mutation cases for absent/stale/forged/unsigned/untrusted-key attestations, shape-only operator IDs, source/blob/file/run-SHA mismatch, and every target/role/grant/recovery mismatch. Also retain dangerous-command, broad-permission, secret-scope, trigger, dependency, action-pin, and lifecycle-script mutations.
3. Run `bun test test/neon-production-preflight-workflow.test.js`; confirm RED with the expected missing-contract failure.
4. Implement the minimal workflow and add the focused test to `test:repo-tooling`. Do not edit `platform-api-deploy.yml`.
5. Run the focused test and `bun run test:repo-tooling`; confirm PASS.
6. Commit with the single implementation commit named in Task 1 after Task 3 validation.

**Expected output:** repository tooling proves the workflow has one credentialed verify-only path and no syntactic or job-graph route to provision, apply, mutate Neon, or deploy.

## Wave 3 — Operator boundary and complete validation

### Task 3: Document the separate preflight/apply approvals and validate adversarially

**OWNS:** `docs/deployment/DATABASE_AUTHORITY.md`; `apps/platform-api/DEPLOY.md`; `test/neon-authority-handoff.test.js`

**Files:** same as `OWNS`.

**What to implement:** Document the two-environment boundary; pinned LOGIN and named grant-contract digest; all direct/inherited/`PUBLIC`/default-ACL negatives and safe autocommit/transaction denial probes; exact signed repository attestation/control-plane source and recovery schema; SHA/hash/signature/freshness checks; artifact review; and separate apply approval. Prohibit owner/other LOGIN reuse, shape-only identity, or project/branch proof based only on the connection hostname.

**TDD steps:**

1. Extend `test/neon-authority-handoff.test.js` with assertions for the pinned role/grant digest and denial probes, signed attestation schema/source/blob/hash/run-SHA/freshness/recovery contract, exact command, artifact review, and separate apply approval; confirm RED.
2. Write the minimal operator documentation with no live IDs, URLs, credentials, or copied production evidence.
3. Run `bun test test/neon-authority-handoff.test.js`; confirm PASS.
4. Run the full focused set: migration runner/evidence, database authority, historical artifacts, parity, worker-secret boundary, catalog/rollback/firewall, workflow structural tests, handoff test, and repo tooling.
5. Mutation-review the workflow and verifier against every forbidden operation; run a repository search for `MIGRATION_DATABASE_URL`, apply/provision/deploy tokens, permissions, and environment names, and reconcile every hit.
6. Review `git diff --check`, inspect the final diff and changed-file list, confirm no migration SQL/journal/config credential or existing deploy workflow changed, then create the one implementation commit.

**Expected output:** focused and repo-tooling suites are green; documentation makes the human gates executable; diff evidence proves the implementation is isolated and production has not been contacted.

## YAGNI and ownership review

- Task 1 maps to success criteria 3, 5, 6, and 7.
- Task 2 maps to success criteria 1, 2, 4, and 8.
- Task 3 maps to success criterion 9 and the required human/rollback boundary.
- No task creates roles, control-plane resources, recovery branches, migrations, or deployment behavior. Those are explicit human/external prerequisites, not hidden implementation work.
- Waves are sequential. No files overlap between tasks.

## DEV entry and stop gate

DEV may start only after human plan approval and confirmation that the pinned LOGIN can satisfy the exact named grant contract and safe autocommit/transaction denial probes, and that a fresh signed repository attestation with trustworthy control-plane source and recovery reference can be produced. If not, implementation stops rather than weakening write-incapability or target proof. Even after DEV/VALIDATE, do not push, open a PR, configure credentials, or dispatch production without separately authorized workflow stages and human gates.
