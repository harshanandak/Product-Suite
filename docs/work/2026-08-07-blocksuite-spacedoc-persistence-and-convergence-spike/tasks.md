# Tasks: BlockSuite spaceDoc persistence and convergence rejection spike

Status: proposed; task-list approval pending
Issue: `8dfbe355-366a-4518-b377-9f3eccf2745d`

## Wave 1

### Task 1: Pin and prove the exact public package surface

**OWNS:** `apps/roadmap-web/package.json`, `apps/roadmap-web/bun.lock`, `bun.lock`, `apps/roadmap-web/tests/blocksuite-spike/public-api.test.ts`

**File(s):** same as `OWNS`

**What to implement:** Add a Bun test that imports `DocCollection`, `Schema`, and `Text` from
`@blocksuite/store` plus `AffineSchemas` from `@blocksuite/blocks/schemas`, constructs and
loads a minimal Affine document, and asserts the public methods/getters needed by the spike.
The test also reads the Roadmap manifest and asserts all five direct BlockSuite versions are
exactly `0.19.5`. Then replace only those five caret ranges and regenerate both tracked locks.

**TDD steps:**

1. Write test: `public-api.test.ts` imports only published entrypoints, creates a document, and
   rejects every non-exact direct BlockSuite manifest value.
2. Run test: confirm it fails because the current values are `^0.19.5` (or fails at import,
   which is immediate NO-GO evidence).
3. Implement: pin the five values and regenerate locks; do not change Yjs or any other package.
4. Run test: `bun test apps/roadmap-web/tests/blocksuite-spike/public-api.test.ts`.
5. Commit: `test: pin BlockSuite rejection spike to 0.19.5`

**Expected output:** the headless public imports work, document creation/load works, and all five
manifest assertions equal `0.19.5`; otherwise record NO-GO and stop core work.

## Wave 2

### Task 2: Prove spaceDoc persistence and the frozen 0.19.5 fixture

**OWNS:** `apps/roadmap-web/tests/blocksuite-spike/fixture.ts`, `apps/roadmap-web/tests/blocksuite-spike/fixtures/affine-0.19.5-space-doc.base64`, `apps/roadmap-web/tests/blocksuite-spike/fixtures/affine-0.19.5-space-doc.json`, `apps/roadmap-web/tests/blocksuite-spike/persistence.test.ts`

**File(s):** same as `OWNS`

**What to implement:** Add the smallest public-API fixture helpers for deterministic IDs,
semantic snapshots, and Yjs byte exchange. Freeze one synthetic `0.19.5` spaceDoc payload plus
metadata containing its SHA-256, document ID, block IDs, parent-child structure, and text.
Prove a fresh document accepts canonical bytes before `load()` and reconstructs the expected
semantic tree. Do not inspect raw block maps.

**TDD steps:**

1. Write test: restore a placeholder/missing fixture into a same-ID target and assert the exact
   semantic snapshot and SHA-256.
2. Run test: confirm it fails because the fixture/helper does not exist.
3. Implement: generate and check in the synthetic fixture using only public `0.19.5` APIs and
   implement semantic snapshot helpers using public `Doc` queries/models.
4. Run test: `bun test apps/roadmap-web/tests/blocksuite-spike/persistence.test.ts`.
5. Commit: `test: prove BlockSuite spaceDoc persistence`

**Expected output:** exact stable IDs, nesting, and text survive encode/restore and the frozen
fixture hash matches. Any mismatch is NO-GO.

### Task 3: Prove headless semantic two-client convergence

**OWNS:** `apps/roadmap-web/tests/blocksuite-spike/convergence.test.ts`

**File(s):** same as `OWNS`

**What to implement:** Seed two same-ID documents from the Task 2 canonical fixture. Mutate
different existing blocks through `Doc.updateBlock`/`Text` (and one deterministic `addBlock`
where schema-valid), capture state-vector deltas, exchange them in both directions, and compare
semantic snapshots and final encoded state behavior. Apply one delta twice to prove idempotence.

**TDD steps:**

1. Write test: assert client A and B converge after independent semantic mutations and that
   stable IDs/nesting remain intact.
2. Run test: confirm it fails before delta exchange is implemented.
3. Implement: use public BlockSuite mutation APIs and public Yjs state-vector/update functions.
4. Run test: `bun test apps/roadmap-web/tests/blocksuite-spike/convergence.test.ts`.
5. Commit: `test: prove headless BlockSuite convergence`

**Expected output:** both clients have identical semantic snapshots containing both edits with no
duplicate roots/children. Import, mutation, or convergence failure is NO-GO.

## Wave 3

### Task 4: Prove the canonical-load edit lock

**OWNS:** `apps/roadmap-web/tests/blocksuite-spike/canonical-load.ts`, `apps/roadmap-web/tests/blocksuite-spike/canonical-load.test.ts`

**File(s):** same as `OWNS`

**What to implement:** Add a test-only canonical loader that owns a private document until
canonical bytes apply and `Doc.load()` succeeds. It exposes semantic mutation only after that
point. Empty state may run an explicit initializer; malformed state rejects. It must not use a
timer, polling, renderer readiness, or swallowed exception.

**TDD steps:**

1. Write test: hold canonical load with a deferred promise, assert no editable handle exists,
   then resolve and assert mutation becomes available; add malformed-state rejection.
2. Run test: confirm it fails because the loader does not exist.
3. Implement: the minimal promise/phase barrier around public document construction/apply/load.
4. Run test: `bun test apps/roadmap-web/tests/blocksuite-spike/canonical-load.test.ts`.
5. Commit: `test: prove canonical BlockSuite load lock`

**Expected output:** edit access is impossible before successful canonical load and is never
unlocked by time alone. Failure or early exposure is NO-GO.

### Task 5: Prove reconnect cannot overwrite canonical content

**OWNS:** `apps/roadmap-web/tests/blocksuite-spike/reconnect.test.ts`

**File(s):** same as `OWNS`

**What to implement:** Starting from one canonical fixture, let an offline client make a semantic
edit while a canonical client makes a different newer edit. Reconnect by applying the canonical
delta to the offline document and the offline delta to canonical, then persist the merged
`spaceDoc` and restore a third document. Assert canonical and offline content both survive and
that reconnect from an un-loaded stale document remains blocked by Task 4.

**TDD steps:**

1. Write test: assert the third restored document contains both edits and stable structure.
2. Run test: confirm it fails before reconnect merge is performed.
3. Implement: exchange updates and persist only after convergence; do not assign/replace a full
   document from stale state.
4. Run test: `bun test apps/roadmap-web/tests/blocksuite-spike/reconnect.test.ts`.
5. Commit: `test: prove BlockSuite reconnect overwrite safety`

**Expected output:** the canonical edit cannot disappear, the offline edit merges, and all three
semantic snapshots converge. Canonical loss or stale initialization is NO-GO.

## Wave 4

### Task 6: Record the fail-closed decision and run all gates

**OWNS:** `docs/work/2026-08-07-blocksuite-spacedoc-persistence-and-convergence-spike/decisions.md`

**File(s):** same as `OWNS`

**What to implement:** Run the focused headless suite as one command, then Roadmap tests,
typecheck, lint, source-test coupling, and repo-tooling. Record exact dependency versions,
commands, outcomes, SHA, and final GO/NO-GO/INCOMPLETE. Do not repair a core BlockSuite failure
with excluded techniques; record NO-GO and stop.

**TDD steps:**

1. Write test/evidence: run `bun test apps/roadmap-web/tests/blocksuite-spike` and retain the
   failing output if any core assertion fails.
2. Run checks: `bun run --cwd apps/roadmap-web test src/components/blocksuite/__tests__`,
   `bun run --cwd apps/roadmap-web typecheck`, `bun run --cwd apps/roadmap-web lint`,
   `bun run check:source-test`, and `bun run test:repo-tooling`.
3. Implement: update only `decisions.md` with immutable command/result evidence and the tri-state
   result; no production fix is part of this task.
4. Re-run: only gates affected by an evidence typo; never rerun a failed core test after an
   out-of-scope workaround.
5. Commit: `docs: record BlockSuite rejection spike result`

**Expected output:** a reconstructable exact-version result. GO requires every listed command to
pass; any core failure is NO-GO; unavailable or incomplete evidence is INCOMPLETE.

## YAGNI and ownership review

Every task maps directly to one success criterion or required gate. No task adds production
abstractions, renderer wiring, provider changes, or new dependencies. Tasks in the same wave own
disjoint files. Later waves may read earlier fixtures/helpers but do not modify them.

## Task-list gate

Not approved by this plan-stage worker. The main agent/user must confirm this list before `/dev`.
