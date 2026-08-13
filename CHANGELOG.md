# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Security
- Canonical tenant capability context now derives viewer/member/admin/owner authority from active database memberships and guards team, status, and project writes with fail-closed 404/403 behavior (PR #176, Forge issue `af872dc9-3c53-4f9d-9fc0-3e0bbdf6889f`)
- GitHub Actions dependency installs for DB Contract and Platform Web now disable package lifecycle scripts while retaining frozen-lockfile enforcement (PR #171, Forge issue `808fbffa-8923-4083-9e5e-407b5b855454`)

### Added
- Governed versioned command preview/execute APIs for work-item mutations and stored proposal application, with server-derived capability/approval authority, CAS, idempotent replay, append-only audit persistence, canonical migration `0021`, and a provider-neutral SDK client (PR #177, Forge issue `0f825242-6214-4661-81c4-28f878123b15`)
- Fail-closed T0-T3 delivery change classification with exact base/head evidence, adversarial downgrade coverage, and catalog-bound dependency proof (PR #167, Forge issue `9041eeab-6079-43e3-a95a-d555e076dddf`)
- Authorization-scoped, memory-only TanStack Query orchestration for `platform-web` memory-impact reads, preserving repository, API, realtime, and run authority (PR #164, 5a03773c-b0df-4b96-9215-b2a0c9cd4031)
- Canonical collaboration authority for stable actors, conversations, memberships, immutable ordered events, tenant-bound API access, and additive legacy-thread compatibility (PR #163, 2086343b-db19-4b13-a50f-c5e36c213b20)
- BlockSuite 0.19.5 canonical-persistence NO-GO decision with an exact public-API rejection regression and bounded alternative-editor handoff (PR #161, 8dfbe355-366a-4518-b377-9f3eccf2745d)
- Cross-platform architecture conformance plan with tiered contract checks, dependency and editor rejection gates, and research traceability for canvas, agents, meetings, Custom Mode, workflow, UI, and data decisions (PR #157, db5ad299-2988-4ff2-958b-4a37d35dffe7)
- Advisory memory-curator verdict in Review Inbox, gated by review and scoped to privacy-safe context (PR #154, b0d3975f-1704-4ca1-a552-317a36e540b4)
- Root validation baseline across `roadmap-web`, `meeting-web`, and `meeting-api`, including shared root commands, Meeting API validation helpers, and CI alignment (PR #2, product-suite-84m)
- Schema and domain ownership inventory for roadmap and meeting surfaces, including canonical ownership boundaries, overlap rules, and guarded discoverability links (PR #3, product-suite-waq)

### Changed
- Real-Neon authority conformance now proves disposable-project and production-derived-branch cleanup, direct migration versus pooled runtime binding, least-privilege CRUD and denial behavior, and exact opaque PASS evidence (PR #173, Forge issue `25faf39b-3017-42fe-94c0-87acad7279a0`)
- DB Contract now runs deterministic changed-surface cheap gates before protected exact-head Neon evidence; executable migration-manifest and OAuth/token/session authority paths fail closed to DB proof, while strict server-side branch protection remains the merge-time base-freshness authority (Forge issue `532329e0-7595-40c2-b939-a3a0735f8071`)
- DB Contract real-Neon tests now reuse migrated suite branches with transaction rollback for safe cases, preserve dedicated isolation-sensitive proofs, and emit exact-head phase evidence to reduce runtime without weakening isolation (PR #168, Forge issue `9a808ed4-16c1-48c7-8ffb-2e8a2c8aaaaf`)
- DB Contract suites now coordinate at most two ephemeral Neon branches across test workers, safely reconcile ambiguous control-plane responses, and run isolated files concurrently without weakening exact-test or cleanup proof (PR #169, Forge issue `9a808ed4-16c1-48c7-8ffb-2e8a2c8aaaaf`)
- Canonical live Postgres authority is now Neon `neondb`/`public` with Drizzle as the sole migration plane; guarded original-production and repaired-bootstrap histories reconcile at the `0019` floor, runtime roles remain least-privilege, and executable Supabase/Alembic authority surfaces are retired while historical artifacts stay validation-only (PR #165, Forge issue `59efc6dc-07a1-4b31-9942-ba2f1fcac8e1`)

### Fixed
- Windows feature worktrees now use exact-base Forge-linked creation, isolated frozen Bun installs, verified local tool binaries, and suite-load-safe branch-lease test budgets instead of sharing mutable dependency links (PR #175, Forge issues `3ae3fb92-d1c0-4cf3-bec2-c002ae0fa28a`, `eb0a9d20-cba0-4075-8861-2bee51d957a4`)
- ESLint 9.39.2 now resolves its compatible AJV 6 draft-04 schema from isolated worktrees without depending on stale cross-worktree junctions (PR #166, Forge issue `168d9c20-7cf5-40a1-a7f6-9aa85ff71746`)
- Agent-created work items now preserve trusted proposal provenance and expose tenant-safe proposal, run, actor, and approval context on item details (PR #162, 163c617a-2ec7-4ffc-8575-eea4085f8e4f)
- Review Inbox deep links no longer select a different proposal; draft-time target snapshots now stabilize proposal previews, while accept-time staleness fencing protects writes instead of silently rebasing (PR #156, 496d0f55-3cad-447c-b901-93c666dd65a5, 2ef40a29-794e-4839-a64b-16f35d30d16c)
