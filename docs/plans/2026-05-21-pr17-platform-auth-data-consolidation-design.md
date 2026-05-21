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

Edge cases and mitigations:
- Clerk webhook replay or duplicate delivery: use idempotency keys and unique external IDs.
- User signs in before webhook sync finishes: create a lazy sync fallback on first request.
- Organization deleted in Clerk but still referenced in DB: mark workspace disabled before hard delete.
- Clerk session token accepted by one backend but not another: centralize JWKS/audience/issuer validation helpers.
- Preview deployments use wrong Clerk instance: env validation must fail closed.

### PR19 Unified Supabase Platform Schema

Goal: create the single database shape before moving Meeting off Neon.

Scope:
- add `platform`, `meeting`, `roadmap`, `agent`, and `realtime` schema ownership docs
- create or normalize platform tables for users, workspaces, memberships, and audit events
- decide which existing Roadmap public-schema tables stay public temporarily and which move later
- add migration tests or drift checks

Edge cases and mitigations:
- Supabase Data API exposure leaks tables: keep private schemas private; enable RLS on exposed schemas.
- RLS policies use stale JWT claims: use backend-mediated writes first where freshness matters.
- Existing Roadmap code expects `public` schema: add compatibility views or phase schema moves.
- Migration order breaks generated types: update generated types in the same PR as schema changes.

### PR20 Meeting Database Cutover From Neon To Supabase

Goal: point Meeting API at Supabase Postgres and remove Neon as the required database target.

Scope:
- port Meeting Alembic schema into Supabase-compatible migration path
- update Meeting API env examples to use Supabase Postgres `DATABASE_URL`
- remove hosted deployment requirement that forces `AUTH_PROVIDER=neon`
- keep Meeting API as the write owner for meeting tables
- add smoke tests for meeting create/read flows against Supabase-compatible Postgres

Edge cases and mitigations:
- Alembic and Supabase migrations drift: make one canonical migration path for Meeting after cutover.
- Connection pooling differs between Neon and Supabase: use the right pooled/direct URLs per runtime and migration.
- Empty database assumption becomes false before PR lands: add a preflight row-count check and stop if data exists.
- Meeting code depends on Neon auth claims: map Clerk claims to internal platform identity before writes.

### PR21 Single Domain Platform Shell

Goal: make Meeting and Roadmap appear as modules in one product.

Scope:
- add app/module registry
- add routes for `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings`
- add platform navigation and app switcher
- mount Meeting as a first-class module in the Product Suite shell
- keep existing module tests and build ownership separate

Edge cases and mitigations:
- Route collisions between apps: reserve module prefixes and document route ownership.
- Module bundle size grows too large: lazy-load modules by route.
- One module failure breaks whole shell: add route-level error boundaries.
- Auth redirects loop across modules: centralize protected-route handling.

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

Edge cases and mitigations:
- Analytics identifies users inconsistently across modules: use internal platform user/workspace IDs.
- Event volume grows unexpectedly: start with compact event taxonomy.
- Conversion data is hard to interpret: record module entrypoint, first action, and returning action separately.

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
