# Building Blocks Transformation PR Plan

Last updated: 2026-05-20

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
14. `PR14 Realtime Service Runtime Wiring`
15. `PR15 Hocuspocus Provider Cutover Readiness`
16. `PR16 Hocuspocus Provider Controlled Rollout`
17. `PR17 Platform Auth And Data Consolidation Plan`
18. `PR18 Clerk Auth Foundation`
19. `PR19 Unified Supabase Platform Schema`
20. `PR20 Meeting Database Cutover From Neon To Supabase`
21. `PR21 Single Domain Platform Shell`
22. `PR22 Platform Permissions And Access Hardening`
23. `PR23 Observability Billing Readiness And Conversion Analytics`

## Current Status
- `PR1 Repo Tooling Normalization`: merged and verified
- `PR2 Validation Baseline`: merged and verified
- `PR3 Schema And Domain Inventory`: merged and verified
- `PR4 Contracts Nucleus`: merged and verified
- `PR5 Auth Contracts And Adapters`: merged and verified
- `PR6 Auth Provider Rollout`: merged and verified
- `PR7 SDK / Typed Client Layer`: merged and verified
- `PR8 Meeting Block Extraction`: merged and verified
- `PR9 Chat Block Extraction`: merged and verified
- `PR10 Canvas Boundary Extraction`: merged and verified
- `PR11 Planning And Charting Blocks`: merged and verified
- `PR12 Agent-Core Service`: merged and verified
- `PR13 Realtime Transport Split`: merged and verified
- `PR14 Realtime Service Runtime Wiring`: merged and verified
- `PR15 Hocuspocus Provider Cutover Readiness`: merged and verified
- `PR16 Hocuspocus Provider Controlled Rollout`: merged and verified
- `PR17 Platform Auth And Data Consolidation Plan`: active on `feat/pr17-platform-auth-data-consolidation`
- `PR18+`: planned below and must be executed as separate reviewable slices

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
- Active artifacts:
  - `docs/research/pr5-auth-contracts-and-adapters.md`
  - `docs/plans/2026-05-16-pr5-auth-contracts-and-adapters-design.md`
  - `docs/plans/2026-05-16-pr5-auth-contracts-and-adapters-tasks.md`
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
- Active artifacts:
  - `docs/research/pr6-auth-provider-rollout.md`
  - `docs/plans/2026-05-16-pr6-auth-provider-rollout-design.md`
  - `docs/plans/2026-05-16-pr6-auth-provider-rollout-tasks.md`
- Canonical rollout configuration: use one canonical Neon/Better Auth provider, explicit JWKS URL, issuer, audience, signed roadmap session cookies, exact trusted origins, and a rollback path that restores Supabase route gating while leaving PR5 contracts intact.
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
- Active artifacts:
  - `docs/research/pr8-meeting-block-extraction.md`
  - `docs/plans/2026-05-18-pr8-meeting-block-extraction-design.md`
  - `docs/plans/2026-05-18-pr8-meeting-block-extraction-tasks.md`
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
- Active artifacts:
  - `docs/research/pr9-chat-block-extraction.md`
  - `docs/plans/2026-05-18-pr9-chat-block-extraction-design.md`
  - `docs/plans/2026-05-18-pr9-chat-block-extraction-tasks.md`
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
- Active artifacts:
  - `docs/research/pr10-canvas-boundary-extraction.md`
  - `docs/plans/2026-05-18-pr10-canvas-boundary-extraction-design.md`
  - `docs/plans/2026-05-18-pr10-canvas-boundary-extraction-tasks.md`
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
- Active artifacts:
  - `docs/research/pr11-planning-and-charting-blocks.md`
  - `docs/plans/2026-05-18-pr11-planning-and-charting-blocks-design.md`
  - `docs/plans/2026-05-18-pr11-planning-and-charting-blocks-tasks.md`
  - `docs/plans/2026-05-18-pr11-planning-and-charting-blocks-decisions.md`
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
- Active artifacts:
  - `docs/research/pr12-agent-core-service.md`
  - `docs/plans/2026-05-19-pr12-agent-core-service-design.md`
  - `docs/plans/2026-05-19-pr12-agent-core-service-tasks.md`
  - `docs/plans/2026-05-19-pr12-agent-core-service-decisions.md`
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
- Active artifacts:
  - `docs/research/pr13-realtime-transport-split.md`
  - `docs/plans/2026-05-19-pr13-realtime-transport-split-design.md`
  - `docs/plans/2026-05-19-pr13-realtime-transport-split-tasks.md`
  - `docs/plans/2026-05-19-pr13-realtime-transport-split-decisions.md`
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

### PR14 Realtime Service Runtime Wiring
- Goal: turn the Hocuspocus boundary into a runnable service runtime without cutting over Roadmap by default.
- Active artifacts:
  - `docs/research/pr14-realtime-service-runtime-wiring.md`
  - `docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-design.md`
  - `docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-tasks.md`
- Checklist:
  - add a tested `services/hocuspocus` runtime entrypoint
  - add minimal health/readiness behavior for deployment smoke checks
  - add Roadmap runtime selection helpers while preserving Supabase Realtime fallback
  - update validation docs, scripts, and CI path filters
- Reviewer focus:
  - service startup safety
  - auth and read-only enforcement
  - explicit fallback behavior
  - deployment readiness without hidden secrets
- Merge gate:
  - Hocuspocus can run as a validated service runtime and Roadmap can opt into it only when fully configured
- Rollback criteria:
  - service startup can open a port with invalid auth/runtime config
  - Roadmap silently changes realtime behavior when Hocuspocus config is missing
  - health/readiness leaks tokens, document identifiers, or user context

### PR15 Hocuspocus Provider Cutover Readiness
- Goal: prove Roadmap can activate a real Hocuspocus provider path with document, token, and provider inputs before removing Supabase Realtime fallback.
- Active artifacts:
  - `docs/research/pr15-hocuspocus-provider-cutover-readiness.md`
  - `docs/plans/2026-05-20-pr15-hocuspocus-provider-cutover-readiness-design.md`
  - `docs/plans/2026-05-20-pr15-hocuspocus-provider-cutover-readiness-tasks.md`
  - `docs/plans/2026-05-20-pr15-hocuspocus-provider-cutover-readiness-decisions.md`
- Checklist:
  - extend canvas realtime contracts so provider-native transports can receive the active Yjs document
  - pass the Yjs document through `HybridProvider` without changing the Supabase fallback
  - add a Roadmap-owned Hocuspocus provider connection factory behind the existing explicit selection gate
  - add token factory wiring that fails closed and does not change auth provider semantics
  - update validation docs and repo-tooling state guards
- Reviewer focus:
  - realtime correctness
  - auth token handling
  - fallback preservation
  - no Hocuspocus provider dependency in shared canvas contracts
- Merge gate:
  - Roadmap can prove Hocuspocus provider activation in tests when all inputs are present, while default behavior remains Supabase fallback
- Rollback criteria:
  - provider path requires app-specific imports in `packages/ui-canvas`
  - partial config silently changes live collaboration behavior
  - token handling logs or persists sensitive values

### PR16 Hocuspocus Provider Controlled Rollout
- Goal: move Roadmap from provider readiness to an explicitly gated Hocuspocus rollout path while keeping Supabase Realtime available as the operator rollback.
- Active artifacts:
  - `docs/research/pr16-hocuspocus-provider-controlled-rollout.md`
  - `docs/plans/2026-05-20-pr16-hocuspocus-provider-controlled-rollout-design.md`
  - `docs/plans/2026-05-20-pr16-hocuspocus-provider-controlled-rollout-tasks.md`
  - `docs/plans/2026-05-20-pr16-hocuspocus-provider-controlled-rollout-decisions.md`
- Checklist:
  - add an explicit Roadmap rollout flag before Hocuspocus selection can activate
  - keep partial Hocuspocus configuration on the Supabase Realtime fallback path
  - map provider lifecycle events into existing connection and sync error callbacks without token leakage
  - strengthen service/client token context alignment tests
  - document rollback by disabling the rollout flag
- Reviewer focus:
  - controlled rollout safety
  - auth token and document identity alignment
  - fallback preservation
  - observable provider lifecycle without sensitive logging
- Merge gate:
  - Hocuspocus provider traffic can be enabled only through explicit complete config, and disabling the rollout flag returns Roadmap to Supabase Realtime.
- Rollback criteria:
  - missing or partial config changes live collaboration behavior
  - lifecycle logging exposes tokens or document-sensitive payloads
  - read-only token contexts can still write document updates

### PR17 Platform Auth And Data Consolidation Plan
- Goal: lock the next platform direction before implementation: one domain, one platform shell, Clerk auth, and one Supabase Postgres platform database with explicit module ownership.
- Active artifacts:
  - `docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md`
  - `docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-tasks.md`
- Checklist:
  - mark PR16 merged and verified
  - define Clerk as the canonical auth/user/org provider
  - define Supabase Postgres as the single physical platform database
  - keep module ownership separate inside the shared database
  - document edge cases, mitigations, validation gates, and rollback paths before implementation
- Reviewer focus:
  - platform topology clarity
  - no hidden data migration requirement while current data is empty
  - no implementation bundled into the planning PR
- Merge gate:
  - PR18+ can start without ambiguity about auth provider, database target, product shell, or module ownership.
- Rollback criteria:
  - plan requires a production data migration that has not been verified
  - plan collapses domain ownership into a shared-table free-for-all
  - plan forces Supabase Auth despite the product decision to use Clerk

### PR18 Clerk Auth Foundation
- Goal: introduce Clerk as the canonical user-facing auth provider without changing database ownership yet.
- Checklist:
  - add Clerk provider and env contracts to the platform shell
  - add user/org sync design for `platform.users`, `platform.workspaces`, and memberships
  - add shared JWT/JWKS validation helpers for backend services
  - remove Neon-auth-only hosted assumptions from future auth contracts
- Merge gate:
  - users can authenticate through Clerk in tests and services can validate Clerk identity without relying on Supabase Auth.

### PR19 Unified Supabase Platform Schema
- Goal: create the single physical database shape in Supabase before cutting Meeting over.
- Checklist:
  - define `platform`, `meeting`, `roadmap`, `agent`, and `realtime` schema/table ownership
  - add migrations for platform identity/workspace tables
  - decide whether existing Roadmap public-schema tables move immediately or use compatibility views
  - update drift/type validation for the unified schema
- Merge gate:
  - Supabase is ready to hold both platform-shared tables and module-owned tables with clear access boundaries.

### PR20 Meeting Database Cutover From Neon To Supabase
- Goal: move Meeting API database connectivity from Neon Postgres to Supabase Postgres while preserving Meeting backend ownership.
- Checklist:
  - port or reconcile Meeting Alembic schema with Supabase migrations
  - update Meeting API env examples and deployment variables to Supabase `DATABASE_URL`
  - add a preflight row-count check so the no-production-data assumption is verified before cutover
  - keep Neon as a rollback target only until smoke tests pass
- Merge gate:
  - Meeting create/read flows pass against Supabase Postgres and no hosted runtime requires Neon database/auth defaults.

### PR21 Single Domain Platform Shell
- Goal: bring Meeting, Roadmap, Canvas, Agents, and Settings under one website and one authenticated shell.
- Checklist:
  - add module registry and app switcher
  - reserve `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings`
  - mount Meeting as a Product Suite module
  - add route-level error boundaries and lazy loading where needed
- Merge gate:
  - a user signs in once and can navigate between modules without separate websites or separate auth flows.

### PR22 Platform Permissions And Access Hardening
- Goal: make Clerk identity, Supabase rows, and backend domain rules agree.
- Checklist:
  - define workspace roles and membership checks
  - decide where RLS is used versus backend-only service access
  - add audit events for sensitive workspace/auth changes
  - prevent browser exposure of service-role credentials
- Merge gate:
  - invalid Clerk tokens, stale memberships, and missing workspace mappings fail closed.

### PR23 Observability Billing Readiness And Conversion Analytics
- Goal: measure product conversion and module value before scaling the platform.
- Checklist:
  - record module activation and first-value events
  - record workspace, invitation, and return-usage funnels
  - add per-module health/readiness signals
  - document billing-readiness data needs without implementing payments unless separately scoped
- Merge gate:
  - product decisions can be made from platform/module usage evidence rather than anecdotal testing.
