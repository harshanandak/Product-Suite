# Building Blocks Transformation PR Plan

Last updated: 2026-04-24

This file is the durable execution plan for the multi-PR transformation of Product Suite into a clearer building-blocks architecture. It exists so the team can return to the sequence and continue execution without depending on chat history.

## Merge Order
1. `PR1 Repo Tooling Normalization`
2. `PR2 Validation Baseline`
3. `PR3 Schema And Domain Inventory`
4. `PR4 Contracts Nucleus`
5. `PR5 Auth Contracts And Adapters`
6. `PR6 Auth Provider Rollout`
7. `PR7 SDK / Typed Client Layer`
8. `PR8 Meeting Block Extraction`
9. `PR9 Chat Block Extraction`
10. `PR10 Canvas Boundary Extraction`
11. `PR11 Planning And Charting Blocks`
12. `PR12 Agent-Core Service`
13. `PR13 Realtime Transport Split`

## Current Status
- `PR1 Repo Tooling Normalization`: merged and verified
- `PR2+`: still need planning and execution as tracked work slices

## Global Rules
- Roll back the PR if it breaks a prior gate.
- Pause the sequence if a PR technically merges but invalidates the next PR's assumptions.
- Do not patch through a failed checkpoint by expanding the next PR. That hides the actual no-go signal.

## Checkpoint Reviews
- After `PR4`: decide if contracts extraction is truly working.
- After `PR6`: decide if auth convergence is real.
- After `PR10`: decide if canvas stays in transformation path or becomes a rebuild candidate.

## Reviewer Roles
- `Architecture reviewer`
  - checks ownership boundaries, contracts, service/app/package split
- `Runtime reviewer`
  - checks deployability, CI, validation, auth/session/runtime behavior
- `Product reviewer`
  - checks that shells stay usable and product behavior is preserved
- `Migration reviewer`
  - checks rollback path, data/schema impact, no hidden irreversible moves

## PR-by-PR Execution Checklist

### PR1 Repo Tooling Normalization
- Goal: make repo topology truthful.
- Why first: root currently only lists the two web apps in `package.json`, while `meeting-api` is already a real service in `apps/meeting-api/README.md`.
- Checklist:
  - add `packages/` and `services/` top-level dirs
  - update root docs/scripts to include `meeting-api`
  - do not try to force Python into Bun workspaces
  - document all deployables and owners
- Reviewer focus:
  - repo truthfulness
  - no app behavior changes
  - no hidden build assumptions
- Merge gate:
  - a new contributor can identify every deployable from root docs/scripts
- Rollback criteria:
  - root scripts become less clear
  - CI/docs still imply only two apps exist

### PR2 Validation Baseline
- Goal: one root validation story before refactors.
- Checklist:
  - add root commands for `roadmap-web`, `meeting-web`, `meeting-api`
  - wire JS lint/type/build and Python test/lint commands
  - document local and CI execution order
- Reviewer focus:
  - reproducibility
  - fast failure
  - no silent skips
- Merge gate:
  - all three deployables have explicit root-level validation entrypoints
- Rollback criteria:
  - validation depends on tribal knowledge
  - any deployable is still checked only manually

### PR3 Schema And Domain Inventory
- Goal: decide canonical ownership before contracts.
- Why now: `meeting-api` already has Alembic and SQL migrations, while roadmap still documents manual Supabase setup in `apps/roadmap-web/SUPABASE_SETUP.md`.
- Checklist:
  - inventory shared entities: workspace, team, thread, meeting, artifact, task
  - mark current owner and future owner for each
  - mark source-of-truth DB/migration path for each domain
  - define what stays domain-local vs shared
- Reviewer focus:
  - ownership clarity
  - migration realism
  - avoiding fake unification
- Merge gate:
  - one written ownership map exists and contradictions are resolved
- Rollback criteria:
  - same entity still has multiple canonical owners
  - contracts would need to guess schema truth

### PR4 Contracts Nucleus
- Goal: thin shared wire contracts only.
- Checklist:
  - create `packages/contracts`
  - add only: identity scope, conversation, meeting core, canvas core
  - make `roadmap-web`, `meeting-web`, `meeting-api` import them
  - avoid tasks/workflows/webhooks in first pass
- Reviewer focus:
  - narrow scope
  - wire-level usefulness
  - no premature domain freezing
- Merge gate:
  - all three deployables compile or run against the same minimal contracts
- Rollback criteria:
  - package causes cascading rewrites
  - package becomes a dumping ground for app-local types

### PR5 Auth Contracts And Adapters
- Goal: unify auth shape before changing providers.
- Why now: auth is currently split across Supabase middleware in `apps/roadmap-web/src/middleware.ts`, Neon/BetterAuth client logic in `apps/meeting-web/src/lib/api.js`, and backend token verification in `apps/meeting-api/backend/security.py`.
- Checklist:
  - define `AuthClaims`, `TokenVerifier`, `SessionBridge`, `WorkspaceAccessResolver`
  - wrap current providers behind adapters
  - do not change login provider yet
- Reviewer focus:
  - claim shape completeness
  - backward compatibility
  - service/web symmetry
- Merge gate:
  - current auth flows still work while sharing one claims model
- Rollback criteria:
  - adapter layer leaks provider-specific truth everywhere
  - claims model cannot represent all current flows

### PR6 Auth Provider Rollout
- Goal: remove `Supabase Auth` as the foundation.
- Checklist:
  - switch both web apps to one canonical IdP model
  - update backend verification to JWKS/OIDC flow
  - remove Supabase-auth-as-truth from roadmap shell
  - update env/docs/migration notes
- Reviewer focus:
  - session continuity
  - service verification correctness
  - tenant/workspace claim correctness
- Merge gate:
  - both apps sign in through one canonical auth model
  - `meeting-api` validates the same claim set
- Rollback criteria:
  - requires permanent dual auth truths
  - breaks tenant/workspace scoping

### PR7 SDK / Typed Client Layer
- Goal: replace ad hoc HTTP shapes.
- Checklist:
  - create `packages/sdk`
  - replace `meeting-web` ad hoc axios surface from `apps/meeting-web/src/lib/api.js`
  - add typed clients for shared service surfaces
- Reviewer focus:
  - request/response typing
  - no hidden runtime coupling
  - no duplicate endpoint definitions
- Merge gate:
  - shells consume typed clients instead of inventing request shapes
- Rollback criteria:
  - SDK has to special-case every caller
  - services still expose unstable ad hoc contracts

### PR8 Meeting Block Extraction
- Goal: extract shared meeting block first.
- Checklist:
  - create `packages/ui-meeting`
  - move shared meeting presentation out of `meeting-web`
  - let `roadmap-web` consume meeting surfaces through package import
  - keep `meeting-web` as shell
- Reviewer focus:
  - shell thinning
  - package reuse
  - no route coupling in shared block
- Merge gate:
  - `meeting-web` gets thinner and `roadmap-web` can reuse the same meeting block
- Rollback criteria:
  - shared meeting package drags in router/app-shell state
  - package is only usable by one app

### PR9 Chat Block Extraction
- Goal: extract reusable chat block, no `chat-web`.
- Checklist:
  - create `packages/ui-chat`
  - lift reusable logic from `apps/roadmap-web/src/hooks/use-chat-threads.ts`
  - keep workspace-specific routing and shell behavior in roadmap
- Reviewer focus:
  - separation between reusable chat UI/data and workspace shell logic
  - no app-specific persistence hardcoded into package
- Merge gate:
  - chat works in roadmap and can be reused elsewhere without forking the implementation
- Rollback criteria:
  - package needs roadmap-only assumptions for basic operation
  - extraction duplicates logic instead of lifting it

### PR10 Canvas Boundary Extraction
- Goal: isolate canvas from transport/persistence/auth, then extract it.
- Why risky: current canvas is tightly coupled through `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts` and BlockSuite-specific Next config in `apps/roadmap-web/next.config.ts`.
- Checklist:
  - define provider/persistence interfaces first
  - keep shell-specific build hacks outside package
  - extract `packages/ui-canvas` only after interface split
- Reviewer focus:
  - provider injection
  - build isolation
  - no Supabase/Next assumptions in public package API
- Merge gate:
  - canvas package can render/editor-bootstrap without baking in current Supabase transport
- Rollback criteria:
  - package must carry shell-specific config or patched dependency behavior
  - extraction spreads more complexity than it removes

### PR11 Planning And Charting Blocks
- Goal: extract lower-risk reusable blocks after core boundaries are proven.
- Checklist:
  - create `packages/ui-planning`
  - create `packages/ui-charting`
  - move only clearly reusable surfaces
- Reviewer focus:
  - real reuse
  - no premature abstraction
- Merge gate:
  - planning/charting render across multiple contexts with shared contracts
- Rollback criteria:
  - still blocked on unresolved contracts/auth/canvas issues

### PR12 Agent-Core Service
- Goal: move heavy orchestration out of shells.
- Checklist:
  - create `services/agent-core`
  - shift long-running orchestration out of roadmap API routes like `apps/roadmap-web/src/app/api/ai/unified-chat/route.ts`
  - keep shell-level mediation in Next
- Reviewer focus:
  - runtime boundary
  - ownership clarity
  - no duplicated orchestration logic
- Merge gate:
  - long-running agent logic has a real service boundary
- Rollback criteria:
  - service still depends on shell internals
  - contracts are not stable enough to support separation

### PR13 Realtime Transport Split
- Goal: move canonical Yjs transport into a real service later.
- Checklist:
  - add `services/hocuspocus`
  - route canvas collaboration through service-owned transport
  - keep lightweight app fanout separate
- Reviewer focus:
  - collaboration correctness
  - separation from business persistence
- Merge gate:
  - app shells no longer own canonical collaboration transport
- Rollback criteria:
  - canvas still depends on app-local transport semantics
  - transport split increases product instability
