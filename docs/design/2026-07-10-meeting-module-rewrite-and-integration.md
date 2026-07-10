# Meeting Module — Rewrite & Deep Integration Brief

**Date:** 2026-07-10
**Status:** PROPOSED — awaiting founder review.
**Companion to:** [work-ontology-and-phasing-design](2026-07-10-work-ontology-and-phasing-design.md).
**Premise:** the meeting backend is a clean ~few-week rewrite, not a multi-month one — measured, not
guessed (see §1). This brief covers the *integration*, because the rewrite's whole value is making
meetings **native** to the platform instead of a stranger bolted onto it.

---

## 1. Why rewrite, not port — the measurement

The Python meeting-api (~5,400 LOC, ~40 handlers) was measured endpoint by endpoint. The only reason to
keep a container alive is long-running or stateful work, and it has almost none:

- **No** background threads, job workers, websockets, cron, or polling loops. The `jobs` table only
  stores completed-audit rows; nothing consumes them.
- **No** in-process audio DSP or ML. `numpy`, `torch`, `pydub`, `librosa`, `websockets` are in
  `requirements.txt` but **never imported**. Audio bytes go straight to the OpenAI/Sarvam APIs.
- Every DB query is request-scoped. The heavy work is awaiting an external STT/LLM HTTP call.

Only two things aren't a clean Workers port, and neither needs Railway:
1. The persistent Postgres pool → the Neon serverless HTTP driver (already used by the workboard).
2. One **15-line** in-memory speaker counter (`_speaker_tracker`) → a DB column or a Durable Object.

So: **rewrite to TypeScript on Workers, delete Railway.** The auth swap alone justifies it (§2). With
no users to protect, a throwaway Clerk↔Python auth bridge to *defer* a few-week rewrite is worse than
doing the rewrite — the bridge never needs to exist if the endpoints are Workers-native and reuse the
platform's Clerk verification.

---

## 2. The integration, ranked by value

Fable's ranking: **I1 (prerequisite) > I2 (the headline) > I5 > I3 > I4.** The one integration that
delivers ~80% of "deeply integrated" is **I2**; but **I1 is a prerequisite, not hygiene** — two tenancy
systems is a security bug, not a smaller version of integration.

### I1 — Unify tenancy and auth FIRST, totally

The meeting-api ships its **own** `users`, `tenants`, `organization_memberships`,
`organization_invitations`, `user_auth_identities`, and its own auth (a hand-rolled HMAC token *or* Neon
Auth JWKS — not Clerk). These **duplicate** the platform's Clerk-bridged tenancy.

**Decision: delete all five tables and both auth schemes. Meeting tables carry a `tenant_id` FK into the
platform's one tenancy, queried via `callerTenantIds` like everything else.**

Why first: if a meeting and a work item disagree on tenant, provenance links (I2) either break or leak
cross-tenant. Everything downstream needs stable tenant ids. This is not hygiene — it is the foundation.

Two riders before deleting the HMAC path:
- **(a) Find what consumes it.** It likely serves a *non-interactive* client — a recorder bot or an STT
  webhook — which has no browser to run Clerk. Unification must include a **machine-credential answer**:
  Clerk M2M, or a Worker-verified service token. Do not delete the HMAC path until its callers have a
  replacement.
- **(b) Live-tenant import.** If any real tenants exist, a one-time identity-mapping import. Architecture
  is unchanged either way.

### I2 — Meeting outputs: LINK + PROMOTE, not auto-become

This is the headline. `action_items`, `decisions`, `open_questions` are today meeting-only tables.
`work_items.source` already has a `meeting` value. The temptation is to make an extracted action item
*become* a work item automatically.

**Decision: do NOT auto-become. Extraction produces meeting-owned candidate rows; a cheap, bulk,
agent-suggested PROMOTE creates a `work_item` (source='meeting') with a provenance FK back to the
meeting/segment. Promotion is one-way: after promote, the work item is truth; the `action_item` stores
`work_item_id` and is done. No bidirectional sync.**

The two decisive reasons against auto-become:
1. **`work_items` require `team_id`, which is unknowable at extraction time.** A transcript doesn't know
   which team owns the follow-up.
2. **Triage-flooding destroys board trust.** Every "we should maybe…" in a transcript becoming a board
   item is noise, and a noisy board is an abandoned board.

`decisions` and `open_questions` are mostly meeting *knowledge* and are usually never promoted — they
stay as meeting records. Only action items routinely cross over.

**This does not contradict the settled ontology.** `source='meeting'` records *provenance after
promotion*; it never implied auto-creation.

**And it is the concrete prototype of the `proposals` queue:** extraction *is* a proposal; promote *is*
accept. The meeting module becomes the agent plane's first real customer by building exactly the flow
the plane needs, without waiting for the plane.

### I5 — All surviving tables to Drizzle; kill Alembic

On rewrite to TS, Drizzle owns the meeting tables (it already owns the workboard).

| Fate | Tables |
|---|---|
| **Deleted / absorbed** into platform tenancy | `users`, `tenants`, `organization_memberships`, `organization_invitations`, `user_auth_identities` |
| **Stay meeting-owned** (Drizzle) | `meetings`, `transcript_segments`, `summaries`, `chapter_summaries`, `meeting_state`, `audio_assets`, `meeting_links`, `chat_messages` |
| **Gains a column** | `action_items` + nullable `work_item_id` (the promote link) |
| **Fold later** into agent-plane logs | `agent_invocations`, `agent_responses` |

### I3 — Direct provider calls now, behind one thin `callModel()` seam

The summary/chat/buddy/voice agents make direct OpenAI/Sarvam calls today. **Keep that for the rewrite,
behind a single internal `callModel()` interface.** Do not couple two unbuilt things (the rewrite and
the model router). When the agent plane exists, meeting becomes its first consumer, and meeting's real
needs should *shape* the plane's design — but the rewrite must not block on an unbuilt router. No MCP
toolsets now.

### I4 — Keep meeting memory bounded

The summary-first pipeline + retrieval service works and is domain-specific; the platform's ctx/pgvector
memory is unbuilt. **Expose one interface — `searchMeetings(tenantId, query)` — that the future agent
plane calls as a tool.** Fold into shared memory only when a real cross-domain retrieval need appears.

---

## 3. The STOP list — where a clean boundary beats fusion

Over-integration is a real failure mode. The meeting module stays **bounded, with exactly two outward
edges: PROMOTE and SEARCH.** Deliberately do NOT:

- Unify memory now (I4 stays bounded).
- Build MCP toolsets or route through the model router now (I3 stays direct).
- Build bidirectional `action_item ↔ work_item` sync — promotion is one-way.
- Merge `summaries` / `chat_messages` into generic platform models — they are meeting-specific.
- Auto-create work items from extraction — promote is always a human/agent-reviewed step.

**Workers caveat, flagged not solved:** audio upload + STT ingestion may strain Workers limits (request
body size, CPU time). If a long-running ingestion path surfaces, **bound it outside Workers** (a queue,
an R2 upload + async transcribe) rather than re-architecting the module. This belongs to the STT
research track, not here.

---

## 4. Sequencing

1. **I1 — tenancy/auth unification** (+ machine-credential answer for the HMAC caller).
2. **I5 — schema to Drizzle** (surviving tables; `action_items.work_item_id` added).
3. **Core rewrite** — capture / transcribe / summarize on Workers, transcription first via Cloudflare
   Whisper ($0.03/hr), behind the `callModel()` seam.
4. **I2 — the promote flow** (extraction → candidate rows → promote → work item with provenance).
5. **platform-web surfaces** — meeting UI rebuilt in the one SPA; `apps/meeting-web` frozen then deleted
   at parity.
6. **Later** — I3 (agent plane) and I4 (memory fold) when those platforms exist.

This maps onto the phase plan without changing it: the rewrite replaces "meeting surfaces on the Python
API + auth bridge" in Phase 2, and **the promote flow gives the agent plane its first concrete
customer** in Phase 3.

---

## 5. What this changes about the companion design

- §4.8 phase plan: Phase 2 becomes "**rewrite meeting-api to Workers**, transcribe-first, no auth
  bridge" rather than "meeting surfaces against the Python API." Phase 3's proposals spine is
  **prototyped by the promote flow**, not a separate build.
- The "two-stack backend for ~2 quarters" tradeoff is **dropped** — the measurement showed the rewrite
  is small enough that keeping Python is the more expensive path.

---

## Open questions

1. **Who calls the HMAC auth path?** Must be identified before deletion — it likely needs a
   machine-credential replacement (recorder bot / STT webhook). Blocks I1.
2. **Do any live meeting tenants exist** that need the one-time identity-mapping import? If not, I1 is a
   clean delete.
3. **Audio ingestion vs Workers limits** — does any real recording exceed the request-body / CPU budget,
   forcing an R2-upload + async-transcribe path? Belongs to the STT/capture track.
