# Component Source Strategy — Product Suite

**Date:** 2026-06-17 · **Status:** Accepted (license fork resolved 2026-06-17; kanban block-source to confirm at L1) · **Owner:** Harsha
**Method:** 10-agent research workflow with adversarial fact-verification (every material claim source-cited).

> Where this conflicts with an older doc, this wins for *component sourcing only*. Fold the final
> version into `DESIGN.md` §14 (Decision log) once the two forks below are confirmed.

---

## TL;DR

Standardize on a **single design system in `packages/ui`**, fed by these sources:

| Layer | Primary source | License | How |
|---|---|---|---|
| Base primitives | **shadcn/ui (new-york)** + Origin UI for gaps | MIT | already vendored; `shadcn add` |
| Chat / agent UI | **Vercel AI Elements** | **Apache-2.0** | `shadcn add` registry → vendored into `packages/ui-chat`, restyled to our tokens |
| Charts / data-viz | **shadcn Charts (Recharts v3)** | MIT | `shadcn add chart` → `packages/ui-charting` |
| Board blocks / tables / kanban / gantt | **engines we already chose** (TanStack Table v8 + Virtual, dnd-kit, custom Gantt); **Kibo UI / DiceUI** as block source/reference | MIT | per fork #2 |
| Suite grammar (ProposalCard, ProvenanceChip, AssigneePicker, RunProgress) | **build in-house** on shadcn + Origin UI | — | owned, never imported (DESIGN §5) |
| Inspiration-only (re-implement, never paste) | Open WebUI, Tailwind Plus/Catalyst, Aceternity Pro, shadcnblocks, shadcnuikit | paid / non-OSI | re-create design on our free primitives |

**One design system, one token set** (indigo/Geist/oklch). Everything is vendored as editable source we own.

---

## Corrections to common assumptions (verified)

1. **The Vercel AI SDK ships NO charts and NO rendered UI.** The `ai` package (v6, Apache-2.0) is a
   framework-agnostic backend toolkit (`generateText`/`streamText`/`generateObject`/`tool`/`Agent`).
   `@ai-sdk/react` provides **data hooks** (`useChat`/`useCompletion`/`useObject`) that return state and
   render nothing — you write all the JSX. *(npm `ai@latest`, `@ai-sdk/react@latest`)*
2. **The prebuilt AI components are a separate library — Vercel AI Elements** (npm `ai-elements`, a shadcn
   registry), not part of the AI SDK packages. **Even AI Elements ships zero chart components** — its ~48
   items are chat/agent/code/voice/workflow primitives. *(elements.ai-sdk.dev/api/registry/registry.json)*
3. **Open WebUI is not a React component source.** Its frontend is **Svelte 5 / SvelteKit** + Python/FastAPI
   (verified: `svelte ^5.53.10`, `@sveltejs/kit`; **no react/react-dom**). It is a full self-hosted app, not
   importable UI packages, under a **non-OSI** "Open WebUI License" (BSD-3 + branding clause since v0.6.6).
   Usable as **UX inspiration only**. *(open-webui package.json; docs.openwebui.com/license)*
4. **License precision:** AI Elements + the AI SDK are **Apache-2.0**, not MIT — permissive and OSI-approved
   (not copyleft), but retain the NOTICE/attribution. → **Fork #1.**

---

## Per-layer decisions (detail)

### Base primitives — shadcn/ui (MIT) + Origin UI (MIT)
Canonical base already in `packages/ui` (button, input, select, dialog, dropdown, tabs, sonner, tooltip,
card, table, avatar, badge, skeleton, command, scroll-area, separator, sheet, sidebar + theme provider).
Origin UI (MIT, shadcn-conventioned) fills missing form controls (combobox/tags/pickers) as needed.
**Rejected:** Tailwind Plus/Catalyst, shadcnblocks (paid → design only); raw Radix in app code (DESIGN §5 forbids).

### Chat / agent UI — Vercel AI Elements (Apache-2.0)
First-party fit with our committed **AI SDK v6 `useChat`** layer; built on shadcn primitives so our tokens
apply; the CLI copies editable `.tsx` source into the repo so we own it. Vendor only what we need
(Conversation, Message+Branch, PromptInput, Reasoning, Sources/InlineCitation, Tool, Task, Plan,
Confirmation, ModelSelector, Suggestion) **into `packages/ui-chat`** (override the default
`components/ai-elements/` dir) and restyle to canonical tokens. Covers L4 Home+Chat, L3 Agents
(run/thread/tool/reasoning), L2 meeting Q&A. **Fallback if MIT-only:** prompt-kit (MIT, but on AI SDK v5 →
version-compat work). **Rejected:** Open WebUI (Svelte, non-OSI, zero React).

### Charts / data-viz — shadcn Charts / Recharts v3 (MIT)
The only candidate **token-native** to this stack: CSS-variable theming with explicit oklch support, matching
the 5-step indigo chart scale already in `tokens.css`. Copy-paste code we own, no Recharts lock-in. Covers
KPI sparklines, line/area time-series, bar/stacked, funnels. Vendor into `packages/ui-charting`.
**AI-generated dashboards:** stream a JSON spec via `useObject`/tool output and render **our** Chart
components from it. **Per-component escape hatches only:** Chart.js (canvas) for very large/high-frequency
data; visx for a one-off bespoke viz. **Rejected as base:** Tremor, Nivo (parallel styling world → token drift).

### Board blocks / tables / kanban / gantt — engines decided; blocks via Kibo/DiceUI
Underlying engines stay as decided in **DESIGN §6**: TanStack Table v8 + Virtual, dnd-kit, custom Gantt.
Kibo UI (MIT) and DiceUI (MIT) supply blocks/reference. → **Fork #2** (adopt Kibo blocks vs. build on engines).
**Rejected:** paid block kits as source (design only); unverified Shoogle long-tail registries (inspiration).

### Suite grammar — build in-house (never import)
DESIGN §5 mandates these are owned. StatusPill, PhasePill, HealthBadge already exist; still **missing:
ProposalCard, ProvenanceChip, AssigneePicker, RunProgress.** AI Elements' Sources/Tool/Confirmation inform
the *look* only — the review-queue/provenance contract is proprietary.

---

## IP guardrail (two tiers)

- **(A) Use directly — permissive/OSI, vendor editable source with attribution:** shadcn/ui, Origin UI,
  Kibo UI, DiceUI, prompt-kit, shadcn Charts/Recharts, TanStack Table (all MIT); **AI Elements + AI SDK
  (Apache-2.0** — keep the NOTICE).
- **(B) Design-inspiration only — re-implement on our free primitives, never paste source:** Tailwind
  Plus/Catalyst ($299), Aceternity ($199 Pro; **free tier also proprietary — NOT MIT, inspiration-only**, corrected 2026-06-18), shadcnblocks
  ($79), shadcnuikit (paid), **Open WebUI** (non-OSI + Svelte).

No paid/proprietary verbatim source enters the codebase.

---

## Forks to confirm

1. ~~**License policy — is Apache-2.0 acceptable?**~~ **RESOLVED 2026-06-17: yes.** Apache-2.0 (permissive,
   OSI, non-copyleft) is accepted for AI Elements + the AI SDK; retain the NOTICE/attribution. prompt-kit
   (MIT) is no longer needed as a fallback.
2. **Kanban/gantt source.** Build on the already-decided engines (dnd-kit + custom Gantt) and use Kibo UI as
   *visual reference only*, **or** vendor Kibo UI's kanban/gantt blocks directly. *Recommended: build on
   engines, Kibo as reference* — avoids two kanban implementations and Kibo's post-acquisition governance risk
   (acquired by Shadcnblocks, Oct 2025; pin version if vendored).

## Other open questions
- Confirm cross-package `shadcn add` writes into `packages/ui*` (override default output dir); `components.json`
  resolves for the install.
- AI SDK v6 transport in Vite + TanStack Router (examples assume Next.js `/api/chat` + `DefaultChatTransport`).
- `@ai-sdk/react` peerDep pins React `^18 || ~19.0.1 || ~19.1.2 || ^19.2.1` — verify our React 19 patch.
- AI Elements' Web Preview pulls `v0-sdk` — include or skip.

## Maps to package stubs
`packages/ui` (primitives + suite grammar) · `packages/ui-chat` (AI Elements) · `packages/ui-charting`
(shadcn Charts) · `packages/ui-meeting`, `ui-planning`, `ui-canvas` (board blocks on decided engines).
