# Agent Slice v1 — Design

**Date:** 2026-07-13
**Status:** PROPOSED — awaiting founder review.
**Companions:** [proposals-queue](2026-07-12-proposals-queue-design.md), [actor-provenance](2026-07-12-actor-provenance-design.md) (both merged & built).

> **The thesis.** Every future capability is a policy change on **one pipeline** —
> `context → proposal → decision → applied write → outcome`. v1's job is **not to be
> smart**; it is to make that pipeline the *only* way anything writes, and to record
> everything that flows through it. **Models are rented and improving; the
> accumulated stream of this team's decisions is owned and compounding — it is both
> the moat and the future training set.**

**The one structural decision v1 must not get wrong** (§4): proposals apply through the
**same validated domain-command layer** the human UI uses — never "whatever the LLM
emitted" applied ad hoc. Get this right and autonomy, auto-accept, Code Mode, and
bulk-migration agents are all just new *proposal producers*; get it wrong and
agent-write and human-write logic fork, and unforking later touches every module.

---

## 1. Scope (v1) and non-goals

**v1 = the full in-app chat slice, propose-only.** A user chats in `platform-web`; the
agent reads the workboard and **proposes** work-item creates/edits; proposals land in a
**review inbox**; a human accepts; the accept **applies through the shared command
layer**. No auto-accept, no autonomous runs, no agent tokens.

**In scope:** chat panel · `/agent/chat` streaming runtime · 5 retrieval-first tools ·
`proposals` table + apply path · review inbox · decision-corpus capture.

**Explicit non-goals (deferred, each left as a named seam — see §10, §14):** auto-accept
policy engine · queued/autonomous `agent_runs` · agent tokens (not needed while
propose-only) · Code Mode / MCP / user-authored tools · embeddings/knowledge-graph
memory · eval/learning loop · multi-model routing · undo UI · per-tool permission UI.

---

## 2. Architecture (all in `platform-api` on Workers)

`POST /agent/chat` (Hono): mint an `agent_runs` row (`kind='chat'`, `status='running'`),
run **Vercel AI SDK v6 `streamText`** against **OpenRouter**, stream back via
`createUIMessageStream` / `toUIMessageStreamResponse`; `onFinish` closes the run.

- **No separate service, no MCP server, no agent token.** A propose-only chat turn is a
  few LLM round-trips — mostly OpenRouter I/O wait, which does not count against the
  Workers CPU limit. Containers/queues are deferred to autonomous `agent_run`s.
- **The agent's authority *is* the chatting user's** Clerk identity. Read tools run under
  the caller's `callerTenantIds`; proposals are stamped with the run + actor via the
  existing provenance layer. No agent-token mechanism is needed until agents write
  *directly* (auto-accept), which is deferred.
- **Frontend:** `platform-web` gets a `useChat` panel that **reuses `packages/ui-chat`**
  (`Conversation`, `Message`, `MessageContent`, …). Tool calls render as **proposal
  cards** (the AI SDK v6 human-in-the-loop pattern — §8).
- **Model registry:** follow `roadmap-web/src/lib/ai`'s `modelKey → OpenRouter model`
  pattern (one config value in v1; not a routing engine).

---

## 3. The agent loop is request-free

The loop is a pure function of **`(trigger_context, tools)`** — it must **not** assume an
attached HTTP user. v1 calls it from the `/agent/chat` handler; a future queue consumer
calls the *same* function for autonomous `agent_run`s. `agent_runs.kind` already
anticipates this. **Do not thread `Request`/`Response` into the loop** — pass a resolved
`{ tenantId, userId, trigger }` context in.

---

## 4. The single validated write path (THE non-negotiable seam)

Today the create/update **validation** (tenant/team/status ownership, parent cycle guard,
depth cap) lives inline in the Hono route handlers, and `recordWrite`/`actorAssignments`
only *stamp* provenance. For the moat, that validation must become a **shared
domain-command layer** both the human routes and the proposals-apply path call:

```text
createWorkItem(ctx, input)  // validates (ownership, depth, cycle) → recordWrite(actor)
updateWorkItem(ctx, id, patch)  // validates → stamped write
```

- **v1 extracts only what the agent proposes** — `work_items` create/update (+ the
  activity event). Other operations extract later; the *seam* is what matters now.
- The Hono routes become thin: parse → `command(ctx, input)`. The proposals-apply path
  calls the **same** `command(ctx, …)` with `ctx.actorType='agent', on_behalf_of=approver`.
- **Operations are stable, versioned identifiers** (`operation` in the proposals table),
  and **payloads are validated against the human write path's schema** — never applied raw.
- Consequence: a new proposal *producer* (autonomy, Code Mode, an import agent) inherits
  all validation, provenance, audit, and undo for free.

---

## 5. Proposals kernel (schema)

Builds the spec'd [proposals table](2026-07-12-proposals-queue-design.md), **plus the
decision-corpus capture fields** (§13) that must exist from day one:

```text
proposals(
  id uuid pk, tenant_id text, run_id uuid → agent_runs(id),
  target_type text, target_id uuid?, operation text, payload jsonb,   -- WHAT (validated at apply)
  rationale text, confidence real,
  risk_level text,                       -- placeholder for the future policy engine (§10); v1 = null/'unknown'
  status text,                           -- pending|accepted|accepted_with_edits|rejected|superseded|expired|applied
  decided_by text, decided_at timestamptz,
  edited_payload jsonb,                  -- the payload ACTUALLY applied — diff vs `payload` = the gold-label correction
  rejection_reason text,                 -- freetext (do NOT taxonomize yet)
  applied_write jsonb, target_version bigint,   -- optimistic concurrency (§14)
  -- generation metadata (so a swap/regression is measurable, not vibes):
  model_id text, prompt_version text, context_ref text,   -- context_ref → the retrieval set shown to the model
  -- provenance (companion): actor_type/actor_id/on_behalf_of
)
```

Indexes: `(tenant_id, status)` inbox · `(run_id)` batch · `(target_type, target_id)`
conflicts. **Append-only discipline:** never overwrite; every transition adds fields.

---

## 6. Tools — retrieval-first, behind a `ToolRegistry` seam

Five AI SDK v6 `tool()` definitions, registered through a clean **`ToolRegistry`
interface** so Code Mode / MCP / tool-search become *adapters* later, not rewrites:

| Tool | Kind | Notes |
|---|---|---|
| `list_work_items` | read | **compact projection** (id/title/status/priority), paginated — never full rows |
| `get_work_item` | read | one item, on drill-down |
| `search_items` | read | ranked hits via `retrieve(query)` (BM25 in v1) — **not** a dump |
| `propose_create` | write→proposal | inserts a `proposals` row; **never** writes real data |
| `propose_update` | write→proposal | inserts a `proposals` row |

- **Reads run under the caller's `callerTenantIds`**; `propose_*` tools **execute
  server-side in-process** and only ever write to `proposals`. The LLM emits JSON args;
  the tool's `execute` runs with the user's scope closed over from the Hono context.
- **Retrieval-first is the core context discipline** (≈ the "context-mode" principle):
  raw workboard data stays *out* of the model context; tools return compact,
  ranked, paginated results. This is the biggest efficiency lever and needs no infra.

---

## 7. Context & memory strategy (provider-neutral)

- **v1:** retrieval-first tools (§6) + a `retrieve(query)` seam backed by **BM25/FTS5**.
  **Log the retrieval set on every proposal** (`context_ref`) even though v1 doesn't
  learn from it — it is unrecoverable if not captured (§13).
- **Reuse, don't rebuild:** `roadmap-web/src/lib/ai` already has L2 summarizer, L3 topic
  clustering, L4 concept-extractor, an embeddings service, and a context-builder.
  Extract the reusable core to a shared package **as swappable adapters** behind
  `retrieve()` — not as v1 architecture (contexts get long and cheap; don't over-invest).
- **Compression tiers, embeddings, knowledge-graph are adapters, not the foundation.**

---

## 8. The proposal/HITL pattern (AI SDK v6, extended)

The AI SDK v6 human-in-the-loop cookbook renders **execute-less tool calls** as
approve/reject cards. We adopt that UI pattern but back it with the **persistent
proposals queue** (so review is multi-reviewer, batchable, provenance-stamped):

- `propose_*` tools **do** execute (insert a proposal) and return "proposed" to the model,
  so the chat can say "I've proposed X" and render a **card** linking to the inbox.
- The **inbox** (§ PR3) is the durable review surface; **accept** applies via §4 + §14.
- (Inline accept-in-chat is a later ergonomic layer over the same queue — not v1.)

---

## 9. Security

Agent never touches real data — proposals only. Read/propose scope = the chatting user's
own `callerTenantIds` (no agent token in v1). Zod-validate `(target_type, operation,
payload)` at **insert** *and* re-validate against the human write path at **apply** (§4).
Accept applies through `recordWrite` (`actor_type='agent'`, `on_behalf_of`=approver).

---

## 10. Capability evolution arc (and the v1 seams that unlock it)

**Ordered** (autonomy comes *after* auto-accept — an autonomous agent filling an inbox
nobody clears is negative value):

1. **propose-only chat** — v1.
2. **auto-accept policy tiers** (Jira-tight → Linear-default → Notion-loose) — becomes a
   change to the **`decide(proposal) → auto_accept | needs_review`** chokepoint, which
   **v1 implements as `return needs_review`**. Placeholder column: `risk_level`.
3. **queued autonomous `agent_run`s** — becomes "call the request-free loop (§3) from a
   queue consumer". Placeholders: `agent_runs.kind` enum + a `trigger` jsonb.
4. **memory-driven proactivity** — the compounding corpus (§13) drives suggestions.
5. **Code Mode / user-authored tools** — a `ToolRegistry` adapter (§12).

---

## 11. No lock-in (hard principle)

- Everything model-facing goes through **OpenRouter + a model registry** — chat,
  summarizer, **and embeddings** are swappable; no model hardcoded.
- **No vendor-specific features** — no Anthropic-only context tools, no
  proprietary-caching-as-dependency. (The Anthropic "code execution with MCP" pattern is
  *not* a dependency — only cross-vendor validation of the direction.)
- **Sorting rule:** anything compensating for a model *weakness* is a deletable adapter;
  anything encoding our *domain truth or trust policy* is core. So we don't over-build
  JSON-repair, few-shot coaxing, tool-search, or planning frameworks — models absorb
  these. We **do** version `model_id`/`prompt_version` per run so swaps are measured.

---

## 12. Code Mode & tool adapters (future, not v1)

Cloudflare **Code Mode** (LLM writes code calling a TS API of the tools; runs in a fresh
V8 isolate via the Worker Loader API; tools reached only through bindings so keys can't
leak) is the right upgrade **at the scale / user-authored-tools phase** — many tools,
multi-call orchestration, or running untrusted user tools. It composes with our AI SDK
(`agents/codemode/ai`) and is Cloudflare-native (we're already on Workers), but it's a
beta sandbox with unfinalized pricing and earns nothing at 5 propose-only tools.
**v1 leaves only the `ToolRegistry` interface;** Code Mode, MCP, and tool-search are
swappable adapters into it. Trigger: toolset grows large / orchestration multi-call-heavy
/ users author deployable tools. Watch: Worker Loader GA + pricing.

---

## 13. The decision corpus (the moat's fuel — capture in v1, learn later)

What *compounds* — and what a competitor bolting an LLM onto their tracker cannot
bootstrap — is the **per-tenant decision corpus**:

```text
(context shown) → (proposal) → (human verdict + edit delta) → (fate of the written row)
```

Team-specific priors ("this team always bumps estimates", "never auto-assign to X"). Our
provenance layer already traces agent-written rows to their fate. **v1 must capture,
append-only, or it is unrecoverable:**

- **Full agent-run transcripts** (messages + tool calls/results) — stored per `agent_run`.
- **The retrieval set** shown to the model — `context_ref` on each proposal.
- **`edited_payload`** — the payload actually applied; its diff vs `payload` is the
  highest-value gold-label correction.
- **Generation metadata** — `model_id`, `prompt_version`, `agent_run_id`.

**Build no learning loop in v1.** The only requirement: `(input context, proposal, label,
edit delta, outcome)` must be **reconstructible offline**.

---

## 14. Exactly-once apply (the trap)

Neon HTTP has no interactive transactions, so a naive "flip status, then write" can
double-apply or apply a stale payload. Apply is **one batched `sql.transaction`**:

1. `UPDATE proposals SET status='applied', … WHERE id=$1 AND status='pending' RETURNING *`
   (0 rows ⇒ already handled ⇒ no-op).
2. the target write, **conditioned on `target_version`** (`WHERE version = $expected`),
   through the §4 command layer — fails the whole batch (surfaced as 409) if either guard
   misses.

**Test a concurrent-accept case in PR1.** Secondary: sweep orphaned `running` runs
(`updated_at < now() - interval '10 min' → failed`).

---

## 15. YAGNI — the seam, not the machine

| Tempted to build | v1 leaves instead |
|---|---|
| policy/auto-accept engine | `risk_level` column + `decide()` stub returning `needs_review` |
| scheduler / queue | `agent_runs.kind` enum + `trigger` jsonb |
| Code Mode / MCP / isolates | `ToolRegistry` interface only |
| embeddings / KG / clustering | BM25 behind `retrieve(query)` — but **log retrieval sets** |
| eval / learning loop | §13 capture only |
| multi-model routing / fallbacks | one model-config value |
| undo machinery | provenance data suffices; defer the feature |
| bulk-proposal UI, per-tool permission UI | org-level review-everything flag |

---

## 16. PR sequence (each independently reviewable/testable)

1. **Proposals kernel + single write path** — `proposals` table + migration; extract
   `createWorkItem`/`updateWorkItem` domain commands (routes call them); accept/reject/
   apply endpoints with `target_version` optimistic check + **concurrent-accept test**.
   *(Provable by hand-inserting proposals.)*
2. **Agent runtime + 5 tools** — `/agent/chat` streaming, request-free loop, `agent_runs`
   lifecycle + transcript capture, `ToolRegistry`, `retrieve()` (BM25). **Moat loop
   provable here, pre-UI** via an eval script.
3. **Review inbox UI** — pending list, payload diff, accept/reject → apply.
4. **Chat panel** — `useChat` + `ui-chat`, proposal cards, link to inbox.

*(PR3 before PR4: the inbox is useful standalone and de-risks the apply UX before chat
polish.)*

---

## 17. Open questions

1. **Transcript storage** — a column on `agent_runs` (jsonb) vs a child `agent_messages`
   table. Lean child table (append-only, queryable) but confirm.
2. **Chat history persistence** — persist user chat threads (like the
   `ai-sdk-persistence-db` example) or ephemeral in v1? Recommend ephemeral chat, but
   **always persist the run transcript** (§13) regardless.
3. **`retrieve()` backend** — Postgres FTS vs a separate FTS5 — pick per infra simplicity.
4. **Model choice** for v1 (one OpenRouter model) — a cost/quality pick, swappable.
