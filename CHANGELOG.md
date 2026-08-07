# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Cross-platform architecture conformance plan with tiered contract checks, dependency and editor rejection gates, and research traceability for canvas, agents, meetings, Custom Mode, workflow, UI, and data decisions (PR #157, db5ad299-2988-4ff2-958b-4a37d35dffe7)
- Advisory memory-curator verdict in Review Inbox, gated by review and scoped to privacy-safe context (PR #154, b0d3975f-1704-4ca1-a552-317a36e540b4)
- Root validation baseline across `roadmap-web`, `meeting-web`, and `meeting-api`, including shared root commands, Meeting API validation helpers, and CI alignment (PR #2, product-suite-84m)
- Schema and domain ownership inventory for roadmap and meeting surfaces, including canonical ownership boundaries, overlap rules, and guarded discoverability links (PR #3, product-suite-waq)

### Fixed
- Review Inbox deep links no longer select a different proposal; draft-time target snapshots now stabilize proposal previews, while accept-time staleness fencing protects writes instead of silently rebasing (PR #156, 496d0f55-3cad-447c-b901-93c666dd65a5, 2ef40a29-794e-4839-a64b-16f35d30d16c)
