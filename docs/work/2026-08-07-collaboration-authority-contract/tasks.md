# Collaboration authority contract - TDD task list

Issue: `2086343b-db19-4b13-a50f-c5e36c213b20`
Plan: [`plan.md`](./plan.md)
Execution: sequential waves; no same-wave file overlap.

### Wave 1 - Contract lock

## Task 1: Extend the canonical conversation contract and fixtures

**Requirement anchor:** Success criteria 1, 5, 6, and 7.
**File(s):** `packages/contracts/src/conversation.js`, `packages/contracts/contracts/conversation.json`, `packages/contracts/src/index.js`, `packages/contracts/src/index.d.ts`, `packages/contracts/src/conversation.test.ts`
**OWNS:** `packages/contracts/src/conversation.js`, `packages/contracts/contracts/conversation.json`, `packages/contracts/src/index.js`, `packages/contracts/src/index.d.ts`, `packages/contracts/src/conversation.test.ts`

**What to implement:** Extend the existing `conversationContract` with Actor, Conversation, Membership, ConversationEvent, DomainReference, enum values, required/optional fields, sequence cursor, idempotency conflict semantics, and ACL operation matrix. Keep the existing export name. Add independent JS/JSON/TypeScript drift assertions and conformance fixtures for create/edit/delete/reply and owning-domain references.

**TDD steps:**

1. Write test: in `packages/contracts/src/conversation.test.ts`, assert the expanded JS object equals the JSON artifact and that `.d.ts` enums/field sets match independently; assert agent actors and run references are distinct IDs.
2. Run test: `bun test packages/contracts/src/conversation.test.ts`; confirm RED because Actor/Conversation/Membership/ConversationEvent fields are absent.
3. Implement: extend the five owned files only; do not add a package or dependency.
4. Run test: `bun test packages/contracts/src/conversation.test.ts`; confirm all collaboration contract fixtures pass.
5. Commit: `feat(contracts): define collaboration authority contract`

**Expected output:** One provider-neutral contract with no second conversation vocabulary.

### Wave 2 - Additive database authority

## Task 2: Add tenant-safe collaboration tables and compatibility link

**Requirement anchor:** Success criteria 2, 3, 4, and 5; migration strategy 2.
**File(s):** `packages/db/src/schema.ts`, `packages/db/src/schema.test.ts`, `packages/db/migrations/0018_collaboration_fabric.sql`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/index.ts`
**OWNS:** `packages/db/src/schema.ts`, `packages/db/src/schema.test.ts`, `packages/db/migrations/0018_collaboration_fabric.sql`, `packages/db/migrations/meta/_journal.json`, `packages/db/src/index.ts`

**What to implement:** Add Drizzle definitions and one additive migration for `collaboration_actors`, `conversations`, `conversation_memberships`, and `conversation_events`, including composite tenant keys/FKs, enum/check constraints, immutable event trigger/guard, unique sequence/idempotency indexes, target/reply same-conversation integrity, bounded payload/reference checks, and nullable `agent_runs.conversation_id`. Keep `chat_threads` and `thread_id`. Before RED, live-check `_journal.json`; if `0018` is occupied, rename the migration and journal entry to the next contiguous index and record the decision.

**TDD steps:**

1. Write test: in `packages/db/src/schema.test.ts`, assert exact columns, enum values, composite unique/FK/index definitions, immutable event protection, and the nullable run link; assert legacy tables/columns still exist.
2. Run test: `bun run --cwd packages/db test`; confirm RED because collaboration tables are absent.
3. Implement: add the schema, migration, journal entry, and exports with no destructive SQL.
4. Run test: `bun run --cwd packages/db test && bun run --cwd packages/db typecheck && bun run check:migration-parity`; confirm GREEN.
5. Commit: `feat(db): add collaboration authority schema`

**Expected output:** Additive shared-Postgres authority whose constraints cannot join cross-tenant actors, memberships, conversations, or events.

### Wave 3 - Fail-closed repository

## Task 3: Resolve stable actors and enforce membership ACL

**Requirement anchor:** Success criteria 2 and 3; actor lifecycle edge cases.
**File(s):** `apps/platform-api/src/collaboration/repository.ts`, `apps/platform-api/src/collaboration/repository.test.ts`, `apps/platform-api/src/auth/tenant-scope.ts`, `apps/platform-api/src/auth/tenant-scope.test.ts`
**OWNS:** `apps/platform-api/src/collaboration/repository.ts`, `apps/platform-api/src/collaboration/repository.test.ts`, `apps/platform-api/src/auth/tenant-scope.ts`, `apps/platform-api/src/auth/tenant-scope.test.ts`

**What to implement:** Add repository functions that resolve a verified caller context to one active stable actor, create/disable actors idempotently by owning reference, and authorize reads/appends/admin membership changes against active tenant and conversation membership. Human resolution reuses internal `users.id`; agent/service resolution accepts only verified server context. No request value can select the author actor.

**TDD steps:**

1. Write test: cover human, agent, and service resolution; missing mapping; disabled actor; removed membership; ambiguous tenant; role matrix; and cross-tenant IDs.
2. Run test: `bun run --cwd apps/platform-api test -- src/collaboration/repository.test.ts src/auth/tenant-scope.test.ts`; confirm RED because the collaboration repository does not exist.
3. Implement: add the smallest tenant-scoped repository and extend the existing auth resolver only where stable actor derivation requires it.
4. Run test: rerun the focused command; confirm all deny-first cases pass.
5. Commit: `feat(api): enforce collaboration actor membership`

**Expected output:** Every collaboration operation has one reusable fail-closed authorization path.

## Task 4: Append ordered idempotent events

**Requirement anchor:** Success criteria 4-7; ordering, duplicate, edit/delete/reply edge cases.
**File(s):** `apps/platform-api/src/collaboration/repository.ts`, `apps/platform-api/src/collaboration/repository.test.ts`
**OWNS:** `apps/platform-api/src/collaboration/repository.ts`, `apps/platform-api/src/collaboration/repository.test.ts`

**What to implement:** Add transactional append and cursor-read functions. Append must authorize, compare an existing idempotency key semantically, validate target/reply membership in the same conversation, allocate sequence by atomic conversation-row update, insert once, and return a stable conflict/result union. Reads use exclusive `afterSequence` and ascending sequence. Edits/deletes are append-only and owning-domain references remain opaque.

**TDD steps:**

1. Write test: identical retries converge; changed retry conflicts; two concurrent appends receive ordered unique sequences; reconnect resumes exclusively; archived/unauthorized/disabled writes fail; edit/delete/reply target checks fail without mutation.
2. Run test: `bun run --cwd apps/platform-api test -- src/collaboration/repository.test.ts`; confirm RED on missing append/read behavior.
3. Implement: add the transaction using existing SQL primitives; add no queue, lock service, or dependency.
4. Run test: rerun focused tests, then `bun run --cwd apps/platform-api typecheck`; confirm GREEN.
5. Commit: `feat(api): append collaboration events exactly once`

**Expected output:** An immutable, replayable event stream ordered independently of delivery time.

### Wave 4 - Canonical API and compatibility

## Task 5: Expose canonical conversation endpoints

**Requirement anchor:** Success criteria 3-7; migration strategy 5.
**File(s):** `apps/platform-api/src/routes/conversations.ts`, `apps/platform-api/src/routes/conversations.test.ts`, `apps/platform-api/src/app.ts`
**OWNS:** `apps/platform-api/src/routes/conversations.ts`, `apps/platform-api/src/routes/conversations.test.ts`, `apps/platform-api/src/app.ts`

**What to implement:** Register `/api/conversations` endpoints for list/get, event cursor read, event append, and admin membership mutation. Validate bodies/cursors with installed Zod, derive actors from auth context, preserve the repository result union, and use `404` for foreign resources. Do not add websocket, presence, UI, vendor, or RTC code.

**TDD steps:**

1. Write test: assert auth registration, input validation, exclusive cursor behavior, status mapping, actor spoof rejection, foreign-ID invisibility, and reference round trips.
2. Run test: `bun run --cwd apps/platform-api test -- src/routes/conversations.test.ts`; confirm RED because routes are absent.
3. Implement: add the route and one app registration line.
4. Run test: rerun the focused test, `bun run --cwd apps/platform-api typecheck`, and `bun run --cwd apps/platform-api lint`; confirm GREEN.
5. Commit: `feat(api): expose collaboration conversations`

**Expected output:** A transport-neutral authenticated API over the canonical repository.

## Task 6: Backfill platform threads and keep the legacy route stable

**Requirement anchor:** Success criterion 8; migration strategy 3-5.
**File(s):** `apps/platform-api/src/collaboration/backfill.ts`, `apps/platform-api/src/collaboration/backfill.test.ts`, `apps/platform-api/src/agent/threads-repository.ts`, `apps/platform-api/src/agent/threads-repository.test.ts`, `apps/platform-api/src/routes/agent-threads.ts`, `apps/platform-api/src/routes/agent-threads.test.ts`, `apps/platform-api/src/agent/runtime.ts`, `apps/platform-api/src/agent/runtime.test.ts`
**OWNS:** `apps/platform-api/src/collaboration/backfill.ts`, `apps/platform-api/src/collaboration/backfill.test.ts`, `apps/platform-api/src/agent/threads-repository.ts`, `apps/platform-api/src/agent/threads-repository.test.ts`, `apps/platform-api/src/routes/agent-threads.ts`, `apps/platform-api/src/routes/agent-threads.test.ts`, `apps/platform-api/src/agent/runtime.ts`, `apps/platform-api/src/agent/runtime.test.ts`

**What to implement:** Add an idempotent dry-run/apply backfill for platform Neon threads only, reusing UUIDs, deriving actors/memberships conservatively, converting v1 transcript deltas with deterministic keys, and reporting unresolved rows without granting access. Delegate the stable legacy thread route to canonical conversation reads and link new agent runs through `conversation_id`; preserve run transcripts and `thread_id` during compatibility. Do not touch roadmap, meeting, canvas, workboard, or vendor code.

**TDD steps:**

1. Write test: dry-run is read-only; two apply runs converge; v0 rows skip; v1 order/IDs/references are deterministic; unresolved users have no membership; legacy route response remains unchanged; runtime links run and conversation without moving run state.
2. Run test: `bun run --cwd apps/platform-api test -- src/collaboration/backfill.test.ts src/agent/threads-repository.test.ts src/routes/agent-threads.test.ts src/agent/runtime.test.ts`; confirm RED on missing compatibility behavior.
3. Implement: add the bounded backfill and delegation; do not delete legacy rows or add cross-database access.
4. Run test: rerun the focused tests and platform API typecheck/lint; confirm GREEN.
5. Commit: `feat(api): bridge legacy threads to collaboration fabric`

**Expected output:** Platform chat uses the new authority without breaking its current route or deleting rollback data.

### Wave 5 - Conformance gate

## Task 7: Lock database-backed collaboration conformance

**Requirement anchor:** Success criteria 3-8.
**File(s):** `apps/platform-api/test/db-contract/collaboration.test.ts`
**OWNS:** `apps/platform-api/test/db-contract/collaboration.test.ts`

**What to implement:** Add a real-database contract test using the existing harness for composite tenant constraints, active membership ACL, concurrent append/idempotency, reconnect ordering, immutable edits/deletes, actor disable, owning-reference persistence, and backfill convergence. Tests must use isolated tenant/conversation IDs and clean only their own rows.

**TDD steps:**

1. Write test: implement the conformance cases against the expected schema/API and confirm RED before the complete implementation is present.
2. Run test: `bun run --cwd apps/platform-api test -- test/db-contract/collaboration.test.ts`; confirm the documented missing schema/behavior failure.
3. Implement: adjust only the test/harness use required to exercise already-built behavior; fix production defects in the owning earlier task, never weaken assertions.
4. Run test: run the focused DB contract, package tests/typechecks/lints, `bun run check:migration-parity`, then the repository-supported full suite.
5. Commit: `test(api): lock collaboration conformance`

**Expected output:** Runnable proof that duplicate delivery, ordering, ACL, lifecycle, references, and compatibility fail closed on real Postgres.

## YAGNI review

Every task maps directly to a success criterion or migration edge case. No unanchored tasks remain. Search, reactions, attachments, notifications, presence transport, RTC/realtime vendor work, UI projection work, cross-database cutover, generic event-bus infrastructure, and legacy deletion are deliberately absent.

## `/dev` entry checkpoint

- Re-prove Forge ownership under the implementation actor.
- Confirm `gate.plan-approval` is approved by a human; this PLAN stage does not approve it.
- Rebase/sync the isolated worktree and re-read the live migration journal before assigning the migration number.
- Execute waves sequentially. No task may edit a file owned by another parallel Wave 1 issue.
