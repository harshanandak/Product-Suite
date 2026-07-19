# Product-Suite — Decided MVP Scope & Launch Gap

**Date:** 2026-07-18 · **Purpose:** Surface the ALREADY-DECIDED MVP and the concrete remaining
work to a clean launchable product. Read-only synthesis; cites the deciding docs/commits.

---

## 1. The decided MVP

The MVP is **defined implicitly across two load-bearing design docs + one in-progress epic**, not
one "MVP.md". Reconstructed, the team committed to:

- **The product = a Linear/Jira/Notion-style workboard whose moat is an in-app AI agent that
  proposes work, a human disposes, and a memory layer that compounds.** The one-line commitment
  is verbatim in `docs/design/2026-07-13-agent-slice-v1-design.md` §1: *"v1 = the full in-app chat
  slice, propose-only. A user chats in platform-web; the agent reads the workboard and proposes
  work-item creates/edits; proposals land in a review inbox; a human accepts; the accept applies
  through the shared command layer. No auto-accept, no autonomous runs, no agent tokens."*

- **The work ontology is frozen** (`docs/design/2026-07-10-work-ontology-and-phasing-design.md` §2.2):
  `Tenant(=Clerk Org=Workspace) → Team (mandatory owner, carries the mode, owns statuses/cycles/
  triage) → Item (the atom) → Task (Item with parent_id) / Check (frozen checklist row)`; **Project**
  is the optional cross-team outcome container (owns milestones, not workflow). Vocabulary is
  decided: Item / Task / Check / Project / Team.

- **Persona:** software-first team lead / PM in a single workspace (one Clerk Org = one tenant),
  managing a board of work Items with tasks, dependencies, per-team statuses and priorities — the
  Linear teardown in §2.2 is the explicit model.

- **Core user flows committed (agent-slice-v1 §1 "In scope"):** (a) browse/edit a **workboard** and
  a deep **work-item detail page**; (b) open an **agent chat panel**, ask it to change the board;
  (c) it **proposes** into a queue; (d) a **Review Inbox** shows exactly what will change, human
  accepts/rejects; (e) accept **applies through one validated write path** with full provenance;
  (f) a **memory brain** captures decisions/rules and injects them into future agent runs.

- **The stance is the product** (`2026-07-14-agent-slice-pr4-chat-panel.md`): *"agent proposes,
  human disposes."* Chat is scratch space; the durable artifact is the reviewable proposal. Accept
  lives ONLY in the Inbox detail pane — never inline in chat.

- **Everything risky is an explicit deferred seam** (agent-slice-v1 §1/§10): auto-accept policy
  tiers (Jira-tight→Linear→Notion-loose), autonomous/queued runs, agent tokens, Code Mode/MCP/
  user-authored tools, embeddings/KG memory, multi-model routing, undo UI, per-tool permission UI.
  These are named columns/seams (`risk_level`, `agent_runs.kind`), not built.

- **The unifying deliverable is PR21 "Single Domain Platform Shell"** (`pr21-single-domain-platform-
  product-suite-a49`, **in_progress**) — the one deployable app that stitches auth + workboard +
  detail + inbox + chat + memory into a single domain (`/w/$workspace/...`). This is the MVP's
  actual shipping container.

---

## 2. Built vs remaining (from git log + file/schema/migration checks)

**BUILT & MERGED to this branch (commits #58–#102):**

| MVP surface | Status | Evidence |
|---|---|---|
| Auth spine (Clerk, one-level tenancy) | DONE | #68, #70; epics PR5/6/17/18 done |
| Realtime (Hocuspocus) + agent-core + contracts/SDK | DONE | epics PR7–PR16 done |
| Work ontology data model (teams, per-team statuses, sub-items/Task tier, enriched projects) | DONE | migration waves #79–#82 |
| `tasks→checks` rename (Task = ownable work) | DONE | #83, migration `0005`, `checks` table in schema.ts:319 |
| Provenance foundation (agent_runs + recordWrite + actor_*) | DONE | #85, #86, #89, migration `0006` |
| Workboard screen on live API + dependency writes | DONE | #74, #72, #65 |
| Work-item **detail page** (real data) | DONE | #60; redesign spec `2026-06-30` (real header/description/tasks/deps/rail; other sections are clean placeholders) |
| **Proposals kernel + single write path** (PR1) | DONE | #91, `routes/proposals.ts`, migration `0007` |
| **Agent runtime + 5 retrieval tools** (PR2) | DONE | #92, `agent/runtime.ts`, `routes/agent-chat.ts`, migration `0008` |
| **Review Inbox UI** (PR3) | DONE | #93, `boards/inbox/InboxScreen.tsx` |
| **Agent chat panel** (PR4) | DONE | #94, `agent-chat/AgentChatPanel.tsx` |
| Durable chat threads | DONE | #95, migration `0009` |
| **Memory brain** P1/P1b/P2a/P2b/P3a (store, agent-authored via Inbox, reflection→rules, 10% holdout, unified KB) | DONE | #96–#100, migrations `0010–0013`; `boards/memory/`, `data/memories/`, `data/memory-impact/` |

**REMAINING / OPEN (kernel `forge issue list`):**
- **PR21 Single Domain Platform Shell** — the only in_progress non-test epic; the launch container.
- Memory follow-ups: `p2b-analysis-union-run…` (P0 analysis task), `authority-rrf-calibration-golden`,
  `pin-kb-holdout-semantics` (P1) — quality/measurement, not launch-blocking surfaces.
- Test-suite hardening epic + tasks (`test-suite-faster-stronger`, worker-budget, isolation) — CI health.

So: **the whole MVP feature set is built.** What's open is (a) unification/polish into one shell,
(b) memory measurement tuning, (c) test-suite/CI reliability.

---

## 3. Launch-readiness gap (ordered; top items flagged)

The features exist as slices; a "clean valuable product to launch" needs them stitched, wired, and
verified as one flow. Ordered by value-to-launch:

1. **[TOP] Finish PR21 — Single Domain Platform Shell.** One deployable domain where sign-in →
   workspace → workboard → detail → chat → inbox → memory all live under `/w/$workspace/...` with
   working nav, the "Ask agent" button wired to the panel (pr4-chat Task E lifts chat state to the
   shell), and the inbox deep-link (`?proposal=<id>`). This is the difference between "merged slices"
   and "an app you can hand someone." Epic is in_progress — verify its child tasks and close them.

2. **[TOP] End-to-end moat-loop verification in the real app** (not just unit tests): chat → propose
   → inbox diff → accept → board updates, against a live OpenRouter model + Neon, driven in a
   browser. The slices were each proven in isolation/mocked; the joined flow needs one honest
   screenshot-verified pass.

3. **[HIGH] Ontology UI parity with the shipped backend.** Backend has per-team statuses, the Task
   tier, Checks, and enriched Projects; confirm the workboard/detail surfaces actually expose them
   (Check checklist UI, per-team status columns, sub-task nesting, project container view). Any
   backend capability with no UI is invisible at launch.

4. **[HIGH] Detail-page placeholder cleanup.** Per `2026-06-30` spec the detail page ships REAL
   header/description/tasks/deps/rail with **clean placeholder empty-states** for Evidence/Connected/
   Plan/Meetings/Agent-conversations/Comments. Ensure placeholders read as intentional roadmap, not
   broken/dead — they are user-visible.

5. **[MED] Memory board + measurement polish.** P3a shipped unified knowledge + authority; the open
   `p2b-analysis-union` (P0) and calibration/holdout tasks make the "saved N edits" proof trustworthy.
   Valuable for the pitch, not a hard launch blocker.

6. **[MED] Test-suite/CI reliability** (`test-suite-faster-stronger` epic) — needed for confident
   shipping, parallel to product work.

---

## 4. Single highest-value next build item

**Finish PR21 — Single Domain Platform Shell** (`pr21-single-domain-platform-product-suite-a49`,
in_progress), executed together with the pr4-chat "wire the shell" tasks
(`docs/design/2026-07-14-agent-slice-pr4-chat-panel.md` Tasks D–E) and an end-to-end moat-loop
verification pass.

**Why:** every MVP feature is already merged; the only thing standing between "18 merged PRs" and "a
clean product to launch" is the single shell that unifies them and one verified end-to-end run of the
moat loop. It is the exact epic the team already opened and left in_progress — i.e. the decided next
step, not a new direction.

**Scope: M** (integration + wiring + verification of existing parts; small amounts of net-new UI for
nav/shell state and any ontology surfaces found missing in gap-item #3). Start by running
`forge issue show pr21-single-domain-platform-product-suite-a49` and listing its children to get the
exact remaining task list.

---

### Sources
- `docs/design/2026-07-13-agent-slice-v1-design.md` (§1 scope, §10 arc, §16 PR sequence) — the moat-loop decision
- `docs/design/2026-07-10-work-ontology-and-phasing-design.md` (§2.2 shape, §2.3 naming) — frozen ontology
- `docs/design/2026-07-14-agent-slice-pr4-chat-panel.md` — chat panel + shell wiring stance
- `docs/design/2026-07-12-proposals-queue-design.md` — proposals table/lifecycle
- `docs/design/2026-06-30-work-item-detail-redesign.md` — detail page real-vs-placeholder plan
- `git log` #58–#102; `forge issue list` / `--type epic`; `packages/db/migrations/0000–0013`
