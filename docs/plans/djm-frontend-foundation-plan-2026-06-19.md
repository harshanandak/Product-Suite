# djm — Phase-0 frontend foundation: resolved questions + build plan (2026-06-19)

**Issue:** `product-suite-djm` (P1). Rewire `apps/platform-web` AppShell onto the
shadcn primitives in `packages/ui`, vendor Vercel AI Elements into
`packages/ui-chat` on our oklch tokens, finalize the token + reduced-motion
layer, and resolve the 3 open sourcing questions. Foundation for L1–L4 + Canvas.

**Status:** planning — awaiting approval before implementation.

---

## Part 1 — The 3 open questions, resolved (satisfies djm acceptance "3 Qs resolved & documented")

### Q1 — `shadcn add` in this bun-workspace monorepo
`shadcn add` is driven by the `components.json` of the dir you run it *from* (or
`-c/--cwd`), not the consuming app.

- **Primitives → `packages/ui`:** `cd packages/ui && bunx shadcn@latest add <name>`.
  Its `components.json` is already correct (aliases → our `#components/#lib/#hooks`,
  `utils → #lib/cn`); **zero config change**. Manually append the export to
  `src/index.ts` after each add (shadcn never edits the barrel).
- **AI Elements → `packages/ui-chat`:** today it's a `.jsx` bun-build stub.
  Restructure it shadcn-shaped first: `src/{components,lib,hooks}`, `package.json`
  `imports`/`exports` maps + `@product-suite/ui` workspace dep, a `tsconfig.json`
  (`moduleResolution: bundler`), and a `components.json` whose **local**
  aliases use `#imports` but **ui → `@product-suite/ui/components`** and
  **utils → `@product-suite/ui/lib/cn`**. Pre-seed primitive deps into
  `packages/ui` (`button button-group tooltip`), then
  `cd packages/ui-chat && bunx shadcn@latest add https://elements.ai-sdk.dev/api/registry/<item>.json`.
- **Guardrails:** never `--overwrite` suite-wide (AI Elements ships its own
  button/tooltip that differ from ours — dry-run flagged it); use `--dry-run` +
  `--diff` as the gate. shadcn issue #9239 reports a workspace-alias misroute, but
  it was filed against the classic `@scope/ui` alias style (**not** the
  `package.json#imports` flow we use) and isn't confirmed against our setup —
  treat it as a known risk the dry-run gate catches (misrouted files show before
  any write), not a blocker. *Mechanism + cross-workspace routing verified by two
  in-repo dry-runs.*

### Q2 — AI SDK v6 `useChat`/transport in Vite + TanStack Router (no Next route handlers)
Transport-driven; no Next.js needed.

- **Client** (`packages/ui-chat`, a `useWorkspaceChat` hook):
  `useChat({ transport: new DefaultChatTransport({ api: VITE_AGENT_API_URL+"/api/chat", headers: async () => ({ Authorization: \`Bearer ${await getToken()}\` }) }) })`.
  Headers is a `Resolvable` (awaited) — confirmed in the installed `ai@6.x`
  `dist/index.d.ts` (6.0.168 in the lockfile) — so the Clerk token is always
  fresh; no `credentials: include` (Bearer, not cookies).
- **Server** (Hono Worker): per-request `createOpenRouter({ apiKey: c.env... })`,
  Clerk `verifyToken` (networkless via `CLERK_JWT_KEY`), then
  `streamText({ model, messages: await convertToModelMessages(messages) }).toUIMessageStreamResponse()`
  returned straight as the Hono `Response`. The correct v6 result-method is
  **`toUIMessageStreamResponse()`** (v4's `toDataStreamResponse` is gone in v6;
  `createUIMessageStreamResponse` *also* exists in v6 but is a lower-level builder
  for hand-made streams — not what we want). `await convertToModelMessages` per the
  v6 docs (it can resolve file parts async). `hono/cors` scoped to the SPA origin,
  methods `POST, OPTIONS`, headers `Authorization, Content-Type`.
- **Pin `ai` to the exact version `@ai-sdk/react` hard-deps** so the workspace has
  one `ai` copy. `@ai-sdk/react` pins `ai` exactly (latest `3.0.210`→`6.0.208`);
  the lockfile currently resolves `@ai-sdk/react@3.0.170`→`ai@6.0.168`. **Confirm
  the pair against the lockfile at implementation and re-sync whenever
  `@ai-sdk/react` is bumped** (a floating `^6` installs two `ai` copies).
- **Scope boundary:** the `/api/chat` Hono handler lives in the **agent-core
  Worker = backend lane (L3, Codex's track)**. For djm (frontend) we vendor AI
  Elements + build the client transport hook against this documented contract,
  with a thin dev stub so the shell's chat renders/streams locally; the real
  handler lands in L3/L4.

### Q3 — React 19 peer pins
**No `overrides` required** — every *installed* lib's latest-stable React peer
already admits React 19 (verified via `npm view` 2026-06-19; React-pins verify
agent **confirmed**). Actions:

- Pin `ai` to the **exact version `@ai-sdk/react` depends on** (lockfile-verified;
  latest pair `3.0.210`→`6.0.208`, currently installed `3.0.170`→`6.0.168`).
- Tighten `react`/`react-dom` to `^19.2.1` in platform-web + packages/ui (the
  `@ai-sdk/react` peer is the narrowest: `^18 || ~19.0.1 || ~19.1.2 || ^19.2.1`).
- Consolidate `lucide-react` to `^1.21.0` — platform-web (`^1.8.0`) and
  packages/ui (`^1.20.0`) are already 1.x (minor bump); only legacy roadmap-web
  (`^0.562.0`) crosses a major, and it dies at Phase 2.
- Drop `framer-motion`, keep `motion` (same 12.x, current name).
- TipTap is **not** in the tree (legacy editor = BlockSuite); if ever adopted,
  require `@tiptap/react >= 3.0.1` (v2 admits React 19, but **v3.0.0** dropped it;
  the v3 line re-admits it only from 3.0.1).

---

## Part 2 — Build sequence (one PR off `feat/djm-frontend-foundation`)

1. **Pins + tokens + motion foundation.** Apply the Q3 pin table; finalize
   `tokens.css` `--sidebar-*` + `--chart-1..5` groups; wrap app root in
   `<MotionConfig reducedMotion="user">` + per-loop `useReducedMotion()` gates
   (AI Elements/@fluid loops aren't reduced-motion-safe by default).
2. **`packages/ui-chat` restructure + AI Elements vendor.** Shadcn-shape the
   package (Q1: `src/{components,lib,hooks}`, `package.json` `imports`/`exports`
   + `@product-suite/ui` dep, `tsconfig` `moduleResolution: bundler`,
   `components.json`). **Premise correction (2026-06-20):** ui-chat is NOT an
   unconsumed stub — roadmap-web (Next, via `transpilePackages`) imports
   `createChatRecordId`/`sortChatThreadsByUpdatedAt`/`ChatMessage`/`ChatThread`
   and meeting-web (Vite) imports `ChatMessageList`. No customers (pre-launch) and
   both legacy apps die at Phase 2, so the only risk is keeping the dev workspace
   green. **Approach = restructure in place:** switch `exports` to TS source (both
   consumers transpile TS), **preserve that legacy export surface**, retire
   `dist/`, add `@product-suite/ui-chat` to platform-web's vitest `deps.inline`,
   and verify roadmap-web + meeting-web still compile. Vendor
   `conversation`, `message`, `prompt-input`, `response`, `reasoning` on oklch
   tokens; build `useWorkspaceChat` (Q2 client) + thin dev-stub transport.
   **Coupling gate:** every vendored `.tsx` + the hook needs a colocated test in
   the same commit (module-load smoke tests for portal-heavy ones, as in PR #28);
   manual barrel export per add.
3. **AppShell rewire onto shadcn — incrementally, not big-bang.** The shell
   already has **11 colocated-tested** components (`ShellLayout`, `Sidebar`,
   `BoardDock`, `WorkspaceSwitcher`, `TopBar`, `CommandPalette`, `BoardScreen`,
   `SetupNotice`, `SignInPage`, `boards.ts`, `toast.ts`). Rewire **one component
   at a time** onto `sidebar-07`/`dashboard-01` scaffold + `command`, `sheet`,
   `resizable`, `scroll-area`, `tooltip`, breadcrumb, **updating each component's
   existing test in lockstep**. Deliver: `WorkspaceSwitcher` (avatar+name
   dropdown; switching workspace keeps the active board), `BoardDock`
   (always-visible, hover labels, active indigo `--sidebar-accent` pill,
   **board-switch crossfade — reduced-motion-gated**), **5 per-board `SidebarBody`
   variants**, `TopBar` (breadcrumb `workspace/app/object` + **global-search field
   that opens the Cmd+K palette, never a second search system** + review bell +
   UserMenu), `CommandPalette`, review-queue **bell + drawer**. `UserMenu` =
   shadcn `DropdownMenu` over Clerk session (not Clerk `UserButton`).
4. **Navigation law + a11y + states + perf.** Sidebars stable per board, never
   mutate on object click (object nav = content-area tabs); filters live in
   content; `Cmd+K` + `Cmd+1..5`; **focus trapped + restored in palette / dialogs
   / sheet** (§8); **visible focus states + WCAG AA contrast** (don't regress the
   open `7b6` dark-mode destructive-contrast item); **responsive: the dock
   collapses to a mobile bottom tab bar** — same 5 icons (§2); **route-level
   code-splitting** for board screens (lazy); all four states via
   `EmptyState`/`ErrorState`.
5. **Verify + green.** Light/dark + `prefers-reduced-motion` + mobile breakpoint
   verified via the preview tools; coupling-gate + full suite green. **After the
   pin bumps, build the legacy apps** (`ci:roadmap-web`, `ci:meeting-web`) to
   confirm no React/`ai` regression — note `ci:roadmap-web` **lint is already red
   (pre-existing**, legacy/Phase-2 deletion), so gate on *tests/build*, not legacy
   lint, and don't let it mask new failures.

**Acceptance (issue + review additions):** all 5 boards render with stable
sidebars (never mutate on object click); Cmd+K + Cmd+1..5 work; review-queue
bell+drawer present; **focus trapped/restored in palette+dialogs**; **responsive
mobile bottom tab bar**; **board screens route-split**; light/dark + reduced-motion
verified; AI Elements vendored into ui-chat on tokens; 3 Qs resolved+documented
(this doc); four states on the shell; **legacy apps still build**; suite green.

## Decision (signed off 2026-06-19): A-refined
Chat scope = **A-refined**: vendor AI Elements + build the **reusable
`useWorkspaceChat` hook** + validate the transport against a **test/dev-only mock**
(MSW or a tiny echo stream). **No deployed stub Worker.** The hook is wired to AI
SDK v6's standard `UIMessage` protocol (the real contract, reused unchanged in
L4); the real `/api/chat` Hono handler lands in L3. Plan **approved** — implement
incrementally per Part 2.

## Review log (2026-06-19)
Plan reviewed across 3 lenses before sign-off. **Technical correctness** (agent,
primary-source): *fix-then-ship* — all load-bearing claims (AI SDK v6
`toUIMessageStreamResponse` + `DefaultChatTransport` + awaited `Resolvable`
headers + `convertToModelMessages`; the exact-`ai`/`@ai-sdk/react`/`^19.2.1` pin
triad; the shadcn run-from-package mechanism) confirmed against `ai`'s installed
type defs + npm + shadcn docs; minor wording fixes applied above (createUIMessage…
is v6 not v7; TipTap v3.0.0 not v2 drops 19; `await convertToModelMessages`; #9239
not proven against our `#imports` flow; `ai` installed 6.0.168 not 6.0.208).
**Completeness** (vs DESIGN §2/§4/§5/§8 + acceptance) and **sequencing/build-risk**
were done inline (their review agents were rate-limited) — findings folded into
Part 2: responsive mobile bottom tab bar, focus trap/restore, board-switch
crossfade (reduced-motion), route-level code-splitting, global-search→palette,
incremental shell rewire updating the 11 existing tests in lockstep, ui-chat
`.jsx`→TS-source migration risks (exports + vitest `deps.inline`), coupling-gate
test budgeting for vendored AI Elements, and legacy-app build verification.
