# Component Sourcing Addendum — 10 founder-suggested resources + token/IP analysis (2026-06-18)

**Status:** Supplements `component-source-strategy-2026-06-17.md` and
`component-sourcing-matrix-2026-06-17.md`. Triggered by a founder list of 10
shadcn-ecosystem libraries + the question: *"does adopting pre-built blocks
reduce the tokens we spend, since they're mostly built out and we just
re-theme/configure?"*

---

## Founder directive (2026-06-18) — pro vs free is NOT a filter

Price does **not** decide whether a resource is worth using. If a component looks
good, we recreate it our own way on our OSS primitives — paid or not. License
decides only the **mechanism**, never the decision:

- **OSI (MIT / Apache):** we may *vendor the actual source* into `packages/ui*`
  (fastest path), then retoken to our oklch set.
- **Paid / "Pro" / non-OSI / unlicensed:** *recreate from the design* — build our
  own implementation from the **public rendered demo**. **The one rule we keep:
  never paste or feed their gated source into the repo or an agent** — recreate
  from what's rendered, not from their code. (UI *patterns* aren't copyrightable,
  so own-code recreation is clean; and several of these ToS — e.g. Shadcn Blocks,
  React Bits Pro — explicitly forbid AI/devtools extraction of their *source*, so
  working from the rendered design keeps us clean on both copyright **and**
  contract. We never bought their license, so we just don't touch their source.)

So the real filter is **design quality + fit to our surfaces + motion discipline**
— not price. The table below is re-scored on that basis.

## TL;DR

1. **Coverage was partial:** 5 of the 10 were already in the matrix; **5 were
   genuine gaps** (React Bits, Shadcn Studio, Tailark, Shadcn Space, Skiper UI) —
   now evaluated.
2. **Re-scored on design (not price), the recreate-worthy ones for our *app*
   surfaces are** Shadcn Studio, Shadcn Space, Shadcn UI Kit, and Shadcn Blocks'
   app subset (dashboard / shell / settings / data-table designs) — previously
   down-ranked only for being paid. See the shortlist.
3. **Factual correction (applied):** Aceternity is **not MIT** (folklore) — under
   the directive this only sets its lane to recreate-from-design, not whether we
   draw on it.
4. **Token reality:** recreation costs build tokens regardless, and that's an
   accepted cost. The only *source*-token shortcuts are the OSI lane (vendor +
   retoken) and *scaffold-then-gut* for layout (`sidebar-07`/`dashboard-01`).
   Everything paid, we recreate.
5. **One thing to avoid even as inspiration: Skiper UI** — its components are
   themselves reverse-engineered clones of other (often paid) libraries; recreate
   from the *original* sources, not from a copy-of-a-copy.

---

## Verdict table — re-scored on design value (license = mechanism only)

License/pricing all verified from primary sources + an adversarial pass. The
**Lane** column is just *how* we'd use it (vendor source vs recreate-from-design);
it is **not** a gate. The decision is in **Design value** + **Use it for**.

| # | Resource | Lane (mechanism) | Design value for OUR surfaces | Use it for |
|---|----------|------------------|-------------------------------|------------|
| 1 | **Shadcn Blocks** | recreate-from-design (paid) | Polished app shells / login / stat / pricing layouts (bulk is marketing) | **Recreate** dashboard/auth/stat layouts; skip spectacle |
| 2 | **React Bits** | vendor (MIT+CC) / recreate (Pro) | Decorative motion (backgrounds, text FX) — clashes with our motion gate | Recreate only a specific micro-interaction; else skip (motion gate) |
| 3 | **Shadcn Studio** | vendor (free MIT+CC) / recreate (Pro) | **Strong** Dashboard&App + Datatable + Bento blocks | **Recreate** for dashboard / data-table / settings |
| 4 | **Tailark** | vendor (free MIT) / recreate (Pro) | Marketing/landing sections (clean) | Only if we add a public marketing page |
| 5 | **Aceternity** | recreate-from-design (proprietary) | Spectacle/marketing motion | Recreate an occasional hero only; @magicui covers micro |
| 6 | **Shadcn Space** | vendor (free MIT) / recreate (Pro) | **Good** dashboard shells + multi-column sidebars | **Recreate** for shell / sidebar / dashboard |
| 7 | **Magic UI** | vendor (core MIT) / recreate (Pro) | Number Ticker, Bento (in-app); rest decorative; Pro = marketing | **Vendor** core subset (already in); recreate Pro only for a marketing page |
| 8 | **Shadcn UI Kit** | recreate-from-design (paid; free repo unlicensed) | **Cohesive, complete** admin dashboards + app templates | **Recreate** — best full admin/dashboard template reference |
| 9 | **Skiper UI** | avoid | Decorative; **itself reverse-engineered** from other libs | **Avoid** — go to the original sources it cloned |
| 10 | **UI Layouts** | vendor (free MIT) / recreate (Pro) | Form primitives (datetime/multi-select/file/phone) + decorative dups | **Vendor** the MIT form primitives we lack; recreate Pro blocks if the design wins |

### Recreate-worthy shortlist (by our surface)

- **Home / dashboard:** Shadcn Studio, Shadcn UI Kit, Shadcn Space (dashboard
  shells), Shadcn Blocks (stat/app blocks) — recreate the strongest layouts.
- **Shell / sidebar:** Shadcn Space (multi-column sidebars), Shadcn UI Kit; still
  scaffold from `sidebar-07` (MIT) and retoken.
- **Settings / forms:** vendor missing primitives from **UI Layouts** (MIT) +
  @originui/@diceui (already in); recreate Shadcn Studio's settings layouts.
- **Data tables:** recreate Shadcn Studio's datatable design **on our decided
  engine** (TanStack Table v8 + dnd-kit) — design from them, mechanics ours.
- **Charts:** unchanged — @evilcharts + Recharts (no new resource beats these).
- **Avoid as inspiration:** Skiper UI (copy-of-a-copy); the spectacle/marketing
  motion tiers across all of them (our `prefers-reduced-motion` gate).

---

## The token question, answered

**You're half-right — here's which half.** "A built-out block is cheaper than
hand-building" is sound *for the right surface*. Split cleanly:

**YES — lean into blocks where it pays:** *layout scaffolding* on token-light,
structural surfaces, from **clean-MIT** sources. We already do exactly this —
`sidebar-07` + `dashboard-01` installed as a throwaway skeleton for the AppShell,
then retokened and gutted (matrix line 25). Keep using it. (Your list also
*drove* a real correction — Aceternity, below — so the exercise paid off.)

**RECREATE (no source shortcut — accepted cost, NOT a skip):**
- **Paywalled app blocks** with good designs (Shadcn Blocks, Shadcn Studio/Space
  Pro, Shadcn UI Kit, UI Layouts Pro) — no source to vendor, so we rebuild from
  the rendered demo on our own primitives. That costs build tokens; per the
  directive that's the accepted price of getting the design we want — not a reason
  to skip.

**SKIP on FIT (not price):**
- **Differentiated surfaces** (chat, canvas, workboard) are built on decided
  engines (AI Elements, React Flow + TipTap, TanStack Table + dnd-kit) — a generic
  block doesn't fit; recreate the *design* onto the engine, not the block.
- **Decorative / marketing content** (the bulk of the free *and* pro tiers here)
  targets a marketing surface we don't have and/or violates the motion gate
  (`prefers-reduced-motion` enforced). Skipped because it doesn't *fit*, not
  because it's paid.

**Two costs people conflate — keep them apart:**
1. **Build / LLM-token cost** (your actual question): scaffolding *does* cut this
   for layout. The offset is the retokening + gutting effort — real, but **we
   haven't measured it** — so treat scaffold-then-gut as a *probable* win for
   layout, not a guaranteed one, and **zero** for anything we can't legally
   vendor.
2. **Design-token *consistency*** (a different axis): importing pre-styled blocks
   risks oklch/spacing drift from our token set. That's *why* token-sensitive
   pieces (MetricCard, chart wrappers, suite grammar) are built in-house — a
   *consistency* decision that says nothing about build cost. Don't use it to
   argue either way on the token question.

**Bottom line:** *source-token* savings come only from the OSI lane (vendor +
retoken) and scaffold-then-gut for layout — the 6 OSS registries we already vendor
cover most of that. But under the directive that's not the deciding axis: for any
paid resource with a genuinely better design for our surfaces, we **recreate it**
and accept the build cost. The shortlist above is where that's worth doing.

## Recommended actions

- **Vendor (OSI, fastest):** the form primitives we lack from **UI Layouts (MIT)**
  (datetime-picker, multi-selector, file-upload, phone-input, *if* @originui/@diceui
  don't cover them); **Magic UI** core subset (already in).
- **Recreate from design (paid or not — per the directive):** when building Home/
  dashboard, shell/sidebar, and settings, pull layout inspiration from **Shadcn
  Studio, Shadcn UI Kit, Shadcn Space, Shadcn Blocks** and rebuild on our
  primitives/engines. Work from rendered demos; never paste their source.
- **Park:** **Tailark (MIT)** for a future public marketing page (not in scope).
- **Avoid:** **Skiper UI** (copy-of-a-copy — use its originals instead).
- **Matrix corrections (APPLIED in this change):** Aceternity free tier corrected
  from "free=MIT" to inspiration-only (proprietary; MIT is folklore) — matrix
  lines 16/195/267 + strategy line 89; Shadcn UI Kit free Starter clarified as
  no-license/all-rights-reserved; matrix points to this addendum for the 10.
  **Still TODO (optional):** add full matrix rows for Skiper UI (inspiration-only
  + IP-laundering caution), React Bits, Shadcn Studio, Shadcn Space, Tailark, UI
  Layouts with their verified lanes.
- **Add to the matrix:** a short "sourcing doctrine" — vendor-source only from the
  OSI lane + scaffold-then-gut for layout are the *source*-token shortcuts;
  everything else (incl. good paid designs) we **recreate** from the rendered
  design. The skip filter is *fit* (decorative/marketing, wrong surface), never
  price.
- **Don't buy** Pro tiers — the recreate-from-design path means we never need a
  license; buying would only matter if we wanted their literal source, which we
  deliberately avoid.

## Surface gaps the sweep also surfaced (separate from the 10)

Unmapped in the matrix, worth their own rows later: **Settings/preferences**,
**MCP/connector catalog UI** (a major DESIGN §1 feature), **auth/onboarding**
(Clerk flows), **notifications/mentions**, **global Cmd+K search**, **files/R2**.

## Primary sources

License/pricing per resource verified against each site's own license + pricing
pages, GitHub `LICENSE` files (raw), and npm — then re-checked by an adversarial
pass. Key proofs: Aceternity `ui.aceternity.com/terms` ("all rights reserved") +
GitHub org has no licensed component repo; Shadcn UI Kit free repo
`bundui/shadcn-admin-dashboard-free` → GitHub API `license: null`; React Bits /
Shadcn Studio `LICENSE.md` → MIT + Commons Clause; Tailark / Shadcn Space / UI
Layouts → clean MIT repos; Shadcn Blocks `shadcnblocks.com/license` → proprietary.
