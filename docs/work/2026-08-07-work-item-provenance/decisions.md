# Work-item provenance decisions

## D1 - Existing columns remain authoritative

Use `work_items.applied_from_proposal_id`, the four work-item actor columns, proposal decision fields, and `agent_runs`. No migration, duplicate provenance table, or backfill.

## D2 - Source is server-derived on proposal application

The accepted-proposal path supplies `agent` through trusted command context. `WorkItemPatch` continues to exclude source so clients cannot relabel provenance.

## D3 - Read model is additive and tenant-constrained

Add an optional WorkItem provenance projection to the existing list response. Every joined proposal/run/user fact must be constrained to the work item's tenant. Dangling, deleted, legacy, and cross-tenant references yield partial/unavailable data, not a failure or leak.

## D4 - Proposal navigation reuses the existing Inbox deep link

Link to `/w/$workspace/inbox?proposal=<id>`. The current Inbox already uses the tenant-scoped any-status proposal lookup for dead/disposed deep links; no new route or detail surface is needed.

## D5 - Provenance is an Overview module, not synthetic activity

Do not invent an activity event or event-bus behavior. Keep Activity unchanged and render stable provenance facts in the work-item Overview.

## D6 - Preserved meeting E2E patch is superseded

Do not port, modify, unstage, or commit the staged `meeting-e2e` patch. Its changes are comment/README wording plus unrelated Forge config removal. Extend the already-present `db-provenance.e2e.ts` helper and `moat-loop.spec.ts` in this branch instead.

## D7 - No claim beyond available evidence

Focused unit/integration tests are required. The live E2E is PASS only when its required services and DB assertion run; otherwise its result is INCOMPLETE.

## Decision gate 1 - Distinguishing meeting proposals from ordinary agent proposals

**Date:** 2026-08-07

**Task:** Task 1 - Correct trusted source stamping

**Gap:** Proposals have no dedicated origin field. Forcing every accepted proposal to `agent` would regress trusted meeting ingestion, while trusting `payload.source` would weaken provenance authority.

**Score:** 8/14; files beyond task 2, signature/export 0, shared module 2, persistent behavior 2, discussed UX 0, provenance/security 2, reversibility 0. Mandatory override: security dimension scored 2.

**Route:** BLOCKED, then resolved by the main integrator.

**Choice made:** Use the existing `meeting_promotions` row as the tenant-scoped trusted meeting-origin discriminator. Preserve `meeting` only when the same tenant and proposal are present in that ledger; derive `agent` for every other accepted work-item proposal. Task 1 ownership expanded to `apps/platform-api/src/meeting/ingest.test.ts` for its regression fixture and later to `apps/platform-api/src/meeting/ingest.ts` to publish the proposal and ledger row atomically after quality review exposed a visible-pending race. Never trust `payload.source`.

**Status:** RESOLVED
