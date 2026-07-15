# Memory Brain P1b — agent-authored memory via the Review Inbox

> Builds on P1 (the human-authored decision/knowledge store + injection + attribution, #96). P1b closes the *agent* side of the loop: the agent PROPOSES a memory write, it lands in the **existing Review Inbox**, and a human accept applies it through the memory domain — the single validated write path. Reuses the shipped proposals/apply/Inbox infra; **no new proposal table, no new review surface.**

## The loop it closes
Agent (chat / "remember this" / reflection later) → **`propose_memory`** → a `proposals` row (`target_type='memory'`) → Review Inbox → human accept → `createMemory`/`supersedeMemory`/… stamped with agent provenance. Memory writes are agent writes, so they go through the SAME propose→dispose discipline as work-item writes — on-brand, and the trust surface already exists.

## Verified seams (grounded — don't re-assume)
- `proposals.target_type` is **free text** (`text(...).notNull()`), not an enum → **no migration** to add `'memory'`.
- Apply (`apps/platform-api/src/proposals/apply.ts`) gates on a `SUPPORTED` set (`work_item:create|update`) and dispatches on `${target_type}:${operation}` under the claim-then-command design (atomic status-flip gate → only the winner applies).
- `memories.source_proposal_id` / `source_run_id` columns already exist (P1) → use them for provenance + idempotent re-drive (the memory analogue of `work_items.applied_from_proposal_id`).

## Tasks (TDD; commit per task; typecheck + vitest green both apps)

### Task A — `propose_memory` agent tool (platform-api)
In `agent/tools.ts`, add `propose_memory`: `operation: create|supersede|retract|defer`, `payload` (create: kind/title/body/topics/scope; supersede: target memory id + title/body/change_reason; retract/defer: target id + waiting_on/review_after). Validates operation-specific required fields, then inserts a `proposals` row `target_type='memory'`, `operation`, `payload` (jsonb), stamped `run_id`/`actor_type='agent'`/`on_behalf_of`/`model_id` (mirror `propose_create`/`propose_update`). Returns `{ proposed, proposal_id } | { proposed:false, error }`. Tenant-scoped (a supersede/retract/defer target id must be the caller-org's memory — validate before proposing, else `proposed:false`).

### Task B — apply dispatch for memory (platform-api)
Extend `apply.ts`: add `memory:create|supersede|retract|defer` to `SUPPORTED`; in the command dispatch, call the memory domain with the **agent actor** (actor_type='agent', on_behalf_of=the proposal's decider, run provenance). Stamp `source_kind='proposal'`, `source_proposal_id=<proposal id>`, `source_run_id=<proposal.run_id>` on created/superseded memories. **Idempotent re-drive:** before create, check for an existing memory with `source_proposal_id=<id>` (return it) — the memory analogue of the `applied_from_proposal_id` guard. Keep the guarded compensation (stale→pending, invalid→failed) exactly as the work-item path.

### Task C — Inbox renders a memory proposal (platform-web)
`boards/inbox/ProposalDetail.tsx` currently renders work-item proposals (field-diff via the work-items hook). Branch on `proposal.target_type === 'memory'`: render the memory decision surface — operation sentence ("Log a decision: '<title>'" / "Supersede <target>: <n> changes"), the **body** (rationale, visually primary), kind/topics/scope as rows, and for supersede the `change_reason` + current→proposed title/body (fetch the target memory via the memories adapter by `target_id`). Accept/Reject unchanged (they already POST the existing endpoints). NO inline accept beyond the shared Accept.

### Task D — "remember this" prompting (platform-api)
Add ONE line to `AGENT_SYSTEM_PROMPT`: when the user asks to remember/log a decision or fact (or explicitly "remember this"), use `propose_memory` (never claim it's saved — say "I've proposed logging that, pending your review"). No new endpoint; it's the agent using the Task-A tool.

## Out of scope (P1c / later)
- **Meeting-notes batch extraction** (paste notes → a run emits many memory proposals) — a dedicated flow; defer.
- **P2 (the moat):** `kind='rule'` reflection from `edited_payload` + the 10% holdout.
- **P3:** the KB.

## Verification
- TDD; `typecheck`+`vitest` green both apps; pre-push. Tests: `propose_memory` writes a `target_type='memory'` proposal stamped with agent provenance (+ rejects a foreign target id); apply dispatches `memory:*` to the domain with agent actor + source provenance + is idempotent on re-drive; the Inbox renders a memory create + supersede correctly; **tenant isolation** on the apply + tool (a foreign memory target never proposed/applied).
- **Fable adversarial review** before ship (tenant boundary on the new apply branch, provenance correctness, idempotency, the trust/inbox rendering, no double-apply).
- Ship via `forge ship`; monitor with `forge shepherd`.

## Execution
Solo Opus builder, commit per task. Riskiest: the apply idempotency for memory (source_proposal_id guard) + tenant-scoping the supersede/retract/defer target. Hold for Fable review.
