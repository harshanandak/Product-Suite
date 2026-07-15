# Thread Persistence — Transcript Contract + P1 Plan

> Grounded in external OSS research (Vercel AI SDK / `ai-chatbot`, assistant-ui, LangGraph/Mastra) + a Fable design review. Sequencing (Fable): **P1 → P3 (moat) → P2 (reliability).** This doc is P1 + the transcript contract everything hangs off.

## Why
The agent chat is ephemeral today (`useChat` in-memory; a hard refresh loses the thread). Make threads durable **without a second write path** — we already persist `agent_runs.transcript`, so a thread's history is *derived from its runs*, and proposals already link to runs. The durable artifact is the proposal; the thread just groups the runs that produced them.

## What exists today (verified)
- `agent_runs` (jsonb `transcript`, tenant-indexed); proposals FK `run_id`.
- `runtime.ts` `closeRun` persists `transcript = { messages: response.messages, steps }` in `onFinish` — i.e. **ModelMessage format, assistant/tool only (no user turn), unversioned.** That's insufficient to rehydrate `useChat`, which needs **UIMessages including user turns.**

---

## Part 1 — Transcript Contract v1 (the prerequisite)

**Format:** `UIMessage[]` (the `ai` package type), NOT ModelMessages.

**Delta semantics (Fable):** each run persists ONLY that turn's delta — the triggering **user message(s)** + the generated **assistant/tool message** — **never a full-conversation snapshot** (snapshots make concatenation O(n²)). Concatenating a thread's run deltas in `created_at` order reconstructs the full thread as `UIMessage[]`.

**Versioning (Fable):** add `transcript_version` (integer) to the persisted jsonb, value `1`. Legacy rows (the current ModelMessage/assistant-only shape) are `v0` and are treated as **unlinked** — they predate threads and belong to no thread, so the reader never has to parse them. The reader skips/ignores any `version !== 1`.

**Capture (grounded in AI SDK v6):** replace the bare `result.toUIMessageStreamResponse()` with:
```
result.toUIMessageStreamResponse({
  originalMessages: incomingMessages,      // prevents dup ids
  generateMessageId: () => crypto.randomUUID(),
  onFinish: ({ responseMessage }) => {
    // delta = [the new user turn from incomingMessages] + [responseMessage]
    // persist { version: 1, messages: delta, steps } to this run's transcript
  },
})
```
`onFinish` gives `messages` (full) and `responseMessage` (just the new assistant UIMessage). The user turn is the tail of `incomingMessages` not already persisted (in v1, the last user message — one run == one user turn). Keep `streamText.onError` closing the run `failed` with a null transcript. The `status='running'` one-way latch stays.

**Reconstruction (thread load):** `select transcript from agent_runs where thread_id = $1 and tenant_id = $2 and status='completed' and transcript->>'version' = '1' order by created_at` → `flatMap(t => t.messages)` → `UIMessage[]` → `useChat({ id: threadId, messages })`.

**Context cap (Fable):** the *model* prompt caps to the last **N turns** (config, e.g. 12) independently of what the UI renders — concatenation cost hits the prompt before the DB. Applied where messages are assembled for `streamText`.

---

## Part 2 — P1 implementation

### Schema (new migration)
- `chat_threads`: `id uuid pk`, `tenant_id uuid` (FK, indexed), `title text`, `linked_object jsonb null` (`{type,id,title}` — the panel's "Linked to"), `archived boolean default false` (**soft-delete day one, Fable**), `created_at`, `updated_at`. Index `(tenant_id, archived, updated_at desc)` for the list.
- `agent_runs.thread_id uuid null` (FK → chat_threads, indexed `(thread_id, created_at)`). Nullable so legacy/autonomous runs stay unlinked.
- Add `transcript_version` handling (in the jsonb per contract — no column needed).
- Hand-author SQL + journal + regenerate the snapshot chain from a clean checkout (see [[product-suite-drizzle-snapshot-drift]]).

### Backend (`platform-api`)
- **Server creates the thread — kill the first-message race structurally (Fable):** `POST /api/agent/chat` accepts an optional `thread_id`. If absent, the server **creates a `chat_threads` row (org-scoped, title from first ~60 chars of the first user message, linked_object from `context`) and returns its id** (as a data part / response header the client reads). Never client-create-then-save.
- `runtime.ts`: thread `thread_id` through `AgentRunContext`; stamp it on the `agent_runs` row; persist the UIMessage delta per the contract.
- `GET /api/agent/threads` → org-scoped, non-archived, newest first: `{ id, title, linked_object, updated_at }[]`.
- `GET /api/agent/threads/:id/messages` → the reconstructed `UIMessage[]` (per contract), tenant-checked (404 if not owned).
- `POST /api/agent/threads/:id/archive` (soft-delete). Reject cross-tenant (404).
- Title: **first ~60 chars of the first user message — NOT an LLM call (Fable: over-built).**

### Frontend (`platform-web`)
- `data/agent/threads` adapter (mirror the repository pattern; Clerk-bearer): `list()`, `messages(id)`, `archive(id)`.
- Thread list in the panel (assistant-ui-style): New thread + rows (title, linked chip, relative time); selecting loads `messages(id)` → `useChat({ id, messages })`.
- **Org-switch isolation (Fable — tenant boundary, not polish):** the list is keyed by org and `useChat` state is cleared on org change (the panel already remounts on `orgId` via its key — verify that also drops the selected-thread + list).
- New-thread flow: no id → server mints it → capture the returned `thread_id` → subsequent turns send it → the list refetches.

### Out of scope (deferred, sequenced AFTER P1)
- **P3 (next — the moat):** an org-scoped working-memory Store **derived from the disposition corpus** (accept/reject/edit signals on proposals, provenance-linked `fact → proposal_id/run_id`), **human-visible + revocable** (memory writes are agent writes → same review discipline). Postgres table + retrieval, **not** vector/graph infra.
- **P2 (last — reliability):** resumable streams via **Cloudflare Durable Objects, not Redis** (Workers-native, colocated; the broker is never the LLM-latency bottleneck; no second vendor). Interim that covers ~80%: client reconnect + refetch-thread-on-completion.
- Also deferred: thread search, rename, branching/forking, cross-device.

## Verification
- TDD; `typecheck` + `vitest` green both apps; pre-push. Migration applied on a clean checkout + snapshot chain regenerated.
- Tests for: the delta contract (round-trip a 2-run thread → concatenation reconstructs the UIMessages in order; v0 rows skipped); server-creates-thread-on-first-POST returns an id; tenant isolation on all thread routes (a foreign id → 404); org-switch clears the panel; context cap.
- **Fable adversarial review** before merge (tenant boundary, race, delta correctness, no second write path).
- Screenshot: the thread list + reloading a thread.
