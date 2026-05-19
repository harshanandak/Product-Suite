# PR13 Realtime Transport Split Design

Feature: `pr13-realtime-transport-split`
Date: 2026-05-19
Status: planned
Beads: `product-suite-6w3`
Classification: Critical - new realtime service architecture boundary
Research: `docs/research/pr13-realtime-transport-split.md`

## Purpose

Move canonical canvas collaboration transport ownership out of the Roadmap app shell and into a service-owned Hocuspocus boundary, while preserving current canvas persistence and user-facing editing behavior.

## Success Criteria

- `services/hocuspocus` exists as a workspace-owned service package with focused tests.
- The service package owns canonical canvas document naming, collaboration auth context types, runtime config, and Hocuspocus server factory wiring.
- `@product-suite/ui-canvas` exposes transport contracts that can describe service-owned realtime transport without importing Roadmap, Supabase, or Hocuspocus runtime code.
- Roadmap consumes service-owned realtime contracts through a thin adapter while keeping Supabase persistence and metadata checks in the shell.
- Root validation, repo-tooling tests, docs, and CI path filters include `services/hocuspocus`.
- Existing Roadmap BlockSuite tests continue to pass.

## Out Of Scope

- Deploying a production Hocuspocus service.
- Removing Supabase Storage persistence.
- Changing public canvas routes or document metadata schema.
- Rewriting BlockSuite editor initialization.
- Migrating auth providers or changing team membership semantics.
- Implementing cross-region scaling, Redis fanout, or durable production observability.

## Approach Selected

Create `services/hocuspocus` as an internal workspace service package that exports typed collaboration contracts and a Hocuspocus server factory with injectable auth and persistence hooks. Extend the existing `@product-suite/ui-canvas` boundary only where needed so Roadmap can consume a service-owned transport contract without importing service internals directly into reusable UI packages.

Roadmap will add a local adapter that maps current canvas identity and shell auth/session state into the service-owned collaboration config. The current Supabase Storage persistence and metadata store remain in Roadmap for this PR; the transport contract becomes service-owned first.

This is preferred over replacing the full `HybridProvider` in one PR because the current provider also owns dirty-state tracking, browser lifecycle saves, and persistence coordination. A smaller split gives reviewers a stable transport boundary and keeps rollback simple.

## Constraints

- `services/hocuspocus` must not import `@/` aliases, Next route APIs, or Supabase browser clients.
- `packages/ui-canvas` must remain framework-neutral.
- Roadmap must not lose current Supabase persistence behavior.
- Realtime document names must be derived from validated canvas identity only.
- Missing service URL/token configuration must fail closed or keep explicit legacy fallback behavior.
- Tests must cover service contracts before any Roadmap adapter switch.

## Edge Cases

- Invalid `teamId` or `documentId` rejects before building a room name.
- Missing collaboration service URL does not silently create a broken connection.
- Auth verifier rejection prevents a Hocuspocus connection context.
- Load/store hooks surface failures without corrupting document state.
- Existing Supabase realtime fallback remains explicit if the service transport is disabled.

## Ambiguity Policy

Use the 7-dimension decision gate. Proceed when a decision preserves current canvas behavior, keeps persistence/auth ownership explicit, and confidence is at least 80%. Stop and ask before removing the legacy Supabase realtime fallback, changing BlockSuite editor initialization, changing database schema, or adding deployment infrastructure.

## Technical Research

See `docs/research/pr13-realtime-transport-split.md`.

TDD scenarios:

1. `services/hocuspocus` validates and formats canonical document names from canvas identity.
2. `services/hocuspocus` server factory delegates auth and persistence hooks through injected dependencies.
3. Roadmap adapter tests prove app code consumes service-owned config rather than hardcoding transport room semantics.
4. Existing `HybridProvider` tests prove persistence and dirty-state behavior remain stable.
5. Repo-tooling tests prove the new service is included in workspaces, validation docs, scripts, and CI path filters.
