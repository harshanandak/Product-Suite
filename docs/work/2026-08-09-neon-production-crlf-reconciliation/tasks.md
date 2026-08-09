# Tasks — Neon production CRLF reconciliation

Execution is sequential and requires fresh human DEV approval. No task may mutate production SQL, schema, data, roles, or `drizzle.__drizzle_migrations`.

## Task 1 — Lock the exact vector in the manifest and checker

**OWNS:** `docs/history/database-migrations/manifest.json`; `scripts/check-historical-db-artifacts.mjs`; `test/check-historical-db-artifacts.test.js`; `test/fixtures/db-history/**`

What to implement: add a versioned `original-production` vector with the 18 plan entries. Resolve each cited blob from the recorded source SHA, generate only the declared LF or CRLF byte form, hash it, and require exact order/cardinality/uniqueness. Do not read mutable working-tree bytes as provenance.

TDD steps:
1. RED: add happy-path and table-driven mutations for hash, blob OID, source SHA, line ending, tag, filename, order, duplicate, missing, and extra entries.
2. Run `bun test test/check-historical-db-artifacts.test.js`; expect the new valid-vector assertion to fail before implementation and every mutation to be rejected after it.
3. GREEN: implement the smallest manifest/checker support; no migration SQL edits.
4. Run `bun test test/check-historical-db-artifacts.test.js` and `bun run check:historical-db-artifacts`.
5. Commit `fix(db): lock production migration hash vector`.

Expected output: the exact 18-entry vector validates offline; every altered or mixed vector returns a stable fail-closed code.

## Task 2 — Make parity and runner consume only the validated vector

**OWNS:** `scripts/check-migration-parity.mjs`; `scripts/migrate-database.mjs`; `test/check-migration-parity.test.js`; `test/migrate-database.test.js`

What to implement: retain canonical LF hashes for current/new migration files, but resolve observed production raw hashes to tags only through the validated manifest vector. Compare count, order, tag, timestamp, and hash; never accept arbitrary LF/CRLF combinations.

TDD steps:
1. RED: add the exact 18-row production journal fixture plus unknown, mixed, partial, duplicate, reordered, bad timestamp, wrong floor, and extra-row cases.
2. Run `bun test test/check-migration-parity.test.js test/migrate-database.test.js`; expect the exact production vector to fail with the current unknown-hash behavior.
3. GREEN: add the minimal validated lookup seam and preserve all existing environment/history pins and repaired-bootstrap paths.
4. Run `bun test test/check-migration-parity.test.js test/migrate-database.test.js` and `bun run check:migration-parity`.
5. Commit `fix(db): recognize proven production migration history`.

Expected output: verify/planning recognizes exactly `0000`-`0017`; malformed histories reject before any transaction or DDL.

## Task 3 — Validate offline and obtain independent review

**OWNS:** no production/database files; review may request corrections only in Tasks 1-2 ownership.

What to implement: none. Rebase onto fresh `origin/main`, repeat the focused suites and full DB-contract/security checks required for a Critical change, and have one independent reviewer verify all 18 hash/blob/source mappings and the no-write boundary. Batch findings into at most one correction SHA.

TDD/validation steps:
1. Run `bun test test/check-historical-db-artifacts.test.js test/check-migration-parity.test.js test/migrate-database.test.js test/migration-evidence.test.js`.
2. Run `bun run check:historical-db-artifacts`, `bun run check:migration-parity`, and the repository's frozen full DB Contract/security commands.
3. Mutation-check each downgrade/accept branch; require all altered vectors to fail.
4. Independent reviewer compares manifest entries to `git cat-file` bytes at the exact source SHAs and confirms no SQL/history mutation in the diff.
5. Commit one correction only if required.

Expected output: all offline gates and independent review are green on one exact head SHA.

## Task 4 — Repeat protected read-only production preflight

**OWNS:** no repository or database mutations; evidence artifact only in the protected workflow.

What to implement: none. After exact-main merge and explicit human approval, run the existing protected preflight with the restricted Neon migration credential. It must perform only the ordered journal read and validation.

Steps:
1. Verify exact deployed/main SHA, protected environment approval, expected count `18`, floor `0017`, and `original-production` pin.
2. Run the read-only preflight once; require all 18 hashes to match the manifest in order and emit redacted evidence.
3. Stop on any plan STOP condition. Do not invoke `apply`, edit journal rows, or continue to later migrations under this issue.
4. Record the exact SHA, workflow/run ID, count/floor, and terminal result on the Forge issue.

Expected output: terminal PASS recognizing the exact original-production vector, or a fail-closed STOP with no database mutation.
