# Plan Evaluation — Building Blocks Transformation (as of PR20)

Date: 2026-06-11
Inputs: `building-blocks-transformation-pr-plan.md`, PR17 design, `schema-domain-ownership.md`, README, repo topology (`apps/`, `packages/`, `services/`).

## What the plan does well (keep doing this)

- Merge gates + rollback criteria on every PR. This is rare discipline and it has clearly worked — 20 slices merged without a derailment.
- Empty-data preflight checks, fail-closed env validation, internal IDs kept separate from Clerk IDs, webhook idempotency, telemetry contract moved early (PR18/19 instead of PR23). All correct.
- The ownership matrix prevented false unification of `users` and `chat_messages` — exactly the trap most consolidations fall into.

## Top issues, prioritized

### 1. PR21 hides the biggest unresolved decision: what happens to meeting-web?

PR21 says "mount Meeting as a Product Suite module" — but `roadmap-web` is Next.js and `meeting-web` is a Vite SPA. There are only three real options and the plan picks none:

- a) iframe/reverse-proxy the Vite app under `/meetings` — fast, but two shells, two routers, double auth/redirect surface, janky UX seams. This is how products end up "Zoho-feeling."
- b) Render meetings inside the platform shell via `packages/ui-meeting` (which PR8 already built for exactly this), keep `meeting-api` as backend, retire `meeting-web` as a user-facing shell.
- c) Rewrite the shell on a shared meta-framework — too expensive now.

**Recommendation: (b).** It deletes an entire deployable, an auth surface, a routing stack, and the whole "route ownership matrix between Roadmap routes and Meeting React Router config" workstream. The plan already paid for this option in PR8; PR21 should cash it in. Keep `meeting-web` only as a dev harness if useful, clearly marked non-product.

### 2. Close the browser-data-access fork now — and choose backend-mediated for launch

PR17's open decision "browser modules query Supabase directly with Clerk tokens vs go through backend APIs" is the single largest remaining complexity fork. The Clerk-JWT-template → RLS path drags in: JWT template/claims contract, `auth.uid()` vs internal-UUID mapping, claim-mismatch SQL tests, exposed-schema/grant audits, stale-claim handling — a large fraction of the PR19/PR22 hardening addendum exists only to make that path safe.

**Recommendation:** for first launch, all reads/writes go through backend APIs (Next routes / meeting-api / agent-core) using server-verified Clerk identity. Keep all schemas private and PostgREST exposure off. RLS becomes defense-in-depth added later, not a launch dependency. This collapses PR22 to "membership checks server-side + audit events + no service-role in client," which is testable and small.

### 3. The "agent" half of the product has no plan

The product is stated as being for people *and* agents, but PR17–PR23 contain no agent-facing surface:

- **Machine auth is missing.** Clerk is human-login-centric. Agents need API keys or OAuth client-credentials with workspace-scoped permissions. PR22's role model must include non-human principals (actor type: `human | agent | service`, plus on-behalf-of attribution) or it gets retrofitted painfully.
- **The SDK/contracts are treated as internal plumbing (PR7), not as product surface.** If agents are customers, the typed SDK + a stable REST surface + an MCP server *is* the product for them. Today's `packages/sdk` should grow into that, with versioning and deprecation rules.
- **Idempotency keys on write endpoints** matter far more with agent callers (retries are the norm).
- **`platform.audit_events` needs actor attribution from day one** — cheap now, impossible to backfill.

**Recommendation:** add an explicit PR ("Agent Access Surface"): scoped API tokens, agent principals in the membership model, idempotent writes, MCP server over the SDK, rate limits, audit attribution. Slot it after PR22.

### 4. PR21 is 3 PRs wearing one label

By the plan's own slicing standards, PR21 bundles: module registry + app switcher, mounting Meeting, compatibility redirects, error boundaries, lazy loading, bundle budgets, route matrix. Split:

- PR21a: platform shell + nav + `/settings`, Roadmap mounted, rename `roadmap-web` → `platform-web` (the plan's own PR1 value is "repo topology truthful" — the shell's name should be too).
- PR21b: Meeting module mounted via `ui-meeting` (per #1).
- PR21c: redirects/compat layer + bundle budgets + error boundaries.

### 5. Dual realtime paths must not survive launch

PR14–16 carefully built Hocuspocus behind flags with Supabase Realtime as permanent fallback. Correct for rollout; wrong to keep forever — two transports means two sets of sync bugs and doubled test surface. Add an explicit "PR: remove Supabase Realtime fallback" (or the reverse — remove Hocuspocus if usage doesn't justify running a service) with a deadline tied to launch. Carrying both indefinitely is the worst option.

### 6. Package count is ahead of consumer count

7 packages (`contracts`, `sdk`, `ui-canvas`, `ui-chat`, `ui-meeting`, `ui-planning`, `ui-charting`) with — until PR21 lands — essentially one consumer each. Each package costs build config, CI filters, and indirection for every developer and every agent navigating the repo.

**Recommendation:** freeze extraction. New rule: a package requires a second real consumer before it is created. After PR21, audit `ui-planning`/`ui-charting`; if still single-consumer, folding them back is a legitimate simplification, not a regression.

### 7. The plan has no user-visible payoff milestone

PR21–23 are all infrastructure. The acceptance test for "one platform" should be a product flow, not a nav bar. Pick one golden path and make it PR21's product gate, e.g.: *record a meeting → summary appears → one click creates roadmap work items → they render on the timeline*. That flow is what justifies the consolidation to users, exercises cross-module contracts for agents, and gives PR23's analytics something real to measure.

Also: the open decision "default landing page after login" should be answered by time-to-first-value — almost certainly `/meetings` (upload → summary is instant value; an empty roadmap is not).

### 8. Stack judgments (the options you've chosen)

| Choice | Verdict |
| --- | --- |
| Clerk for auth | Right for speed. Verify org-feature pricing against expected workspace counts; keep the internal-ID indirection you already have. Gap: no machine/agent credentials (see #3). |
| Single Supabase Postgres, schema-per-module | Right call pre-revenue. Keep schemas private at launch (see #2). Close the still-open Alembic question now: `infra/supabase/migrations` is canonical, Alembic read-only — the docs already lean this way, so state it as decided. |
| FastAPI/Python for meeting-api | Keep. Transcription/ML ecosystem justifies the second language. |
| Hocuspocus + Yjs | Fine, but converge to one transport (see #5). |
| BlockSuite canvas | Riskiest dependency in the suite — needs patched deps and Next config hacks, upstream churns fast. The plan's own "after PR10: rebuild candidate?" checkpoint is never recorded as answered. Answer it before `/canvas` becomes top-level nav. If confidence is low, ship canvas as a capability inside roadmap documents rather than promising it as a peer module. |
| Next.js shell + Vite meeting shell | Consolidate to one shell (see #1). |

### 9. Process weight (developer + agent ergonomics)

- ~4 docs per PR (design/tasks/decisions/research) × 20+ PRs. The discipline is good; the duplication is not — the master plan repeats per-PR checklists that drift from the per-PR docs. Make the master plan a thin index: merge order, status, one-line goal, links. Detail lives only in per-PR docs. This is also the agent-ergonomics fix: an agent resuming work should read one short index + one active PR doc, not reconcile two copies.
- The 4 "Open Decisions" at the end of PR17 are all blockers for PR21/22. The plan's own ethos is "decide before implementing" — close all four in a decisions doc before PR21a starts.

## Suggested revised remaining sequence

1. **PR21-pre (docs only):** close the 4 open decisions: meeting-web retired as shell; backend-mediated data access at launch; Alembic read-only/Supabase migrations canonical; default landing = `/meetings`. Record the canvas rebuild-checkpoint verdict.
2. **PR21a:** platform shell + nav + settings; rename `roadmap-web` → `platform-web`.
3. **PR21b:** Meeting mounted via `ui-meeting`; meeting-web demoted to dev harness.
4. **PR21c:** redirects, error boundaries, bundle budgets.
5. **PR22 (slimmed):** server-side membership checks, audit events with actor attribution, service-role leak tests. RLS deferred to post-launch hardening.
6. **PR-new: Agent Access Surface:** API tokens, agent principals, idempotent writes, MCP server, rate limits.
7. **PR23:** as planned (events were already contracted early — good).
8. **PR-new: Realtime convergence:** delete the losing transport path.
