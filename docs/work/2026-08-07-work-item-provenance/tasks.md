# Work-item provenance implementation tasks

**Status:** Awaiting `gate.plan-approval`
**Issue:** `163c617a-2ec7-4ffc-8575-eea4085f8e4f`

Each task has one owner and must be completed RED -> GREEN -> REFACTOR. Do not begin until the plan is approved.

## Task 1 - Correct trusted source stamping

**Owner:** API domain implementer

**OWNS:**

- `apps/platform-api/src/proposals/apply.ts`
- `apps/platform-api/src/proposals/apply.test.ts`
- `apps/platform-api/src/domain/work-items.ts`
- `apps/platform-api/src/domain/work-items.test.ts`

**RED:**

1. Add proposal-apply tests proving an agent create persists `source = 'agent'` alongside the existing proposal id and actor/run attribution.
2. Add an update-domain test proving a trusted server provenance override changes source to agent while stamping the real run and authorizing human.
3. Add regression tests proving ordinary human create/update preserve manual/meeting source and a client patch cannot set source.

**GREEN:** Pass an explicit trusted `agent` source from `applyProposal`; use a narrow server-only update context override that defaults to preserving the current source. Do not add `source` to `WorkItemPatch`.

**Expected output:** Agent-applied creates and updates report `agent`; existing manual and meeting writers are unchanged.

## Task 2 - Project existing provenance through the tenant-safe read model

**Owner:** API read-model implementer

**OWNS:**

- `packages/contracts/src/index.d.ts`
- `packages/contracts/src/work-items.test.ts`
- `apps/platform-api/src/routes/work-items.ts`
- `apps/platform-api/src/routes/work-items.test.ts`

**RED:**

1. Add contract coverage for an optional, read-only WorkItem provenance projection.
2. Add route tests for a complete agent/proposal/run/approver projection.
3. Add adversarial tests where proposal, run, or approver belongs to another tenant; no foreign data may appear.
4. Add legacy/deletion tests for null proposal, deleted run, missing/deleted approver, and a manual item with no provenance.

**GREEN:** Extend the existing list query and mapper with tenant-constrained left joins and partial fallbacks. Reuse stored work-item/proposal/run/user fields; add no endpoint or schema.

**Expected output:** Existing list consumers receive backward-compatible WorkItems, while detail consumers can render trustworthy optional provenance.

## Task 3 - Render provenance on work-item detail

**Owner:** Workboard UI implementer

**OWNS:**

- `apps/platform-web/src/boards/workboard/detail/WorkItemDetailScreen.tsx`
- `apps/platform-web/src/boards/workboard/detail/WorkItemDetailScreen.test.tsx`

**RED:**

1. Add a complete-provenance rendering test for source, proposal link, run context, approver, and approval time.
2. Assert the link targets `/w/$workspace/inbox?proposal=<id>`.
3. Add missing/deleted actor and run fallbacks, plus legacy/manual omission tests.
4. Cover keyboard-accessible link naming and narrow content that wraps without hiding identifiers.

**GREEN:** Add the smallest Overview provenance section using existing typography, links, and semantic tokens. Keep the existing Source row and Activity tab behavior.

**Expected output:** Users can trace an agent-created item to its proposal, run, and approver without a workboard redesign.

## Task 4 - Extend the existing live agent loop proof

**Owner:** E2E validator

**OWNS:**

- `apps/platform-web/e2e/db-provenance.e2e.ts`
- `apps/platform-web/e2e/moat-loop.spec.ts`

**Must not touch:** `..\meeting-e2e` or its index/worktree state.

**RED:** Extend the current DB readback and agent-create flow so the old manual source fails. Assert the accepted proposal id, `source = 'agent'`, agent actor/run attribution, approver decision, and rendered detail module/proposal link.

**GREEN:** Reuse the current helper and existing moat flow; add no dependency, new seed path, or meeting-specific behavior. If `DATABASE_URL` or live prerequisites are absent, report the DB portion INCOMPLETE rather than passing it.

**Expected output:** One live path proves propose -> approve -> persisted provenance -> detail UI. The preserved staged meeting patch is superseded, not ported.

## Task 5 - Validate and hand off

**Owner:** Main integrator

**OWNS:** No implementation files; validation and Forge evidence only.

1. Review each task's RED/GREEN evidence and diff against its ownership list.
2. Run focused tests, affected lint/type checks, then the repository-prescribed `/validate` stage.
3. Treat timeout, missing live credentials, skipped DB checks, or non-reconstructable output as INCOMPLETE.
4. Re-prove the Forge lease before any stage transition and record `summary`, `decisions`, `artifacts`, and `next` on the issue.
5. Stop at the next human checkpoint; do not push, open a PR, or merge without explicit authorization.
