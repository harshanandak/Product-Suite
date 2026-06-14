# Stack Evaluation — Next.js→Vite/TanStack, Vercel→Cloudflare

Date: 2026-06-11
Companion to: `plan-evaluation-2026-06-11.md`, `user-flows-evaluation-2026-06-11.md`
Question: should the platform shell move off Next.js (to Vite or TanStack Start), and off Vercel (to Cloudflare)?

> **Status: direction accepted by founder (2026-06-11).** Selected: Vite SPA + TanStack Router (library) + Clerk GA React SDK; Cloudflare for shell assets and Hono platform API; Durable Objects evaluated inside the realtime-convergence decision; meeting-api and agent-core stay on Railway. To be formalized in the pre-PR21 docs-only decision slice.

## Why this is the right moment to ask

Two decisions already made make a framework/host switch uniquely cheap right now:

1. **Full UI rebuild from scratch** (founder decision, user-flows doc §7.1). The dominant cost of a framework switch — porting every page — is already being paid. The marginal cost of changing the foundation under the rebuild is small; doing it later means paying the porting cost twice.
2. **Backend-mediated data access** (plan-evaluation §2). The shell becomes a pure client of platform APIs. That removes the main reason to want Next's server-side machinery (RSC, server actions, API routes) in the shell at all. The ~30 Next API routes must move into services anyway — PR12 (agent-core) already started that direction.

Also relevant: the repo already carries Next-specific pain — BlockSuite requires patched dependencies and special `next.config.ts` hacks; websockets don't run on Vercel (which is why hocuspocus lives on Railway).

## What Next.js + Vercel actually buys this product

- SSR/SEO: only needed for public/marketing pages, not the logged-in app.
- RSC/server actions: not needed once data access is backend-mediated.
- Middleware auth: replaced by route guards + API-layer verification.
- Vercel previews/zero-config: tied to Next; the moat disappears if Next goes.

For a logged-in B2B tool, Next is mostly complexity without payoff — and it is the least agent-legible of the options (RSC blurs the client/server line; a plain SPA + typed API is the easiest architecture for code agents and for your own autonomous agents, which call the same platform APIs as the UI).

## The four combinations

| Combo | Verdict |
| --- | --- |
| Next + Vercel (status quo) | Highest cost at scale, deepest lock-in, complexity stays. Only wins if the rebuild were cancelled. |
| Next + Cloudflare (OpenNext adapter) | Works in production and matured through the Next.js Adapter API (stable in Next 16.2, Mar 2026), but Workers runtime constraints + less-mature ISR = you keep Next's complexity AND gain adapter quirks. Weakest combination. |
| **Vite SPA + Cloudflare** | **Recommended.** All-stable dependencies, simplest mental model, cheapest, most agent-legible. |
| TanStack Start + Cloudflare | Most modern; official Cloudflare and Clerk partnerships. But Start is v1.0-RC (not yet stable) and `@clerk/tanstack-react-start` is explicitly beta/"not recommended for production yet". Two beta deps under the platform shell contradicts the de-risking posture. **Revisit at PR21a kickoff: if Start and the Clerk SDK are both 1.0-stable by then, a spike may be warranted** (adoption is non-breaking — Start builds on Router). |

## Recommended target architecture

- **App shell:** Vite + React 19 SPA using **TanStack Router as a library** (stable, fully typed routes — you get the best part of TanStack without betting on Start). Clerk via the GA `@clerk/clerk-react` SDK. meeting-web experience already proves Vite in this repo.
- **Platform API:** Hono on Cloudflare Workers (runtime-portable: Workers/Node/Bun — a hedge, not a lock-in). Absorbs the Next API routes that don't belong in agent-core. Supabase access through Hyperdrive or the supavisor transaction pooler.
- **Public/marketing site:** separate static site (Astro or plain) on Cloudflare — takes SEO/SSR off the app shell permanently.
- **Realtime:** Cloudflare natively supports websockets; **Durable Objects are a near-perfect fit for Yjs collaboration** (PartyKit/y-durableobjects pattern) and could eventually replace the hocuspocus Railway service — evaluate as part of the realtime-convergence PR, don't add a third path.
- **Python meeting-api and agent-core:** stay on Railway/containers. Long-running agent orchestration doesn't fit Workers CPU limits; Cloudflare Workflows/Containers exist but keep this simple for now.
- **R2** is already in the stack — same Cloudflare account, no change.
- **Vercel:** exit once the Next shell is retired.

## Costs and risks (honest list)

- SPA initial load: fine for a logged-in tool; mitigate with route-level code splitting (default in Vite + TanStack Router).
- Workers ≠ Node: some npm packages with Node-API deps need `nodejs_compat` or don't run — applies to the Hono API only, and Hono's portability means any stubborn endpoint can run on Railway instead.
- Postgres from Workers needs pooling discipline (Hyperdrive / transaction pooler) — already documented in PR20's connection runbook.
- Team relearn: Vite SPA is the *less* exotic direction; meeting-web already works this way.
- TanStack Start FOMO: adopting Router-as-library keeps the upgrade path open — Start is Router underneath.

## Sequencing

1. Record this decision in the docs-only pre-PR21 decision slice (alongside meeting-web retirement, canvas tech, backend-mediated access).
2. Build the new shell (PR21a) on the new stack from day one — never port the old shell to the new stack first.
3. Stand up the Hono platform API as part of PR21a; move Next API routes opportunistically as their UI surfaces are rebuilt.
4. Vercel stays serving the old shell until the new shell reaches parity gate, then DNS cutover, then Vercel exit.

## Sources

- TanStack Start v1 RC status: tanstack.com/blog/announcing-tanstack-start-v1
- TanStack Start on Workers: developers.cloudflare.com/workers/framework-guides/web-apps/tanstack-start/
- Cloudflare–TanStack partnership: tanstack.com/partners/cloudflare
- OpenNext Cloudflare adapter: opennext.js.org/cloudflare; blog.cloudflare.com/deploying-nextjs-apps-to-cloudflare-workers-with-the-opennext-adapter/
- Next.js Adapter API stability: nextjs.org/blog/nextjs-across-platforms
- Clerk TanStack Start SDK (beta): npmjs.com/package/@clerk/tanstack-react-start; clerk.com/docs/tanstack-react-start/getting-started/quickstart
