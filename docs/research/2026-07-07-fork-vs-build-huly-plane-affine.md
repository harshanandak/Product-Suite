# Fork vs. build — can we base Product-Suite on Huly, Plane, or Affine?

Date: 2026-07-07 · Question: instead of building Product-Suite from scratch, take an
existing OSS suite (Huly / Plane / Affine), "change everything to our style," and
ship that as our product — since we're going open-source anyway.

**Verdict: don't fork any of them as the base. Harvest specific parts.** The reasons
are license, stack collision with our Cloudflare + Neon + Clerk + React + `contracts`
decision, and the fact that "change everything the way we need" *maximizes* the
maintenance tax of a fork rather than minimizing build effort. This mirrors the
[Meetly assessment](2026-07-05-meetily-fit-assessment.md) conclusion: narrow harvest,
not fork.

## Verified facts (from the repos, 2026-07-07)

| | Huly ([hcengineering/platform](https://github.com/hcengineering/platform)) | Plane ([makeplane/plane](https://github.com/makeplane/plane)) | Affine ([toeverything/AFFiNE](https://github.com/toeverything/AFFiNE)) |
|---|---|---|---|
| **License** | **EPL-2.0** (weak/file-level copyleft) | **AGPL-3.0** (strong network copyleft) | Mixed — two LICENSE files; BlockSuite editor is MIT, server portion more restrictive (verify before relying) |
| **Frontend** | Svelte (33.5%) + TypeScript (61.5%) | React (React Router + Vite) | React + Electron (desktop) |
| **Backend** | Custom "Platform" transactor framework (TS), tiny Rust/Go | **Django (Python)** + Node live-server | Rust core (NestJS/GraphQL server) |
| **Database** | **MongoDB** + Elasticsearch (search) + MinIO (files) | **Postgres** + Redis | Rust CRDT engine (OctoBase / y-octo / Yjs), local-first |
| **Category** | All-in-one: Tracker, CRM, HRM, ATS, Chat, virtual office | Project management: Work Items, Cycles, Modules, Views, Pages, Analytics | Docs + whiteboard knowledge base (Notion + Miro) — **not PM** |
| **Scale** | ~8,900 commits, 26.8k★ | ~7,000 commits, 54k★ | ~11,400 commits, 70.2k★ |
| **Momentum signal** | **Hosted Huly service shutting down ~July 20** (hosting no longer funded) | Healthy, active | Healthy, active — but wrong category |

## Our target stack (what any fork must be bent to match)

- **Runtime:** Cloudflare Workers (+ Durable Objects for realtime, R2 for storage, Cron for jobs)
- **Database:** Neon Postgres — single DB, no second datastore
- **Auth:** Clerk (behind a thin wrapper; app carries no auth logic)
- **Frontend:** React + shadcn/ui (`apps/platform-web`)
- **Domain model:** framework-neutral `packages/contracts` (already relocated: Phase / TaskStatus / WorkItem / Task, etc.)
- **Differentiator:** AI-native — meeting → workboard → agent pipeline, buddy, contracts feeding agents.

## Stack-collision analysis

### Huly — collides on almost every axis
- **MongoDB** vs our single-Neon-Postgres rule; **Elasticsearch + MinIO** add two more datastores we explicitly don't want.
- **Svelte** front-end vs our React/shadcn. "Change everything to our style" here literally means rewriting the entire UI in a different framework.
- Bespoke transactor/Platform runtime assumes a long-lived Node server — not a Workers model.
- **Hosted service shutdown (July 20)** is a yellow flag on project funding/momentum.
- Net: adopting Huly = swap the DB layer + rewrite the front-end language + inherit a custom framework. That is a rewrite fighting the framework, not "tuning."

### Plane — closest domain match, but two hard blocks
- **Domain fit is real**: issues / cycles / modules ≈ our workboard. Postgres aligns with Neon.
- **Block 1 — runtime**: Django (Python) cannot run on Cloudflare Workers; it needs a container/VM/managed host. Contradicts the Cloudflare-first decision.
- **Block 2 — license**: **AGPL-3.0 §13** requires that when you run a *modified* version as a network service, you offer the Corresponding Source to those interacting network users at no charge — a per-user offer, not mandatory public publication. Even "we're open-source anyway" doesn't make this frictionless: AGPL dictates *how* you must license, is generally incompatible with keeping a linked component proprietary, and complicates a mixed commercial SaaS. A deliberate legal-architecture decision, not a formality.
- Net: right shape, wrong runtime + a copyleft that constrains the business model.

### Affine — wrong category + heaviest engine
- It's a **docs/whiteboard** tool, not project management. No issues/cycles/sprints to inherit.
- Ships a **Rust local-first CRDT sync engine** (OctoBase/y-octo/Yjs) + Electron desktop — enormous complexity we'd inherit and not need for a cloud-first PM suite.
- The genuinely reusable piece is **BlockSuite** (its MIT editor), usable as a *component*, not a base.

## Why "fork and change everything" is harder than building, not easier

1. **Reskinning is the cheap 10%.** Colors/logos/layout are fast. The expensive 90% is comprehending an 8,000–11,000-commit codebase written by others, then ripping out its **auth** to insert Clerk, its **DB** to point at Neon, and its **infra assumptions** to run on Cloudflare.
2. **Divergence tax is permanent.** A fork you heavily modify must still absorb upstream security patches — each becomes a merge conflict against your changes. "Change everything the way we need" *maximizes* divergence, so it *maximizes* this tax forever.
3. **You abandon your own model.** `packages/contracts` is real, framework-neutral work. Forking means adopting their data model and bending our product to theirs.
4. **None is AI-native.** Our whole thesis (meeting→workboard→agent, buddy) is not what these are. Forking means bolting the AI layer against a human-first grain.

## Recommendation — harvest, don't fork

Keep building the thin, AI-native, Cloudflare+Neon+Clerk spine. Take specific parts:

1. **Plane → data-model reference.** Read its Postgres schema for issues / cycles / modules / views as a proven cross-check when authoring our Neon workboard tables. Study the model, not the code (avoids the AGPL/runtime traps entirely — reading a schema for inspiration is not derivation).
2. **BlockSuite (Affine's MIT editor) → drop-in component.** If/when we build a Pages/docs feature, evaluate BlockSuite as the rich block editor. That's a feature, not the base.
3. **Huly / Linear → UX north-stars.** Reference their tracker UX for polish; do not adopt Mongo/Svelte/framework.

## The one condition that would change this answer

If the goal were an **internal ops tool shipped fast**, with the AI-native + Cloudflare theses negotiable, then **self-hosting Plane as-is (unmodified)** for internal use is a legitimate "don't build PM from scratch" shortcut — AGPL is far less constraining for purely internal, unmodified deployment. But for a **commercial, AI-native, Cloudflare/Neon/Clerk** product where we "change everything," forking is more work than building. The current build path is correct.
