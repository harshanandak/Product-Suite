# Memory Brain P2a — Reflection + Rule Learning

**Date:** 2026-07-16  
**Status:** spec — trust-loop principle signed off 2026-07-16; reconciled 2026-07-16 (fixed `injected_via` to the real enum, applicability → `attrs.applies_when`, added `proposals.reflected_at` idempotency, pinned-first injection). Pending a Fable review pass before the implementation plan.  
**Depends on:** P1 merged (#96), P1b merged (#97)  
**Defers to P2b:** holdout + measurement UI

---

## Intent

Ship a **reflection engine** that learns from human corrections of agent proposals and **proposes rules** through the existing Review Inbox, cementing the trust loop: *observe recurring edits → propose with evidence → human approves + chooses strength → rule injects into future runs + is one-tap revokable.*

The goal is NOT to maximize rule precision or build enforcement gates — that's P2b. The goal is to establish that **learning is a visible conversation**, grounded in TRACE's finding that advisory injection helps but compliance demands hard enforcement (deferred).

---

## Design Principles (from user evaluation 2026-07-16)

1. **Trust requires visibility + control.** Rules are proposed through the Inbox (not silent mutations). The person feels coached, not configured.
2. **Recurrence-gating is non-negotiable.** No rule from a single edit — minimum ≥2 occurrences or 2 different approvers. Trust requires proof it's a pattern, not a one-off.
3. **Applicability conditions prevent over-generalization.** Every rule answers "when does this apply" — saves people from the "you fixed one thing, now it does the wrong thing everywhere" betrayal.
4. **Per-rule enforcement strength.** Advisory (default, injected as context) or hard (reserved for P2b gate; one-tap toggle at approval time). No global dial.
5. **Silent failures never acceptable.** If reflection can't extract a rule, it surfaces as a low-confidence proposal — the human decides, nothing is dropped.
6. **Revoke is frictionless.** One-tap in the UI; status → `retracted`; all edits retroactively invisible from the context fed to the agent (same semantics as a superseded decision memory).

---

## Scope: What P2a Includes

| Task | Deliverable |
|------|------------|
| A | **Reflection job** — mine accepted+edited proposals, cluster by scope/target-type, LLM distill to rules, propose as `kind='rule'` memories via Inbox |
| B | **Rule injection** — deterministically inject active advisory rules into the agent's system prompt (alongside decisions, scoped to org/project/etc) |
| C | **Applicability condition** — stored on the rule's existing `attrs.applies_when` (natural-language guide in P2a; promoted to a first-class column + machine-checkable predicate in P2b); shown in the Inbox + injected as part of the rule text |
| D | **UI: rule attribution + revoke** — Inbox "Memory logged" for rules; proposal list shows which rule (if any) was attributed to each future proposal; one-tap revoke |

---

## Architecture

### A. Reflection Job

**Entry point — a backend job, NOT the live agent tool.** `propose_memory` (`tools.ts`) needs a live runtime (a chatting user + run). Reflection runs headless, so it (1) mints its OWN `agent_runs` row (`kind='agent_run'`, `triggered_by='reflection'`, `memory_holdout=false`) to be the attributable actor, then (2) inserts `target_type='memory'` proposals **directly via `createProposal`** with `run_id` = that run. This satisfies apply.ts's `run_id` requirement (apply.ts:237) and the `source_run_id → agent_runs.id` FK (schema.ts:510) — no live-runtime coupling, and reflection-authored proposals apply exactly like agent-authored ones.

**Trigger:** on-demand via `POST /api/agent/reflection/run` (manual/scriptable). A scheduled cadence needs Workers cron and is deferred (§Known Unknowns) — the route is enough for P2a.

**Input:** proposals with `status='applied'` AND `edited_payload IS NOT NULL` AND `reflected_at IS NULL` AND **`target_type='work_item'`** — never `memory`, or the agent would learn rules from edits to its own rule/decision proposals (a feedback loop) — from the past N days (default 7), scoped to one tenant.

**Pipeline:**
1. **Diff** — for each correction, compute the field-level delta `payload → edited_payload` (reuse the Inbox field-diff; don't reinvent). Record `{field, from → to}` per changed field.
2. **Cluster** — group corrections by the **edited-field-set + direction** within a scope (e.g. "title shortened", "priority raised") — NOT the coarse `(org, target_type, scope_id)`, which would lump unrelated edits and invite over-broad rules (principle 3).
3. **Recurrence-gate** — keep only clusters with **≥ N (default 2)** distinct corrections. Sub-threshold clusters are **left unmined and unstamped** so they can mature across future runs.
4. **Reflect (LLM)** — per surviving cluster, one call: *"These proposals were all edited the same way. Write one atomic rule that would have prevented these edits: { directive, applies_when }."* The model may decline a low-signal cluster (→ skip). Stamp `model_id`/`prompt_version` on the proposal, like every proposal.
5. **De-dup** — if a similar **active/deferred** rule already exists in scope → emit a **`memory:supersede`** proposal (refinement); else `memory:create`.
6. **Propose** — `createProposal({ target_type:'memory', operation:'create'|'supersede', run_id:<reflection run>, model_id, prompt_version, payload:{ kind:'rule', title:<directive>, body:<human-readable rationale>, topics, attrs:{ applies_when:<condition>, evidence_proposal_ids:[…] }, enforcement:'advisory' } })`. **Evidence is structural** (`attrs.evidence_proposal_ids`) so the Inbox renders "changed N×" + links; the injected `body` stays a clean rationale, never a diff dump.
7. **Mark consumed** — stamp `reflected_at = now()` **only on corrections folded into an EMITTED proposal**. Sub-threshold corrections stay `NULL`, so a pattern that recurs later still reaches ≥N. (Fixes the "singleton consumed forever" trap.)

**Location:** `apps/platform-api/src/agent/reflection.ts` (new) + route `POST /api/agent/reflection/run`.

### A′. Write-path changes — REQUIRED (the current apply path cannot persist a rule)

`memoryCreatePayload` (apply.ts) accepts only `kind/title/body/topics/scope_type/scope_id`; zod **strips** `attrs`/`enforcement`/`pinned`, so applicability and per-rule strength would silently vanish. P2a MUST:
- Extend `memoryCreatePayload` **and** `memorySupersedePayload` (apply.ts) to accept `attrs` (object), `enforcement` (`'advisory'|'hard'`), `pinned` (bool).
- Extend `CreateMemoryInput`/`createMemory` (+ supersede) in `domain/memories.ts` to write `attrs`/`enforcement`/`pinned` (columns exist: schema.ts:491, 516-518).
- **Accept-time strength choice flows through `edited_payload` — as a FULL merged payload, not a partial.** apply.ts applies `edited_payload ?? payload` as a **wholesale replace** (apply.ts:260) and re-validates it against `memoryCreatePayload`, where `kind`+`title` are **required**. So the Inbox must write the **entire original payload merged with the toggled keys** into `edited_payload` — a partial `{enforcement, pinned}` would drop `kind`/`title` → `invalid_input` → the proposal terminally fails. No new accept path otherwise.
- `source_kind` stays `'proposal'` (apply.ts:147 unchanged) — a reflection rule genuinely enters via a proposal; its reflection origin lives on the `agent_run` (`triggered_by='reflection'`), so **no `memorySourceKindEnum` change**.

### B. Rule Injection

**When:** every time the agent runs a new chat turn (same as decision/fact injection in P1)

**What:** rules are **few per org**, so — unlike decisions/facts, which are retrieved by relevance — **all active `kind='rule'` memories in scope are injected** (both `advisory` and `hard`; the hard GATE is P2b). Injecting the full active set avoids retrieval-recall gaps for the very memories the team explicitly set. A **rules sub-budget** (a cap separate from the decisions/facts token budget, memory-retrieval.ts:37) ensures rules never crowd out decisions/facts.

**Selection:** a dedicated rules query selecting `title`, `body`, **and `attrs`** — the current retrieval select omits `attrs` (memory-retrieval.ts:137), so rules need their own — scoped via the same cascade (memory-retrieval.ts:66-74), ordered `pinned desc, priority desc, valid_from desc`.

**How:** rules inject into `AGENT_SYSTEM_PROMPT` under a distinct **"Team rules"** fence (separate from decisions/facts), each rendered as `directive — applies when: <attrs.applies_when>`:
```
— Team rules (learned from your edits):
  • [mem_xyz] Prefer concise titles (≤10 words). Applies when: work items in project Foo.
  • [mem_abc] Never propose pausing a design task — the team must agree first. Applies when: all task types.
```
Fencing/sanitization is the P1 mechanism, unchanged — rule text is never trusted as instructions beyond the fence.

**Scoping:** scope-cascade (org → project → work_item_type → individual), same as decision retrieval. A project-scoped rule overrides an org-wide one.

**Attribution:** log each injected rule to `run_memory_attributions` with the EXISTING `injected_via` enum — `'pinned'` for pinned rules, `'retrieved'` for non-pinned. **No new enum value.** This rail powers §D and the P2b holdout.

**Implementation:** extend `apps/platform-api/src/agent/memory-retrieval.ts` (rules select + ordering + sub-budget) and `runtime.ts` (the Team-rules fence).

### C. Applicability Conditions

**Storage:** on the rule's existing `attrs` jsonb as `attrs.applies_when` — a natural-language guide (e.g. `"only high-priority items"`, `"work items in project Foo"`). **No new `memories` column in P2a:** applicability is injected/displayed text only, so `attrs` (the designated kind-specific field, `schema.ts:491`) carries it with zero migration. P2b promotes it to a first-class column **with** a machine-checkable predicate when the hard-enforcement gate actually reads it — migrating once, when it's needed, not speculatively now.

**Display:** in the Inbox, the rule proposal's "applies when" row shows it (so the approver sees exactly when the rule will fire).

**Injection:** the applicability is **part of the rule text** in the Team-rules fence (context for the model, not code-enforced in P2a).

### D. UI: Rule Attribution + Revoke

**Rule proposal in the Inbox (ProposalDetail.tsx):** shows the directive, the **"applies when"** row (`attrs.applies_when`), the **evidence** — *"changed N×"* from `attrs.evidence_proposal_ids`, with links to the source corrections — and the **strength controls**: an advisory/hard toggle + a pin checkbox that, on accept, write the **full original payload merged with the toggles** into `edited_payload` (§A′ — a partial payload would fail validation). The applied banner reads **"Rule logged."** (op-specific, matching the P1b memory banners).

**"Rules active during this run":** on a *work-item* proposal whose run has rule attributions, ProposalDetail shows *"Rules active during this run: [titles]"* — worded as **active during**, never *caused* (every in-scope rule attributes to every run; we must not overclaim causation). `run_memory_attributions` has no `kind` column, so this joins attributions → memories and filters `kind='rule'`.

**New UI component:** `RuleAttributionBadge` (in `boards/inbox/`), wired in `ProposalDetail`.

**Revoke flow:** one-tap from the memory board → `POST /api/memories/:id/retract` (routes/memories.ts:223) → `retractMemory` sets `status='retracted'` (domain/memories.ts:406); retrieval injects only `status='active'` (memory-retrieval.ts:139), so a retracted rule stops injecting immediately. (Optionally have retract record `change_reason='user-revoked'` — a tiny domain add, not assumed to exist today.)

---

## Implementation Sequence (commit order)

| Task | Commit | Files |
|------|--------|-------|
| Migration | `packages/db/migrations/0012_proposals_reflected_at.sql` (+ `_journal.json`; hand-authored, additive) + schema.ts (`proposals.reflected_at`) | 1 commit |
| Write-path (A′) | `proposals/apply.ts` (memoryCreate/Supersede payload accept `attrs`/`enforcement`/`pinned`) + `domain/memories.ts` (`createMemory`/`supersedeMemory` write them) + tests | 1 commit |
| Reflection (A) | `agent/reflection.ts` + `.test.ts` + route `POST /api/agent/reflection/run` (mints an `agent_run`, inserts proposals via `createProposal` directly — NOT the `propose_memory` tool) | 2 commits |
| Injection (B) | `agent/memory-retrieval.ts` (rules select incl. `attrs`, ordering, sub-budget) + `runtime.ts` (Team-rules fence) + rule attributions | 2 commits |
| Inbox UI + attribution (D) | `boards/inbox/ProposalDetail.tsx` (evidence "changed N×" + advisory/hard + pin controls → `edited_payload`; "Rules active during this run") + `RuleAttributionBadge.tsx` + `data/memories/adapter.ts` (`retract`) | 2 commits |

**Solo Opus builder:** commit-per-task (migration + 4 tasks), TDD per task. Won't push until a code review + fixes. Note the **A′ write-path must land before A** — reflection proposals are unusable until the apply path can persist rule fields.

---

## Test Coverage

- **Write-path (A′)** — a rule `create` proposal with `attrs`/`enforcement`/`pinned` persists all three (not zod-stripped); accepting with `edited_payload` = the **full original payload merged with** `{enforcement:'hard', pinned:true}` writes the human's choice; a **partial** `edited_payload` must FAIL validation (kind/title required) — the test asserts this, proving the merge is mandatory; default is advisory/unpinned.
- **Reflection input filter** — only `target_type='work_item'`, `edited_payload IS NOT NULL`, `reflected_at IS NULL` are mined; rule/decision proposals are excluded (no feedback loop).
- **Recurrence + idempotency** — a single correction proposes nothing and is NOT stamped; ≥N same-field-set corrections propose one rule and stamp exactly those; a sub-threshold correction stamped `NULL` matures on a later run; a second run over already-stamped corrections is a no-op.
- **Clustering** — corrections with different edited-field-sets do not merge into one rule.
- **Reflection dedup** — a candidate matching an existing active rule emits a `supersede` proposal, not a duplicate `create`.
- **Injection** — the rules select returns `attrs`; the fence renders `applies_when`; pinned rules order first (`injected_via='pinned'`), non-pinned `'retrieved'`; the rules sub-budget caps rule tokens without starving decisions/facts; scope cascade respected (project overrides org, no cross-org leak); only `status='active'` rules inject.
- **Revoke semantics** — after retract, the rule is never injected again; past attributions are retained (audit).
- **LLM reflection quality** — sample real proposal clusters, verify extracted rules are plausible (manual spot-check, LLM mocked in unit tests).

---

## Known Unknowns / Fast-Follows

1. **Reflection cadence** — P2a is on-demand via `POST /api/agent/reflection/run`. A scheduled cadence (Workers cron) is deferred; the route is enough to run + demo the loop.
2. **Cluster size threshold** — "≥2" vs. "≥3"? Start with ≥2; tighten if false-positive rules emerge.
3. **Hard enforcement (P2b)** — P2a stores applicability as natural-language (`attrs.applies_when`) only. P2b promotes it to a first-class column + machine-checkable predicate and adds the pre-submit GATE that checks a new proposal against active `hard` rules before it reaches the Inbox (TRACE's access→compliance win, 100%→2%).
4. **Conflicting rules** — if org rules contradict each other, no enforcement today (P2a advisory = context, not gate). P2b will need a conflict detector.
5. **Rule editing at accept** — P2a lets the approver set **enforcement/pin** (via `edited_payload`, §A′) but NOT free-text edit the directive/applicability. Full rule editing (narrowing applicability, rewording) is deferred.
6. **`triggered_by='reflection'` is a reserved sentinel** — `agent_runs.triggered_by` is `text` NOT NULL, documented as `users.id` (schema.ts:128). During the build, grep every consumer of `triggered_by` so none resolves the reflection sentinel to a user row (it has no matching user).
7. **`edited_payload` carries two meanings now** — the human gold-label correction (what P2b learns from) AND the accept-time control state (enforcement/pin) on a rule proposal. This is safe ONLY because reflection mines `target_type='work_item'` exclusively. Guard note: if reflection ever widens to memory targets, a rule proposal's pin/enforcement toggle must NOT be mislearned as a "correction," or the loop would learn rules from its own UI state.

---

## Success Criteria

- [ ] Reflection job runs without error and proposes plausible rules (manual spot-check)
- [ ] Rules inject into the agent's prompt (visible in debug logs)
- [ ] Inbox shows rule attribution (which rule influenced this proposal?) + one-tap revoke works
- [ ] Scope cascade respected (org rule doesn't leak to other orgs, project rule overrides org)
- [ ] Both apps typecheck + tests green

---

## Defer to P2b (the Moat's Proof)

P2a proves the mechanism works (learn from corrections → propose → approve → inject). P2b proves it *matters*: the **10% holdout** (some runs suppress all rule injection) measures the edit/reject-rate delta, establishing causality. Once we ship P2a, we have the data foundation for P2b's causal argument.
