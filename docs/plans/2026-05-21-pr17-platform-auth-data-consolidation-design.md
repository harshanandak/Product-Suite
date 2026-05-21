# PR17 Platform Auth And Data Consolidation Design

Feature: `pr17-platform-auth-data-consolidation`
Beads: `product-suite-do6`
Date: 2026-05-21
Status: active

## Purpose

Move Product Suite from separate product surfaces and split auth/data assumptions into one platform direction:

- one public domain and one platform shell
- Clerk as the canonical auth and organization/workspace identity provider
- one Supabase Postgres project as the physical platform database
- meeting, roadmap, canvas, agent, and realtime modules as independently owned domains inside the platform
- no production data migration requirement because current user/project data is empty

This is a planning PR. It should prevent the next implementation PRs from mixing auth, database consolidation, routing, and product-shell work without clear ownership or rollback points.

## Current State

- Roadmap already uses Supabase project validation, migrations, generated types, and Supabase env contracts.
- Meeting API uses plain Postgres through `DATABASE_URL` or `POSTGRES_URL`, with current hosted defaults still coupled to Neon auth/provider assumptions.
- Meeting web still carries hosted auth/runtime wiring that was built before the new platform-shell decision.
- The durable building-blocks plan has completed through PR16, but PR17+ was not defined.

## Selected Direction

Use Clerk for user-facing authentication and Supabase Postgres for platform data.

Supabase Auth should not be the primary user auth surface. Supabase remains the database, migration, storage/realtime-capable platform. Clerk becomes the login, account, organization, invitation, and user-management layer.

Use one physical database with logical ownership:

```text
platform.users
platform.workspaces
platform.memberships
platform.audit_events

meeting.meetings
meeting.transcripts
meeting.summaries
meeting.participants

roadmap.work_items
roadmap.timeline_items
roadmap.documents
roadmap.feedback

agent.runs
agent.tasks
agent.memory_refs

realtime.documents
realtime.sessions
realtime.presence
```

## Product Shape

Use one domain and one shell:

```text
/
/meetings
/roadmap
/canvas
/agents
/settings
```

The product should feel like one platform, closer to a Zoho/Odoo style app switcher. The implementation should still keep module boundaries explicit enough that a module can later be extracted or deployed separately if conversion data proves that is valuable.

## Non-Goals

- No production data migration from Neon is required in this phase.
- Do not split modules into separate public websites now.
- Do not remove existing backend domain boundaries.
- Do not expose service-role Supabase access to browser code.
- Do not implement Clerk and database rewiring in the planning PR.

## Proposed PR Sequence

### PR17 Platform Auth And Data Consolidation Plan

Goal: make the platform decision durable and reviewable.

Scope:
- update the building-blocks plan
- define Clerk + unified Supabase Postgres as the target
- define the follow-up implementation PRs
- document edge cases, mitigations, validation gates, and rollback rules

Merge gate:
- implementation PRs can start without re-litigating auth provider, database target, or shell topology

### PR18 Clerk Auth Foundation

Goal: introduce Clerk without changing database ownership yet.

Scope:
- add Clerk provider to the platform shell
- define Clerk env contracts for local, preview, and production
- add Clerk user and organization webhook handling plan
- create internal platform user/workspace mapping tables or stubs
- update auth contracts so Meeting and Roadmap can validate Clerk identities
- define the platform auth redirect contract before any module rewiring

Edge cases and mitigations:
- Clerk webhook replay or duplicate delivery: use idempotency keys and unique external IDs.
- User signs in before webhook sync finishes: create a lazy sync fallback on first request.
- Organization deleted in Clerk but still referenced in DB: mark workspace disabled before hard delete.
- Clerk session token accepted by one backend but not another: centralize JWKS/audience/issuer validation helpers.
- Preview deployments use wrong Clerk instance: env validation must fail closed.
- Auth redirects loop or lose intent: one callback owner, signed `return_to`, allowed-prefix whitelist, module/workspace hints, and redirect-loop tests.

### PR19 Unified Supabase Platform Schema

Goal: create the single database shape before moving Meeting off Neon.

Scope:
- add `platform`, `meeting`, `roadmap`, `agent`, and `realtime` schema ownership docs
- create or normalize platform tables for users, workspaces, memberships, and audit events
- decide which existing Roadmap public-schema tables stay public temporarily and which move later
- choose the canonical migration owner before adding Meeting tables to Supabase
- define the exact Clerk-to-Supabase auth mode and JWT claim contract
- add migration tests or drift checks

Edge cases and mitigations:
- Supabase Data API exposure leaks tables: keep private schemas private; enable RLS on exposed schemas.
- RLS policies use stale JWT claims: use backend-mediated writes first where freshness matters.
- Existing Roadmap code expects `public` schema: add compatibility views or phase schema moves.
- Migration order breaks generated types: update generated types in the same PR as schema changes.
- RLS maps the wrong identity: do not use `auth.uid()` unless Clerk `sub` is the internal UUID; otherwise read explicit internal user/workspace claims.
- Existing grants expose data through PostgREST: revoke default privileges and fail CI on unexpected `anon`/`authenticated` grants.

### PR20 Meeting Database Cutover From Neon To Supabase

Goal: point Meeting API at Supabase Postgres and remove Neon as the required database target.

Scope:
- port Meeting Alembic schema into Supabase-compatible migration path
- update Meeting API env examples to use Supabase Postgres `DATABASE_URL`
- remove hosted deployment requirement that forces `AUTH_PROVIDER=neon`
- keep Meeting API as the write owner for meeting tables
- add smoke tests for meeting create/read flows against Supabase-compatible Postgres
- separate direct, session-pooler, and transaction-pooler connection strings by runtime purpose

Edge cases and mitigations:
- Alembic and Supabase migrations drift: make one canonical migration path for Meeting after cutover.
- Connection pooling differs between Neon and Supabase: use the right pooled/direct URLs per runtime and migration.
- Empty database assumption becomes false before PR lands: add a preflight row-count check and stop if data exists.
- Meeting code depends on Neon auth claims: map Clerk claims to internal platform identity before writes.
- Supabase extension support differs from Neon/local Postgres: check required extensions before migration.
- Rollback is unproven: capture backup/restore proof before cutover.

### PR21 Single Domain Platform Shell

Goal: make Meeting and Roadmap appear as modules in one product.

Scope:
- add app/module registry
- add routes for `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings`
- add platform navigation and app switcher
- mount Meeting as a first-class module in the Product Suite shell
- keep existing module tests and build ownership separate
- produce a route ownership matrix for old and new Meeting/Roadmap routes

Edge cases and mitigations:
- Route collisions between apps: reserve module prefixes and document route ownership.
- Module bundle size grows too large: lazy-load modules by route.
- One module failure breaks whole shell: add route-level error boundaries.
- Auth redirects loop across modules: centralize protected-route handling.
- Existing top-level Roadmap and Meeting routes break bookmarks: redirect or preserve them through an explicit compatibility layer.
- Module registry imports too much runtime code: keep registry metadata-only and load module UI through dynamic route entrypoints.

### PR22 Platform Permissions And Access Hardening

Goal: make Clerk identity, Supabase rows, and backend permissions agree.

Scope:
- define platform role model
- add workspace membership checks
- decide which queries use RLS and which go through backend service access
- add audit events for sensitive operations

Edge cases and mitigations:
- User removed from workspace but JWT is still valid: check membership server-side for sensitive writes.
- Browser Supabase client bypasses backend rules: only expose safe tables and RLS policies.
- Service role accidentally leaks to client: add env scanning and tests.

### PR23 Observability, Billing Readiness, And Conversion Analytics

Goal: make the new platform measurable before broad launch.

Scope:
- module activation events
- first-value and retention events
- workspace creation and invitation funnels
- per-module health checks
- billing-readiness schema decisions, without implementing payments unless explicitly scoped
- product event identity contract moved earlier into PR18/PR19 so conversion data is not delayed

Edge cases and mitigations:
- Analytics identifies users inconsistently across modules: use internal platform user/workspace IDs.
- Event volume grows unexpectedly: start with compact event taxonomy.
- Conversion data is hard to interpret: record module entrypoint, first action, and returning action separately.
- Pricing experiments cannot be compared: include pricing variant and acquisition source in the event contract before shell rollout.

## Evaluator Hardening Addendum

This pass used the current PR17 plan, repo files, Context7 Clerk/Supabase guidance, and evaluator review to turn likely failure modes into future PR gates.

### Clerk, JWT, And RLS Contract

Decision: PR19 must choose the exact Clerk-to-Supabase auth mode before any browser Supabase access is allowed.

Mitigation:
- Define the JWT template name, issuer, audience, subject, organization claim, and internal identity claim.
- Do not use `auth.uid()` in RLS unless the Clerk `sub` is intentionally the internal platform UUID.
- Add SQL tests for mismatched user, workspace, organization, issuer, and audience claims.
- Browser Supabase clients may use only publishable/anon keys plus Clerk access tokens.
- Service-role keys stay server-only; CI must fail on service-role variables in public env names or client bundles.

### Clerk Webhook Consistency

Decision: webhooks are useful for user/workspace projection, but they are eventually consistent and must not be the only correctness path.

Mitigation:
- Verify Clerk/Svix signatures before processing.
- Store event IDs and process user/org events idempotently.
- Tolerate duplicate, retried, and out-of-order delivery.
- Reconcile user/workspace mappings on first authenticated request.
- Soft-disable users/workspaces before destructive deletes.

### Supabase Exposure And Grants

Decision: the unified database must not inherit permissive Roadmap-era exposure by accident.

Mitigation:
- Before adding `meeting`, audit exposed schemas, table grants, and RLS state.
- Fail CI if an exposed table lacks RLS or has unexpected `anon`/`authenticated` grants.
- Keep backend-only tables in private schemas and outside the Data API exposure list.
- Use explicit `to authenticated` policies where browser access is intentional.

### Migration Ownership

Decision: PR19 must choose one migration owner before PR20 moves Meeting data structures.

Mitigation:
- Prefer committed Supabase SQL migrations under `infra/supabase/migrations` for the unified database.
- Treat Meeting Alembic history as read-only after cutover, or remove Alembic runtime readiness checks before PR20.
- Define schema-qualified table names, `alembic_version` handling, and compatibility views before moving anything out of `public`.
- Every schema PR must run local reset, generate Supabase types, and fail if generated type files drift.

### Connection And Recovery Runbook

Decision: database URLs are not interchangeable once Supabase pooling is involved.

Mitigation:
- Document direct, session-pooler, and transaction-pooler URLs separately.
- Use direct/session connections for migrations, restore, dumps, and extension checks.
- Use the pooler for server runtime with a bounded application pool.
- Before cutover, capture row-count evidence, backup/restore proof, and required-extension availability.

### Route And Shell Isolation

Decision: PR21 must account for the routes that already exist, not only the desired route prefixes.

Mitigation:
- Generate a route ownership matrix from Roadmap routes and Meeting React Router config.
- Redirect old paths under module prefixes or preserve them through an explicit compatibility layer.
- Fail CI on duplicate module prefixes, duplicate auth callback paths, and unowned top-level routes.
- Keep the module registry metadata-only; route entrypoints dynamically import module runtime/UI.
- Add bundle-size reports and budgets per module.

### Conversion Evidence Timing

Decision: telemetry cannot wait until after the platform shell is already committed.

Mitigation:
- PR18/PR19 define internal event identity using platform user/workspace IDs.
- PR21 emits `module_view`, `module_activation`, `first_value`, `workspace_created`, `invite_sent`, `pricing_variant`, and acquisition source fields.
- PR23 can improve sinks and dashboards, but the event contract starts earlier.

## Cross-Cutting Edge Cases

### Empty Database Assumption

Decision: treat current user/project data as empty, but do not rely on memory.

Mitigation:
- Every cutover PR must include a preflight check documenting whether production tables contain rows.
- If rows exist, stop and add a scoped data migration task instead of overwriting.

### Vendor Lock-In

Decision: accept Clerk + Supabase for speed and user experience now.

Mitigation:
- Keep internal user/workspace IDs separate from Clerk IDs.
- Keep domain services reading internal IDs, not raw provider IDs.
- Keep auth verification behind shared helpers.

### Backend Efficiency

Decision: one physical DB reduces operational overhead, but services keep domain ownership.

Mitigation:
- Avoid cross-domain writes from random app code.
- Add typed SDK/service functions for cross-module reads.
- Add indexes with each migration when access patterns are known.

### Cost Control

Decision: one Supabase project should be cheaper and simpler than multiple paid database projects while the product is validating conversion.

Mitigation:
- Avoid separate Supabase projects per module.
- Keep Neon only as temporary rollback during Meeting cutover.
- Review compute, storage, and bandwidth monthly once real usage starts.

### Local Development

Decision: local dev must still work without cloud-only assumptions.

Mitigation:
- Clerk dev keys go in local env only.
- Supabase local or local Postgres should support schema validation.
- CI should use local Postgres where possible and live Supabase only for drift/type validation.

### Security

Decision: Clerk is identity; Supabase is data; backend services enforce domain rules.

Mitigation:
- No service-role key in browser code.
- RLS on exposed schemas.
- Private schemas for backend-only tables.
- Webhook signature verification.
- Explicit audit trail for workspace membership and role changes.

## Validation Strategy

Each implementation PR must include:

- repo-tooling guard for stale durable plan state
- focused tests for the module touched
- env contract tests
- migration/drift validation for schema changes
- auth failure tests for missing/invalid issuer, audience, JWKS, and workspace mapping
- rollback notes

## Rollback Strategy

- PR18 rollback: disable Clerk integration and keep current auth behavior.
- PR19 rollback: revert schema migrations before real data exists.
- PR20 rollback: point Meeting API back to Neon `DATABASE_URL` until Neon is removed.
- PR21 rollback: hide module registry entries and keep old routes reachable.
- PR22 rollback: temporarily force backend-mediated access if RLS policies block valid flows.
- PR23 rollback: disable analytics emission without changing product behavior.

## Open Decisions

- Whether Roadmap tables remain in `public` through launch or move into `roadmap` schema before launch.
- Whether Meeting API keeps Alembic after Supabase cutover or moves to Supabase migration files.
- Whether browser modules should query Supabase directly with Clerk tokens or go through backend APIs for the first launch.
- Which product module becomes the default landing page after login.
