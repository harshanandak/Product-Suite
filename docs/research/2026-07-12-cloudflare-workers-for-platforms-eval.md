# Cloudflare Workers for Platforms — Fit Evaluation for Product-Suite

**Date:** 2026-07-12
**Verdict:** Adopt at the **user-extensibility phase** — not now. Trigger below.
**Label key:** [VENDOR] = Cloudflare's own docs claim; [REASONING] = my analysis.

---

## PART A — The facts (all cited to developers.cloudflare.com)

### 1. What it is
[VENDOR] Workers for Platforms (WFP) lets you "run untrusted code written by your customers, or by AI, in a secure hosted sandbox. Each customer runs code in their own Worker." ([overview](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/))

Four components ([how-it-works](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/how-workers-for-platforms-works/)):
- **Dispatch namespace** — a container holding *all* customer Workers (best practice: one namespace, e.g. `production`, not one-per-customer). Provides unlimited Workers (no per-account script cap), isolation by default, dynamic invocation.
- **Dynamic dispatch Worker** — the routing entry point. Code decides which user Worker handles a request via `env.DISPATCHER.get("worker-name")`; can run auth/rate-limit/validation before customer code and sanitize responses.
- **User Workers** — the customer/AI-authored code.
- **Outbound Worker (optional)** — intercepts `fetch()` egress from user Workers to block/log/modify external calls.

[VENDOR] **Difference vs ordinary Workers:** ordinary Workers use static Routes and hit a per-account script limit; WFP dispatches to an *unlimited*, dynamically-uploaded set of Workers and adds untrusted-mode isolation. WFP vs Service bindings: bindings are for known internal Workers; WFP is for Workers "uploaded dynamically by your customers."

### 2. Isolation model
[VENDOR] ([worker-isolation](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/reference/worker-isolation/)) Namespaces default to **untrusted mode** = "strongest isolation," for when "your customers have control over the code." In untrusted mode: `request.cf` is unavailable; each Worker has an **isolated cache**; `caches.default` is disabled. "This mode ensures complete isolation between customer Workers, preventing any potential cross-tenant data access." Trusted mode (opt-in, for code you control) re-enables `request.cf` and shares cache.
[REASONING] The underlying execution primitive is still the standard Workers **V8 isolate** — WFP adds cache/`cf` isolation on top; it is not a per-tenant VM/container. Isolation is compute + cache scoped; it does **not** isolate your Postgres data (Neon is still shared, still needs query scoping).

### 3. Pricing — VERIFIED, decisive
[VENDOR] ([pricing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/platform/pricing/)) **$25/month** self-serve Paid plan (no longer Enterprise-only). Includes 20M requests/mo (+$0.30/M), 60M CPU-ms/mo (+$0.02/M), 1000 scripts (+$0.02/script). Only 1 request billed across dispatch→user→outbound chain. Custom limits let you cap per-customer CPU to prevent denial-of-wallet.
[REASONING] $25/mo fixed floor is cheap but **non-zero** — it breaks the "zero fixed floor" substrate constraint. Not a blocker at scale; is a (small) blocker for a zero-user pre-launch.

### 4. Limits
[VENDOR] Unlimited scripts ([limits](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/platform/limits/)); max 8 tags/script; gradual deployments unsupported (all-at-once). CPU: **max 30s CPU per invocation** (pricing table); wall-time = unlimited for HTTP while client connected, but **15 min** for Cron/Queue/DO-alarm invocations ([Workers limits](https://developers.cloudflare.com/workers/platform/limits/)).
[REASONING] User Workers inherit the ordinary Workers execution envelope. The same "no long-running agent-loop on Workers" constraint applies to user Workers — WFP does not lift it.

### 5. Canonical use case
[VENDOR] "Build a multi-tenant platform that runs untrusted code" — SaaS platforms letting *their customers* (or AI) deploy code: vibe-coding platforms, programmable platforms, per-customer extensions. Reference architectures cited are all "programmable platforms" and "AI vibe coding platform."

---

## PART B — Fit against the three candidate use cases

### 1. Per-tenant isolation of the app/API *now* → **NO (overkill, and wrong layer)**
[REASONING] WFP isolates *untrusted, customer-authored* compute. Our app/API code is **trusted** — we write it. Running our own single Hono app through dynamic dispatch buys nothing: it does not isolate the thing that actually holds tenant data (Neon Postgres), which still requires `callerTenantIds` query scoping regardless. You'd keep the DB-layer scoping *and* add dispatch complexity. Query-level scoping is working and tested; noisy-neighbor at zero users is a non-problem. Overkill.

### 2. User-extensibility north star (running USER-defined code/skills/gates) → **YES — this is literally its sweet spot**
[REASONING] "Let your customers deploy code, safely isolated" *is* WFP's product definition, and it maps 1:1 onto the north star of "users author their own gates/skills/workflow." Untrusted mode + outbound Worker (egress control) + custom CPU limits are exactly the guardrails you need to run user-authored logic without it touching other tenants or running up your bill. **When needed:** only once users actually author *deployable executable code* — not for config-driven toggles/gates (those need no sandbox). This is the right tool the day "editable canonical sources" becomes "user-uploaded code."

### 3. Agent-run sandboxing vs Cloudflare Containers → **NO — Containers remains correct**
[REASONING] User Workers inherit the 30s-CPU / 15-min-wall envelope. Heavy multi-call agent loops exceed this — the exact constraint already recorded that pushed agent runs to Containers. WFP would reintroduce the limit it can't remove. Containers (a Node/container plane) is the right home; WFP is a worse fit here.

---

## PART C — Verdict

**Adopt at the user-extensibility phase, NOT now.**

- **Trigger that flips the decision:** the first feature where a *user authors and deploys their own executable logic* (a skill/gate/workflow as code, or AI-generated code) that must run server-side in isolation. Until then, gates/skills are config + our own code, which need no sandbox.
- **Strongest reason FOR:** it is the purpose-built, primary-sourced answer to the extensibility north star — a self-serve ($25/mo) sandbox for untrusted customer/AI code with per-tenant **compute/cache** isolation, egress control, and denial-of-wallet caps. (It isolates *execution and cache*, not data: shared Neon Postgres, our APIs, and any bindings still require `callerTenantIds` query scoping — WFP adds a compute boundary, it does not replace the data boundary.) No custom sandbox to build.
- **Strongest reason AGAINST:** it solves a problem we don't yet have (zero users, no user-authored code today) and does **not** replace DB-layer tenant scoping or lift the agent-loop CPU limit — so it earns its $25/mo floor only once real user-code extensibility ships.

**Revisit signals:** (a) product commits to user-deployable code; or (b) a compliance/security requirement demands compute-level tenant isolation beyond query scoping. Neither is true today.
