# PR3 Schema And Domain Inventory Tasks

Date: 2026-04-24
Issue: `product-suite-waq`

## Baseline Note
The current repo-wide baseline is already red in unrelated suites.

Observed pre-existing failures during planning:
- roadmap E2E tests require missing Supabase environment configuration
- roadmap Playwright suites are not runnable through a plain `bun test` baseline
- meeting-web test environment has existing DOM and Vitest helper mismatches

Because of that, PR3 `/dev` should use targeted validation for the new inventory guard instead of assuming the full repo baseline is green.

## Task 1: Create The Durable Inventory Skeleton
File(s):
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

OWNS:
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

What to implement:
- Add the canonical inventory document skeleton with:
  - purpose
  - ownership matrix
  - source-of-truth columns
  - overlap notes
  - non-goals
- Add a targeted root test that fails until the inventory doc exists and contains the required structural headings.

TDD steps:
1. Write test: `test/domain-inventory.test.js` asserts the inventory doc exists and contains headings for ownership matrix, overlap notes, and non-goals.
2. Run test: confirm it fails because the inventory doc does not exist yet.
3. Implement: create `docs/architecture/schema-domain-ownership.md` with the required headings and empty matrix scaffold.
4. Run test: confirm the targeted test passes.
5. Commit: `test: add domain inventory doc guard`

Expected output:
- `bun test test/domain-inventory.test.js` passes with a new inventory scaffold in place.

## Task 2: Document Roadmap Canonical Domains
File(s):
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

OWNS:
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

What to implement:
- Fill in roadmap-owned entities and domain-local tables.
- Capture roadmap as the canonical owner for:
  - `team`
  - `workspace`
  - `thread`
  - `task`
- Record the source-of-truth schema paths for roadmap SQL migrations and generated Supabase types.

TDD steps:
1. Write test: extend `test/domain-inventory.test.js` to require roadmap rows for `team`, `workspace`, `thread`, and `task` with owner and schema-path fields.
2. Run test: confirm it fails until the rows are populated.
3. Implement: populate the roadmap ownership rows and roadmap-local domain notes.
4. Run test: confirm the targeted test passes.
5. Commit: `docs: add roadmap domain ownership inventory`

Expected output:
- The inventory clearly shows roadmap as the canonical owner for team/workspace/thread/task state.

## Task 3: Document Meeting API Canonical Domains And Migration Drift
File(s):
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

OWNS:
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

What to implement:
- Fill in meeting-api-owned entities and domain-local tables.
- Capture meeting-api as the canonical owner for `meeting`.
- Record that meeting transcript/summary/job artifacts are meeting-api owned.
- Explicitly document the migration drift between:
  - `apps/meeting-api/backend/migrations/0001_initial.sql`
  - `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py`

TDD steps:
1. Write test: extend `test/domain-inventory.test.js` to require the `meeting` row, the meeting-api artifact notes, and an explicit migration-drift note.
2. Run test: confirm it fails until those sections are written.
3. Implement: populate the meeting-api ownership rows and migration-path note.
4. Run test: confirm the targeted test passes.
5. Commit: `docs: add meeting-api ownership inventory`

Expected output:
- The inventory clearly shows meeting-api as the meeting system of record and preserves the migration drift warning.

## Task 4: Resolve Shared-Entity Collisions Without Fake Unification
File(s):
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

OWNS:
- `docs/architecture/schema-domain-ownership.md`
- `test/domain-inventory.test.js`

What to implement:
- Add explicit overlap rules for:
  - roadmap `chat_threads` and `chat_messages`
  - meeting-api meeting-scoped `chat_messages`
  - duplicated `users` concepts
  - split artifact ownership between planning/canvas artifacts and meeting artifacts
- State what remains domain-local versus what can later become shared contracts.

TDD steps:
1. Write test: extend `test/domain-inventory.test.js` to require overlap notes for `users`, chat semantics, and split artifact ownership.
2. Run test: confirm it fails until the overlap rules are present.
3. Implement: add the collision-resolution section and future-boundary notes.
4. Run test: confirm the targeted test passes.
5. Commit: `docs: record shared-domain boundary rules`

Expected output:
- Later PRs can tell which overlaps are true conflicts and which are intentionally distinct concepts.

## Task 5: Make The Inventory Discoverable
File(s):
- `README.md`
- `docs/deployment/SERVICE_INVENTORY.md`
- `test/domain-inventory.test.js`

OWNS:
- `README.md`
- `docs/deployment/SERVICE_INVENTORY.md`
- `test/domain-inventory.test.js`

What to implement:
- Link the inventory doc from root-facing or architecture-facing docs so later PRs can find it without prior chat context.
- Extend the targeted test to verify at least one durable discoverability link exists.

TDD steps:
1. Write test: extend `test/domain-inventory.test.js` to require the inventory doc link from `README.md` or `docs/deployment/SERVICE_INVENTORY.md`.
2. Run test: confirm it fails until the link is added.
3. Implement: add the discoverability links.
4. Run test: confirm the targeted test passes.
5. Commit: `docs: link schema domain inventory`

Expected output:
- The ownership inventory is reachable from durable repo docs and protected by a targeted root test.

## YAGNI Check
Every task maps directly to the PR3 success criteria:
- inventory doc exists
- required shared entities are mapped
- source-of-truth schema paths are recorded
- collisions and drift are documented
- later PRs can find the inventory without chat history

No extra product or runtime behavior changes are included in this task list.
