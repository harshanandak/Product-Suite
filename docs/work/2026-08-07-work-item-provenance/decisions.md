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

## D8 - Deliver provenance as one coherent PR

Keep the accepted-proposal write correction, trusted meeting-source discriminator, tenant-safe read model, detail provenance module, E2E proof, tests, and decision documentation together in one medium-sized provenance PR. Do not split completed tasks into tiny PRs. Exclude unrelated lint infrastructure, dependency upgrades, BlockSuite work, and preserved dirty meeting worktrees.

## Decision gate 1 - Distinguishing meeting proposals from ordinary agent proposals

**Date:** 2026-08-07

**Task:** Task 1 - Correct trusted source stamping

**Gap:** Proposals have no dedicated origin field. Forcing every accepted proposal to `agent` would regress trusted meeting ingestion, while trusting `payload.source` would weaken provenance authority.

**Score:** 8/14; files beyond task 2, signature/export 0, shared module 2, persistent behavior 2, discussed UX 0, provenance/security 2, reversibility 0. Mandatory override: security dimension scored 2.

**Route:** BLOCKED, then resolved by the main integrator.

**Choice made:** Use the existing `meeting_promotions` row as the tenant-scoped trusted meeting-origin discriminator. Preserve `meeting` only when the same tenant and proposal are present in that ledger; derive `agent` for every other accepted work-item proposal. Task 1 ownership expanded to `apps/platform-api/src/meeting/ingest.test.ts` for its regression fixture and later to `apps/platform-api/src/meeting/ingest.ts` to publish the proposal and ledger row atomically after quality review exposed a visible-pending race. Never trust `payload.source`.

**Status:** RESOLVED

## Decision gate 2 - Provenance contract field names

**Date:** 2026-08-07

**Task:** Task 2 - Project existing provenance through the tenant-safe read model

**Gap:** The plan defined the facts but not their public contract property names.

**Score:** 6/14; public export 2, shared module 2, data-exposure semantics 1, reversal cost 1.

**Route:** SPEC-REVIEWER

**Choice made:** Add optional readonly `WorkItem.provenance` using exact durable authority names `applied_from_proposal_id`, `actor_type`, `actor_id`, `on_behalf_of`, `run_id`, and `run_summary`. Keep proposal-decision facts distinct as `approver_id`, `approver_name`, and `approved_at`. `actor_type` is non-null; relationship and joined context fields are nullable.

**Status:** RESOLVED

## Decision gate 3 - Read projections versus the provenance stamp tripwire

**Date:** 2026-08-07

**Task:** Task 2 - Project existing provenance through the tenant-safe read model

**Gap:** The provenance completeness test counted column tokens across entire files, so a SELECT/read projection looked like an inline write and failed despite adding no write path.

**Score:** 5/14; files beyond task 2, shared safety test, and security-gate semantics required spec review.

**Route:** SPEC-REVIEWER

**Choice made:** Expand Task 2 ownership only to `apps/platform-api/src/provenance/stamp-completeness.test.ts`. Extract tagged SQL INSERT/UPDATE bodies globally, assert their total equals the expected Tier-2 write count, and require every extracted write to contain all four provenance columns. Ignore SELECT/type/mapper occurrences; add no file exemption and do not inflate the expected count. The same review confirmed durable IDs come from `wi.applied_from_proposal_id` and `wi.run_id`, while tenant-safe joins supply proposal decision, run summary, and approver display context.

**Status:** RESOLVED

## Decision gate 4 - E2E prerequisite classification before setup

**Date:** 2026-08-07

**Task:** Task 4 - Extend the existing live agent loop proof

**Gap:** A skip inside the moat spec runs after Playwright's setup-project dependency, so missing Clerk inputs failed setup instead of producing the required INCOMPLETE result. The first correction also treated optional local-mode and backend-owned environment variables as mandatory web-test inputs.

**Score:** 5/14; one file outside the task, shared E2E setup, and result-integrity semantics required spec review.

**Route:** SPEC-REVIEWER

**Choice made:** Expand Task 4 ownership only to `apps/platform-web/e2e/global.setup.e2e.ts`. Setup explicitly skips INCOMPLETE when the Clerk secret, logical publishable key, or E2E user is missing or blank. The moat spec requires those inputs plus `DATABASE_URL`. `E2E_BASE_URL` remains optional for managed local Vite mode, and `OPENROUTER_API_KEY` remains backend-owned rather than inferred from the web test process. Once preflight passes, connectivity or provider failures remain real FAIL results.

**Status:** RESOLVED

## Decision gate 5 - Clerk publishable-key alias in managed local E2E

**Date:** 2026-08-07

**Task:** Task 4 - Extend the existing live agent loop proof

**Gap:** Setup and moat preflight accepted the unprefixed Clerk publishable-key alias, but the managed local Vite child received only the raw VITE-prefixed value. Alias-only and blank-primary configurations therefore passed preflight and then booted without a usable Clerk key.

**Score:** 6/14; configuration outside the task, shared harness behavior, and authentication semantics required spec review.

**Route:** SPEC-REVIEWER

**Choice made:** Expand Task 4 ownership only to `apps/platform-web/playwright.config.ts`. Normalize the trimmed VITE-prefixed key, fall back to the trimmed unprefixed alias, and forward the result as `VITE_CLERK_PUBLISHABLE_KEY` to the managed local Vite child. Preserve the existing alias contract; deployed mode remains unchanged.

**Status:** RESOLVED
