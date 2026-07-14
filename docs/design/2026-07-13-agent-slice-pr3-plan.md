# Agent Slice PR3 — Review Inbox UI — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.
> Supersedes an earlier draft that referenced non-existent endpoints — the REAL API is below.

**Goal:** The surface where humans dispose of what agents propose — a review inbox at the existing `/w/$workspace/inbox` route: a pending-proposals **list + a selected-proposal detail pane** (one screen), each Accept / Reject → the real PR1/PR2 endpoints. The product is the detail (*what will actually change*); the list is navigation.

**Architecture:** Fill the shell's existing `homeInboxRoute` (currently a `BoardScreen` placeholder). Add a `data/proposals/` adapter mirroring `data/work-items/` (network repository + a `useProposals` TanStack Query hook with accept/reject mutations). `InboxScreen` = list + detail pane, **porting card/pill/typography from the mockup** `docs/design/work-item-board.html` via `packages/ui` + the oklch/Geist/indigo tokens. **Port, don't invent.** (Fable-scoped.)

**Tech Stack:** Vite + React 19 + TanStack Router/Query · `packages/ui` (shadcn) · Vitest + Testing Library.

## Global Constraints (verbatim)

- **REAL proposals API** (built PR1/PR2 — do NOT invent `/api/proposals` or `PATCH`): `GET /api/agent/proposals` → `Proposal[]` (pending, tenant-scoped). `POST /api/agent/proposals/:id/accept` (**no body**) → `200` applied (returns the created/updated item) | `409` not-pending/stale | `422` invalid | `404`. `POST /api/agent/proposals/:id/reject` (body `{ reason? }`). A `Proposal`: `{ id, target_type:'work_item', target_id: string|null, operation:'create'|'update', payload: Record<string,unknown>, rationale: string|null, confidence: number|null, status, run_id, model_id, created_at }`.
- **Design fidelity:** match `docs/design/work-item-board.html` (card container, status/priority pills, spacing, Geist typography) + live tokens `packages/ui/src/styles/tokens.css`. Reuse `packages/ui` + the exemplar `apps/platform-web/src/boards/workboard/WorkboardScreen.tsx` (screen scaffolding: repository via provider, loading/empty/error). Data access mirrors `data/work-items/network-repository.ts` (`request<T>` + auth). **Never invent a new look or data pattern.**
- **Render fields as ROWS, not a JSON blob** — this is the extension point for PR3.5 edit-before-accept. Collapsible "raw payload" is fine as a secondary.
- **Don't get wrong (Fable):** the field-diff must faithfully show what `accept` actually applies (`payload`; the target's current values for `update`) — a misleading diff destroys trust irrecoverably.
- **Out of v1 scope (defer):** edit-before-accept (PR3.5 — needs an accept-with-body backend seam), optimistic UI (plain invalidate-on-settle), filters/bulk/history tab, undo, keyboard triage.
- TDD, frequent commits (`bun run vitest run` + `typecheck` from `apps/platform-web`). Held for review + **screenshot verification** vs the mockup.

## File Structure

- `apps/platform-web/src/data/proposals/{types,network-repository,use-proposals}.ts` + a mock repository + provider mirroring `data/work-items/` — **Create**.
- `apps/platform-web/src/boards/inbox/InboxScreen.tsx` — **Create**: list + detail pane, empty/loading/error.
- `apps/platform-web/src/boards/inbox/ProposalListItem.tsx` — **Create**: one row in the list (operation sentence, target summary, confidence badge, time).
- `apps/platform-web/src/boards/inbox/ProposalDetail.tsx` — **Create**: the detail pane (see Task 3).
- `apps/platform-web/src/router.tsx` — **Modify**: `homeInboxRoute.component` → `InboxScreen`.
- Co-located `*.test.tsx` for repository, hook, list item, detail, screen.

---

### Task 1: `data/proposals` adapter

**Interfaces:** `interface Proposal { … as above … }`; `createNetworkProposalRepository(opts): { list(): Promise<Proposal[]>; accept(id): Promise<AcceptResult>; reject(id, reason?): Promise<void> }` — `accept` maps `409→{stale:true}` / `422→{invalid:true}` (surfaced, not thrown-opaque). `useProposals()` → `{ proposals, isLoading, error, accept, reject, isMutating }` (mutations invalidate the list query).

- [ ] **Step 1:** Read `data/work-items/{network-repository,use-work-items,RepositoryProvider}.tsx`; mirror the `request<T>` fetch helper, auth header, query-key, and provider shape exactly.
- [ ] **Step 2:** Failing tests — `list()` GETs `/api/agent/proposals` with auth; `accept(id)` POSTs `/:id/accept`; a `409` response surfaces as a stale outcome (not an opaque throw); `reject(id,'wrong target')` POSTs the reason.
- [ ] **Step 3–4:** Implement + run + typecheck.
- [ ] **Step 5:** Commit — `feat(web): proposals data adapter (mirror work-items repository)`.

### Task 2: `InboxScreen` (list) + route wiring

- [ ] **Step 1:** Failing test — mock repo with 2 pending proposals → `InboxScreen` renders a list of 2 `ProposalListItem`s (each an operation sentence + confidence badge); empty → "No proposals to review"; error → the error surface; selecting a row shows its `ProposalDetail`.
- [ ] **Step 2:** Implement `InboxScreen` (master list + selected detail pane) mirroring `WorkboardScreen` scaffolding; port the card/list styling from `work-item-board.html`. Point `router.tsx` `homeInboxRoute` → `InboxScreen`.
- [ ] **Step 3–4:** Run + typecheck.
- [ ] **Step 5:** Commit — `feat(web): review inbox screen (list + detail) at /w/$workspace/inbox`.

### Task 3: `ProposalDetail` — the decision surface

Three layers top-down (Fable): (a) **operation sentence** — "Create work item '{title}'" / "Update {target title}: {n} fields"; (b) **rationale** verbatim, visually primary; (c) **field table as rows** — for `create`: `field | value` (only provided fields); for `update`: `field | current → proposed` (fetch the target via the existing work-items hook by `target_id`; show only changed fields). Plus: confidence as a muted numeric badge, `model_id`+`created_at`+`run_id` as fine-print provenance, `target_id` as a link to the item. Actions: **Accept** (green) and **Reject** (red) with an inline optional-reason field (skippable chips: "wrong target" / "bad data" / "not needed"). On `409` → show "no longer pending / stale" + refetch (don't silently fail); on success of accept → an "Applied → view item" link. Collapsible "raw payload".

- [ ] **Step 1:** Failing tests — (a) an `update` proposal renders `current → proposed` rows for only the changed fields (mock the target fetch); (b) a `create` renders `field | value` rows; (c) Accept calls the mutation → on 409 the stale message shows + list refetches; (d) Reject with a chip reason calls reject with that reason; (e) Accept success shows the applied→item link.
- [ ] **Step 2–4:** Implement `ProposalDetail` (fields as rows — the PR3.5 edit extension point) + run + typecheck.
- [ ] **Step 5:** Commit — `feat(web): ProposalDetail — field diff, rationale, provenance, accept/reject`.

---

## Self-Review

- **Coverage:** list/accept/reject data (real contract) → T1; screen+route+states → T2; the decision surface (diff/rationale/provenance/actions/stale-handling) → T3. ✓
- **Placeholder scan:** each task cites concrete exemplars (`data/work-items/*`, `WorkboardScreen.tsx`) + the mockup path + the REAL endpoints — no invented API, no "style nicely" hand-waving. ✓
- **Fidelity:** fields-as-rows (not JSON), current→proposed via the work-items hook, port from the mockup. Edit-before-accept explicitly OUT but slotted for later. ✓

## Execution Handoff

Subagent-driven (one Opus builder, **solo** — no parallel/peer), then **screenshot verification** (render `InboxScreen` + `ProposalDetail` with mock data, compare to `work-item-board.html`) + a Fable/visual fidelity check. Riskiest: T3 field-diff fidelity (must show exactly what accept applies) + visual match to the mockup.
