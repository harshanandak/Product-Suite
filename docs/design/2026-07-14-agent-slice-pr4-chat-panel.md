# Agent Slice PR4 — In-App Agent Chat Panel — Implementation Plan

**Goal:** Close the moat loop end-to-end in the product. Wire the shell's "Ask agent" button to a real streaming chat against `POST /api/agent/chat` (the PR2 runtime) using `useChat` (@ai-sdk/react) + the vendored AI Elements in `@product-suite/ui-chat`. A chat turn runs the agent, which reads the workboard and PROPOSES work-item changes into the PR1 queue; those proposals surface **inline in the transcript** and deep-link to the Review Inbox (PR3), where the human disposes of them. Chat is scratch space; the durable artifact is the proposal in the Inbox.

**Non-negotiable stance (Fable):** *agent proposes, human disposes.* The chat NEVER accepts/writes. Accept lives ONLY in the Inbox detail pane (the single, carefully-built "here is exactly what will change" surface). No inline accept in a chat bubble, ever.

---

## UX decisions (from Fable's guidance — build to these)

1. **Surface: right-side non-modal panel (~400px), shell-level.** The board/item stays visible and interactive while chatting. NOT a route (kills object context), NOT a modal sheet (blocks the scoped screen). The panel persists across in-workspace navigation and its chat state survives close/reopen **within the session** (lift the chat state to the shell; do not unmount it on close — hide it). Escape / X closes.

2. **Object-scoping: hidden server-side context + a visible chip.** The panel sends `context: { workspace, object?: { type, id, title } }` in the request body (derived from the current screen via `resolveScreen`). The SERVER folds this into the system prompt — do NOT inject it as a fake user message (pollutes the transcript; the agent may quote it back). UI: a small chip at the panel top — "Linked to: <title>" with an X to unlink. **Navigation does NOT switch the thread's context.** When the current screen differs from the thread's linked object, show a one-line affordance: "You're now viewing <X> — start a new thread here?" (Auto-switching silently rewrites what the agent knows — the trust-killer.)

3. **The proposal moment — inline proposal card, NO inline accept (the crux).** When a `propose_create` / `propose_update` tool call completes, render a distinct **ProposalCard** in the message stream: create/update badge, the proposed title, a 2–3 line summary (NOT the full diff), confidence if present, a "Pending review" pill, and ONE primary action: **"Review in Inbox →"** deep-linking to that proposal's detail. Immediate visible feedback that a real artifact was born; disposition happens in the Inbox only.

4. **Persistence: ephemeral in-memory thread (v1).** One live thread per panel session (`useChat` state only). Closing the panel keeps it; hard refresh loses it. Deferred: threads table, history/thread-list, resume, multi-thread, cross-device.

5. **States (priority order):** (a) **tool-call verbs** — map tool names to human labels: "Reading the board…", "Drafting a proposal…" — the #1 trust feature, ship it; (b) streaming text (AI Elements provides); (c) **403 no-org** → friendly empty-panel state ("Join or create an organization to use the agent"), NOT a chat error bubble; (d) network/stream error → inline error + Retry; (e) **Stop** while streaming; (f) empty state with 3 object-aware suggestion chips. Deferred: regenerate.

6. **Anti-patterns to avoid:** (1) inline accept in chat; (2) silent proposals (every proposal must be visibly born in the transcript — no Inbox items the user can't trace); (3) the agent speaking in the perfective ("I've updated X") — copy + system prompt must enforce "I've **proposed** … pending your review."

---

## Verified integration seams (scouted against the real code — do NOT re-assume)

- **Stream:** `runAgentChat` returns `result.toUIMessageStreamResponse()` (`agent/runtime.ts`), consumable by `useChat` directly. ✓
- **Proposal tool result is bare:** `propose_*` returns only `{ proposed: true, proposal_id } | { proposed: false, error }` (`agent/tools.ts`) — NO operation/title/summary. **Render the ProposalCard from the tool-call INPUT args** (title / patch / rationale — the propose_* arguments) **+ `proposal_id` from the output.** First confirm the propose_* input schema carries title (and rationale/confidence if available); if the input lacks a clean summary, enrich the tool RESULT minimally instead (small backend change, with tests).
- **System prompt is static:** `AGENT_SYSTEM_PROMPT` is a module constant passed verbatim (`agent/runtime.ts`). Object-scoping requires a small seam (see Task B).
- **`@ai-sdk/react` is NOT in `apps/platform-web`** — add it (+ `ai` for `DefaultChatTransport`), matching the versions already used (`ai@^6`, roadmap-web's `@ai-sdk/react@^3`).
- **Inbox has no deep-link param:** selection is internal `useState` in `InboxScreen`; the route has no `validateSearch`. Add `?proposal=<id>` (Task D).
- **No AI Elements usage exists to port.** roadmap-web hand-rolls its chat UI and is cookie-authed. Wire the vendored components fresh from `packages/ui-chat/src/components/ai-elements/*` (`conversation`, `message`, `prompt-input`) by subpath — study THEIR props + co-located tests. **Auth is Clerk bearer** (unlike roadmap-web): attach `Authorization: Bearer <token>` via the transport's async `headers`, using `useAuth().getToken()` — mirror `data/proposals/network-repository.ts` / `data/work-items/network-repository.ts`.

---

## Tasks (TDD; commit per task; `bun run typecheck` + `bun run vitest run` from each app)

### Task A — platform-web deps + transport plumbing
Add `@ai-sdk/react` + `ai` to `apps/platform-web/package.json`. Build a `createAgentChatTransport({ getToken, apiBase })` (in `src/data/agent/` mirroring the repository adapters) → `DefaultChatTransport({ api: '/api/agent/chat', headers: async () => bearer, body: () => ({ context }) })`. Test: headers attach the bearer; body carries the context.

### Task B — backend object-context seam (platform-api)
- `AgentRunContext` gains `scope?: { workspace: string; object?: { type: string; id: string; title: string } }`.
- `AGENT_SYSTEM_PROMPT` becomes a builder `buildSystemPrompt(scope?)` that appends a context line (e.g. "The user is currently viewing <type> \"<title>\" (id <id>) in workspace <workspace>.") when an object is present. Keep the existing base prompt; ADD/strengthen the tense rule: the agent proposes and must say "I've proposed … pending review", never "I've updated/created".
- `agent-chat.ts` reads `body.context` (validate shape; ignore unknown), passes it as `ctx.scope`.
- Tests: prompt includes the object line when scope present, omits when absent; route forwards `context`.

### Task C — the AgentChatPanel (platform-web)
- `src/agent-chat/AgentChatPanel.tsx`: right-side panel, `useChat({ transport })`, messages via AI Elements `Conversation`/`Message`, input via `PromptInput` with a Stop button while streaming. Markdown via `streamdown`.
- Tool-call rendering: a `toolLabel(name)` map ("list_work_items"→"Reading the board…", "search_items"→"Searching…", "propose_create"/"propose_update"→"Drafting a proposal…"); render in-progress tool parts as a subtle status line.
- `ProposalCard` (from the propose_* tool part): operation badge, title, 2–3 line summary, confidence, "Pending review" pill, "Review in Inbox →" link to `/w/$workspace/inbox?proposal=<id>`. NO accept control.
- States: empty (3 object-aware suggestion chips that seed the input), streaming, **403 → friendly org-required panel**, network error + Retry, Stop.
- "Linked to: <title>" chip + unlink; nav-changed "start a new thread here?" affordance.
- Ported look: AI Elements are already oklch-tokened; match the shell (border-border, bg-background/card, Geist). Screenshot-verify against the design system.

### Task D — inbox deep-link (platform-web)
`router.tsx`: add `validateSearch` on the inbox route for `{ proposal?: string }`. `InboxScreen`: read the search param and preselect that proposal id (fall back to first when absent/not-found). Test: `?proposal=<id>` selects that detail pane.

### Task E — wire the shell
`shell/TopBar.tsx`: replace the `toast(...)` placeholder with opening the panel (lift open-state + chat-state to the shell layout so it persists across nav / close-reopen). Pass the current screen's object (from `resolveScreen`) as the panel's linked object.

---

## Out of scope (defer, name them in the PR)
Thread persistence / history / thread-list / resume / multi-thread; inline accept (never); regenerate; cross-device; agent-token / auto-accept (still human-accepted via Inbox).

## Verification
- TDD per task; full `typecheck` + `vitest` green in both apps; pre-push validation.
- **Screenshot verification** of the panel via `bun run dev:fixtures` (empty state, streaming mock, a proposal card, 403 state) against the design system.
- **Fable adversarial review** of the flow (trust stance, tense copy, silent-proposal check, 403 path, deep-link correctness) before merge.
- Manual loop check: Ask agent → propose → card → Review in Inbox → the exact proposal preselected.

## Execution
Single Opus builder, solo (no parallel). Riskiest: (1) the ProposalCard rendering faithfully from the tool part; (2) Clerk-bearer transport; (3) panel state persistence across nav without remount. Hold for screenshot + Fable review.
