# Re-evaluation: Vercel AI SDK vs Mastra (2026-06-18)

**Status:** Decision confirmed (with two concrete adoption moves). Supplements
`docs/plans/tech-stack-evaluation-2026-06-12.md` §3a and `DESIGN.md` §10.
**Trigger:** Founder asked to re-verify the AI SDK decision after a YouTube
comparison ("AI SDK *or* Mastra?") argued the two operate at different layers
and the real questions are (1) how much AI infrastructure do you need, and
(2) do you want to own it.

---

## TL;DR

**Keep AI SDK as the foundation — the decision holds, and this research
reconfirms it.** Mastra is **built on top of** AI SDK, not a competitor to it
(verified: `@mastra/core` depends on `@ai-sdk/provider` v5+v6 and accepts
`@ai-sdk/*` model objects directly). So choosing AI SDK is *not* a bet against
Mastra — it keeps Mastra slottable later, exactly as our architecture already
intends.

The video's framework lands on a decision **we already made deliberately**: our
loop library is a swappable seam (Mastra / LangGraph-lib / Pydantic AI) because
run state lives in **our** Postgres. We answered "do we want to own it?" with a
documented *yes*, for reasons that still hold after this re-check.

**The honest reframe:** there is **less balance to strike than "adopt it
partially" implies.** Our specific constraints (Workers + $5 doctrine,
run-state-in-our-Postgres, TS+Python split, hybrid-RRF/halfvec retrieval) block
exactly the layers Mastra is *strongest* at (agent runtime, memory/RAG). What's
left for Mastra is the low-value, cheap-to-own slice (evals). So the accurate
one-liner is: **decision confirmed; our constraints block the parts of Mastra
that would have helped most — keep AI SDK, and only reconsider Mastra's agent
spine at L3 if a spike shows the approval path and the Workers bundle both clear.**

**One thing to keep open (not adopt):** keep Mastra as documented fallback #1
for the agent loop (already true) and attach a **concrete re-eval spike at L3**
before hand-rolling the durable approval spine (criteria below). Treat
`@mastra/evals` the same way — evaluate at L2/L3, don't pull it in now.

---

## The two questions, answered for *our* footprint

### Q1 — How much AI infrastructure do we need? **Heavy.**

| Capability | Need | State today |
|---|---|---|
| Agent runtime / tool-calling | heavy | **partly built**: `services/agent-core` is a tested, model-agnostic `executeTaskPlan` engine (plan validation, retry, cancel, timeout guards, dep resolution) with a dependency-injected tool executor — but the AI-SDK wiring / agent worker that drives it is not built; its only current caller is the legacy `roadmap-web` adapter (`src/lib/ai/agent-core-adapter.ts`). **L3 should extend this service boundary + its tests, not rebuild it.** |
| Multi-tenant MCP gateway + catalog | heavy | not built — **bespoke differentiator** |
| Workspace/agent memory (tiered) | heavy | not built |
| Semantic recall / RAG (pgvector) | heavy | schema-only; live meeting retrieval is still lexical |
| Workflows / durable approval gates | heavy | not built — **decision-critical** |
| Chat transport / streaming | moderate | `packages/ui-chat` stub; AI Elements chosen for UI |
| Evals | light | planned golden-question loop, not built |
| Tracing / observability | light | Sentry free tier; no LLM-specific tooling |
| Browser-use / computer-use | none | out of scope |

This is squarely the "heavy infra" profile where the video says *consider a
framework*. So the question is real, not academic.

### Q2 — Do we want to own it? **Yes — already decided, with reasons that survive re-check.**

Our hard constraints (from `tech-stack-evaluation` + `DESIGN.md`) each map onto a
specific reason Mastra-as-the-agent-framework is a poor fit *right now*:

1. **Framework must NOT own run state.** All run state (runs, proposals,
   messages, step cursor, memory_version) must live in our Postgres so the loop
   stays swappable. Mastra bundles its own persistence (`mastra_*` tables); using
   it in state-external mode fights the framework.
2. **HITL approval is our core mechanic, so it gets the most scrutiny — but the
   original blocker is now stale.** The June-12 eval rejected Mastra citing
   *open* bugs on the agent↔suspendable-workflow **approval** path
   (`mastra#11015`/`#11283`). Both are now **closed** (Dec 2025), and Mastra
   ships a documented approval API (`approveToolCall` → `resumeStream`,
   `autoResumeSuspendedTools`, supervisor propagation). So this is **no longer a
   confirmed blocker** — the L3 spike must *empirically* re-test whether the
   approval path holds for our exact gate (gated tool → proposal → park →
   resume), not assume it's broken (recent usage friction exists, e.g.
   `mastra#12042`). It stays the highest-risk item precisely because it *is* the
   product.
3. **Cost doctrine = Cloudflare-first, no fixed platform bill.** Mastra *does*
   have a first-class Cloudflare Workers deployer (`@mastra/deployer-cloudflare`
   v1.1.45, deploys as a real `*.workers.dev` Worker) — but bundle size is the
   risk: issue **#16319** reports a 17.58 MiB *raw* build (`@mastra/core` 4.77
   MiB + `js-tiktoken` 2.28 MiB) blowing past the free (3 MB) and paid (10 MB)
   Worker limits *on a minimal agent*. Caveat: that's raw; CF limits are gzipped
   (~3–4× → maybe ~4–5 MB, possibly fits the $5 paid tier — **unverified**). The
   issue was soft-closed ("Closing for now", moved to Discord, no posted fix).
   Plus Workers CPU-time limits are a structural risk for multi-call agent loops
   — which Mastra itself routes to a standalone Node server, not Workers.
4. **TS + Python split.** Mastra is **TypeScript-only** (no Python SDK; verified
   — only an unrelated community `pymastra` clone exists). It could at most
   replace the TS agent layer; it can **never** touch the Python `meeting-api`.
   Python integrates only at the protocol boundary (MCP / HTTP).

---

## Where Mastra *might* help — the only slices our constraints leave open

- **Evals — the one cheap-to-own slice, but verify shape before pulling it in.**
  `@mastra/evals` Scorers + `runEvals(testCases)` (with `input`/`groundTruth`)
  is CI-time only — no Workers, no bundle, no run-state coupling, so the usual
  Mastra objections don't apply. **But two cautions, so this is a "consider at
  L2/L3", not an "adopt now":** (1) evals is a *light, unbuilt* need — there's
  nothing to integrate against yet, and pulling in Mastra's dependency surface +
  near-weekly breaking-minor cadence to avoid writing a recall@k script is the
  wrong trade for a light need; (2) **scorer-shape mismatch** — our
  golden-question loop is *retrieval recall over the `document_queries` log*,
  whereas the `answer-similarity` scorer compares *agent outputs* to ground
  truth (different shape). If anything fits it's `context-precision` /
  `context-relevance` — verify which before naming a scorer. Default expectation:
  a small hand-rolled recall@k harness is likely simpler than the dependency.
- **MCP — complement, not replace (if ever).** Mastra is both MCP client and
  server, but `MCPClient` is in-process/per-agent with no per-tenant connection
  scoping — i.e. *not* a multi-tenant gateway. Our bespoke gateway stays; a
  Mastra agent could be registered behind it, and `MCPServer` could expose a
  Mastra agent through it. No conflict — and no reason to adopt unless we already
  run Mastra agents.

## Where Mastra does **not** fit

- **Memory/RAG retrieval.** `@mastra/pg` *can* point at our existing Neon DB
  (connectionString or shared pool; HNSW supported; `disableInit`/`schemaName`
  to coexist) — but it does **not** support **hybrid RRF** or **halfvec**, which
  are our planned differentiators, nor our Tier-A "compiled context bundle"
  memory model. Adopting Mastra memory means giving those up. Not a fit.
- **Python `meeting-api`** — TS-only (see above).
- **Multi-tenant MCP gateway** — our differentiator; Mastra has no equivalent.
- **The agent loop under the strict Workers/$5 doctrine** — bundle + CPU-time
  risk; Mastra steers long runs to a Node server.

---

## Decision

1. **AI SDK v6 + OpenRouter stays the foundation** for the agent runtime and
   chat transport. Reconfirmed; no change.
2. **Do not adopt Mastra as the agent framework now** — for the constraint-
   specific reasons above (run-state ownership, Workers bundle/CPU vs cost
   doctrine, TS-only vs the Python half), and because the HITL approval path —
   our core mechanic — is unproven for our gate and must be spike-verified (its
   original blockers are now closed, so this is a "verify", not a known defect).
3. **Evaluate `@mastra/evals` at L2/L3 — do not pull it in now.** When the
   golden-question loop is actually built, first confirm the scorer *shape* fits
   retrieval-recall (likely `context-precision`/`context-relevance`, **not**
   `answer-similarity`); default to a small hand-rolled recall@k harness unless
   Mastra's scorers clearly win for a *light* need. Same "decide when there's
   something to integrate against" posture as the agent framework.
4. **Keep Mastra as documented fallback #1 for the agent loop** and add a
   **re-eval spike at L3**, *before* hand-rolling the durable approval spine:
   spend ~1 day wiring Mastra agent + suspend/resume against our real approval
   gate and measure — **(a)** compressed Workers bundle vs the 10 MB paid limit
   (`mastra build` + `wrangler deploy`), **(b)** whether the approval path
   actually holds for our gate end-to-end (the original blockers
   `mastra#11015/#11283` are now closed and `approveToolCall`/`resumeStream` are
   documented — verify, don't assume; cf. `mastra#12042`), **(c)** a CPU-time
   test of a multi-call loop on
   Workers, and **(d) supply-chain provenance** — pin a known-good, post-incident
   version, verify npm provenance/signatures and a clean `easy-day-js`-free
   dependency tree, and scan with Socket/Snyk before any install (see the
   supply-chain note below). If all four pass, Mastra may save the most expensive
   piece (the durable workflow spine). If any fails, hand-roll as planned.

This costs nothing today (the net-new AI lanes — agent worker, MCP gateway, RAG
wiring — are unstarted; the `agent-core` engine exists but its only caller is the
legacy app, and AI SDK is installed only in that legacy app being deleted) and is
the cheapest possible moment to have verified the seam.

## License note

Mastra core is **Apache-2.0** (operative for the framework), but it's a
**dual-license**: directories named `ee/` (enterprise auth) are
proprietary/source-available, not OSI. GitHub reports the repo as `NOASSERTION`
because `LICENSE.md` is a custom dual-license file. For us this is fine — we use
Clerk for auth and would not touch `ee/` — but "it's open source, no issue" is
slightly overstated: it's Apache-2.0 *except* the enterprise auth modules.

## Supply-chain note (npm scope takeover, 2026-06-17)

The day before this memo, the **entire `@mastra` npm scope was compromised**: a
hijacked former-contributor account republished ~143 packages — **including
`@mastra/core`** (~4M downloads/month) — each with a malicious `easy-day-js`
dependency (a `dayjs` clone that drops a crypto-stealing cross-platform RAT),
across an ~88-minute automated campaign. Root cause was a never-revoked
contributor account, not a flaw in Mastra's code. This does **not** change the
architectural verdict (we're not installing Mastra now), but it hardens the L3
spike gate: **never install `@mastra/*` without a known-good post-incident
version pin, npm provenance/signature verification, an `easy-day-js`-free lockfile
audit, and a Socket/Snyk scan.** Sources: [The Hacker
News](https://thehackernews.com/2026/06/144-mastra-npm-packages-compromised-via.html),
[Snyk](https://snyk.io/blog/a-forgotten-contributor-account-compromised-the-entire-mastra-npm-package-scope/),
[StepSecurity](https://www.stepsecurity.io/blog/mastra-npm-packages-compromised-using-easy-day-js),
[Socket](https://socket.dev/blog/mastra-npm-packages-compromised),
[SafeDep](https://safedep.io/mastra-npm-scope-takeover-supply-chain-attack/).

## Primary sources

- Mastra-on-AI-SDK: `mastra.ai/blog/using-ai-sdk-with-mastra`; `@mastra/core`
  npm deps (`@ai-sdk/provider-v5`/`-v6`).
- Cloudflare Workers deployer: `mastra.ai/reference/deployer/cloudflare`;
  `npmjs.com/package/@mastra/deployer-cloudflare` (v1.1.45).
- Bundle-size risk: `github.com/mastra-ai/mastra/issues/16319`.
- Postgres/pgvector: `mastra.ai/reference/vectors/pg`,
  `mastra.ai/reference/storage/postgresql` (no RRF/halfvec documented).
- MCP: `mastra.ai/docs/mcp/overview`. Evals: `mastra.ai/docs/evals/running-in-ci`.
- License: `raw.githubusercontent.com/mastra-ai/mastra/main/LICENSE.md`.
- Our constraints: `docs/plans/tech-stack-evaluation-2026-06-12.md` §3a (L45–70),
  `DESIGN.md` §7 / §10 / §12.
