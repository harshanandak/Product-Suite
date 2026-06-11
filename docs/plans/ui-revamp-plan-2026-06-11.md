# UI Revamp Plan — Product Suite Platform Shell

> **Supersession banner (2026-06-12): `DESIGN.md` is canonical.** This plan predates the final IA. Where it says **Meetings / Plan / Docs / Insights / Agents (five groups)**, build the canonical **four boards + Home** instead: Plan → **Workboard**, Docs → **Canvas board**, Insights → **folded into Home** (a meta-view, not a board), Meetings → **Meeting board**, Agents → **Agent board**. The build order, workstreams, and process rules below remain valid after this renaming; PR21a implements the DESIGN.md §2 navigation (workspace switcher → board dock → stable per-board sidebar), not the five-group switcher described here.

Date: 2026-06-11
Companion to: `plan-evaluation-2026-06-11.md`, `user-flows-evaluation-2026-06-11.md`, `stack-evaluation-2026-06-11.md`
Status: proposed (feeds the pre-PR21 decision slice and re-scoped PR21+)

## 0. Inputs already decided

- Full rebuild from scratch; one shell, one auth, one design language (founder, user-flows §7.1).
- Stack: Vite SPA + TanStack Router (library) + Clerk GA React SDK, deployed on Cloudflare; Hono platform API (stack-evaluation, accepted).
- IA: workspace is the container; two-level sidebar — persistent app switcher (Meetings, Plan, Docs, Insights, Agents) + contextual per-app options; 13 sub-apps collapse into 5 groups.
- Product gate: meeting → auto-tasks → assignment review seam (Flow 2).
- ~~Still open: canvas/editor technology~~ **Canvas technology: decided 2026-06-12** (tech-stack-evaluation §1) — React Flow for graph + freeform canvas; TipTap core for docs; BlockSuite exits with `patches/`. **Docs is no longer blocked or on the critical path** — it can land independently once shell and Meetings are ready.

## 1. Goals and quality bar

- A user always knows: which workspace, which app, what they can do here — answered by chrome, not memory.
- Every surface ships with **all four states designed**: loaded, loading (skeletons), empty (doubles as onboarding), error (recoverable). No screen merges without all four. This single rule kills the "three onboarding surfaces" problem — contextual empty states replace dedicated onboarding routes.
- Agent-native from day one: agent-proposed content (auto-tasks, drafts, run artifacts) has one consistent visual grammar everywhere — proposal badge, provenance link, accept/edit/reject.
- Perceived performance: route-level code splitting, optimistic updates for common writes, skeletons over spinners.
- Accessibility floor: keyboard-navigable nav and review queues, focus management in dialogs, WCAG AA contrast — cheap now, expensive later.

## 2. What we keep vs rebuild

Verified: both current apps already use Tailwind (roadmap on v4) + Radix UI primitives + lucide-react + framer-motion + recharts (`apps/roadmap-web/package.json`, `apps/meeting-web/package.json`).

- **Keep (foundation):** Tailwind v4, Radix primitives via shadcn/ui conventions, lucide icons, recharts for Insights, framer-motion for micro-interactions only.
- **Keep (logic):** data hooks, API/SDK calls, state machines inside `packages/ui-*` and app hooks — port them behind the new screens.
- **Rebuild (presentation):** every screen, the shell chrome, and all navigation. Old screens are reference material, not starting points.
- **Retire:** meeting-web UI entirely; roadmap-web screens as their replacements reach parity.

## 3. Workstream A — Design foundation (before any screen)

1. **`packages/ui` design system** (the one justified exception to the package freeze — it has 2+ consumers on day one: shell + marketing site):
   - Design tokens: color (light/dark), typography scale, spacing, radii, elevation, motion durations. Tailwind v4 `@theme` tokens so they're CSS-native.
   - Core components (shadcn-based, restyled to our identity): Button, Input, Select, Dialog, Dropdown, Tabs, Toast, Tooltip, Card, Table, Avatar, Badge, Skeleton, EmptyState, ErrorState.
   - Suite-specific components: ProposalCard (the agent/auto-task review grammar), ProvenanceChip (links to transcript segment / agent run), AssigneePicker, StatusPill, RunProgress.
2. **Visual identity decision**: ~~one short design exploration~~ **RESOLVED (2026-06-11)** — clean shadcn/ui style with indigo primary, Geist type, 0.5rem radius. Canonical tokens: `docs/design/tokens.css`; summary in `DESIGN.md` §5.
3. **Storybook (or Ladle) for `packages/ui`** — the design system must be reviewable in isolation, and it gives agents a legible component catalog to build screens from.

## 4. Workstream B — Shell chrome (PR21a)

The chrome is the product's skeleton; it ships before any app content:

- **Two-level sidebar**: workspace switcher (top) → app switcher (5 icons+labels) → contextual section listing the active app's options. Collapsible to icon rail.
- **Top bar**: breadcrumb (workspace / app / object), global search, notification/review-queue bell, user menu (Clerk).
- **Command palette (Cmd+K)**: navigation + actions from day one. Cheap to add now, defining for power users, and a natural agent-invocation surface later ("ask agent…" as a palette action).
- **Review queue drawer**: the single inbox for everything awaiting human approval (meeting auto-tasks, agent proposals, invites). One pattern, every producer feeds it.
- **Home digest** (default landing): what changed since last visit — new summaries, completed agent runs, moved items. v1 can be a simple grouped feed.
- Route skeleton (updated 2026-06-12 to the canonical DESIGN.md §1 shape): `/w/[workspace]` lands on **Home**; boards at `/w/[workspace]/{workboard|meetings|canvas|agents}` + workspace `/settings` + account-level `/settings`. There are no `/plan`, `/docs`, or `/insights` routes. Old paths 302 to their canonical equivalents.

## 5. Workstream C — Apps, in flow order

Build order follows the flows, not the org chart of old screens:

| Order | App | Screens (each with 4 states) | Flow it serves |
| --- | --- | --- | --- |
| 1 | **Meetings** | meetings list, meeting detail (player + transcript + summary), upload/record entry, action-items panel | Flow 1 first value |
| 2 | **Meeting detail seam (part of the Meetings app, NOT a separate app)** | summary → proposed tasks list → AssigneePicker w/ confidence → accept/edit/reject → "sent to Workboard" confirmation; triage queue for low-confidence. Lives inside the Meeting detail screen, rendered with `packages/ui-meeting` components (built in PR8); the Meeting backend (meeting-api) is its data source | Flow 2 (PR21 product gate) |
| 3 | **Plan** | work-items table/board, timeline view, item detail panel; absorbs execution/strategies as views or filters, not nav items | Flow 2 track half |
| 4 | **Agents** | run dashboard (parallel sessions, status, cost), run detail (artifacts, log), approval handoff into review queue; ambient "delegate" affordance in other apps lands here | Flows 3 + 6 |
| 5 | **Insights** | one dashboard composing analytics/insights/review/research as tabs/cards | Flow 5 support |
| 6 | **Docs** | gated on the canvas-tech decision; until then a doc list + read-only render of existing BlockSuite docs is acceptable | — |
| 7 | **Settings** | workspace members (+ skills/role tags powering auto-assignment), workspace config, account | Flow 4 |

Member skill/role tags (Settings) must land before or with the seam (order 2) — auto-assignment depends on them.

## 6. Process per screen

1. Low-fi wireframe (even ASCII/Excalidraw) → quick founder review — layout decisions are 10× cheaper before code.
2. Build with `packages/ui` components only; any new pattern goes into the design system first, never inline.
3. All four states + keyboard pass + dark mode check.
4. Instrument the flow's success events (PR23 contract: `first_value`, `meeting_to_workitem_created`, `agent_proposal_accepted`, …) in the same PR as the screen — never later.
5. Screenshot review against the reference class before merge.

## 7. Mapping to the PR plan (re-scoped PR21+)

- **PR21-pre (docs only)**: decisions — meeting-web retirement, IA, stack, canvas tech, this plan.
- **PR21a**: `packages/ui` foundation + new shell app scaffold (Vite/TanStack Router/Clerk) + chrome (§4) with stub apps. Deployed to Cloudflare on a preview domain alongside the old app.
- **PR21b**: Meetings app (§5 order 1) against meeting-api via SDK.
- **PR21c**: the seam + Plan v1 (§5 orders 2–3) — this carries the PR21 product gate.
- **PR21d**: Agents dashboard + review queue wiring (§5 order 4).
- **PR21e**: Insights + Settings + Home digest; parity check; DNS cutover; retire old shells.
- Docs app lands whenever the canvas decision is made; it is explicitly not on the cutover critical path.

## 8. Risks

- **Scope creep via parity**: the old app has 13 sub-apps; do NOT chase 1:1 parity. Parity target = the 5 groups and the flows, plus a "deprecated, still in old app" list reviewed at cutover.
- **Canvas decision drags**: time-box it; Docs read-only is an acceptable launch state.
- **Design-system bypass under deadline**: inline one-off styles are the death of revamps — enforce via review rule (no raw Radix/HTML form controls outside `packages/ui`).
- **Two shells in flight**: old app gets bugfixes only from PR21a onward; all feature work lands in the new shell.
