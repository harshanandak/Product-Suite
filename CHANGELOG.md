# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Authorization-scoped, memory-only TanStack Query orchestration for `platform-web` memory-impact reads, preserving repository, API, realtime, and run authority (PR #164, 5a03773c-b0df-4b96-9215-b2a0c9cd4031)
- Canonical collaboration authority for stable actors, conversations, memberships, immutable ordered events, tenant-bound API access, and additive legacy-thread compatibility (PR #163, 2086343b-db19-4b13-a50f-c5e36c213b20)
- BlockSuite 0.19.5 canonical-persistence NO-GO decision with an exact public-API rejection regression and bounded alternative-editor handoff (PR #161, 8dfbe355-366a-4518-b377-9f3eccf2745d)
- Cross-platform architecture conformance plan with tiered contract checks, dependency and editor rejection gates, and research traceability for canvas, agents, meetings, Custom Mode, workflow, UI, and data decisions (PR #157, db5ad299-2988-4ff2-958b-4a37d35dffe7)
- Advisory memory-curator verdict in Review Inbox, gated by review and scoped to privacy-safe context (PR #154, b0d3975f-1704-4ca1-a552-317a36e540b4)
- Root validation baseline across `roadmap-web`, `meeting-web`, and `meeting-api`, including shared root commands, Meeting API validation helpers, and CI alignment (PR #2, product-suite-84m)
- Schema and domain ownership inventory for roadmap and meeting surfaces, including canonical ownership boundaries, overlap rules, and guarded discoverability links (PR #3, product-suite-waq)

### Fixed
- Agent-created work items now preserve trusted proposal provenance and expose tenant-safe proposal, run, actor, and approval context on item details (PR #162, 163c617a-2ec7-4ffc-8575-eea4085f8e4f)
- Review Inbox deep links no longer select a different proposal; draft-time target snapshots now stabilize proposal previews, while accept-time staleness fencing protects writes instead of silently rebasing (PR #156, 496d0f55-3cad-447c-b901-93c666dd65a5, 2ef40a29-794e-4839-a64b-16f35d30d16c)
