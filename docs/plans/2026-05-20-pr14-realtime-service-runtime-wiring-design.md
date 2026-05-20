# PR14 Realtime Service Runtime Wiring Design

Feature: `pr14-realtime-service-runtime-wiring`
Date: 2026-05-20
Status: planned
Beads: `product-suite-36p`
Classification: Critical - realtime service runtime and deployment boundary
Research: `docs/research/pr14-realtime-service-runtime-wiring.md`

## Purpose

Turn the PR13 Hocuspocus service boundary into a runnable, validated service runtime while preserving current Roadmap canvas behavior and keeping the Supabase Realtime fallback explicit.

## Success Criteria

- `services/hocuspocus` has a tested runtime entrypoint that can start an injected Hocuspocus server with validated environment config.
- Service startup fails closed when required runtime configuration is missing or invalid.
- The service exposes a minimal health/readiness surface suitable for CI or deployment smoke checks.
- Roadmap has tested configuration helpers that select the Hocuspocus realtime path only when fully configured and otherwise keep the existing Supabase fallback visible.
- Root scripts, validation docs, repo-tooling tests, and CI path filters cover the new runtime entrypoint.
- Durable planning docs mark PR13 verified and PR14 active.

## Out Of Scope

- Removing the Supabase Realtime fallback.
- Migrating canvas persistence away from Supabase Storage.
- Changing public canvas routes, document metadata schema, or BlockSuite editor initialization.
- Cross-region scaling, Redis fanout, or production observability beyond basic readiness.
- Changing auth provider semantics or team membership resolution.

## Approach Selected

Add a minimal service runtime around the existing `services/hocuspocus` factory. The runtime should parse environment config, construct the server through the existing factory, call `listen()`, and expose a testable readiness path without importing Roadmap, Supabase browser clients, or Next.js APIs.

Roadmap should gain a small configuration helper that decides whether Hocuspocus is enabled from explicit environment/runtime inputs. It should keep the current Supabase Realtime adapter as the default/fallback until a later cutover PR proves production readiness.

This is preferred over switching Roadmap fully to Hocuspocus now because PR13 intentionally kept fallback behavior and persistence unchanged. Runtime wiring can be reviewed independently before live collaboration traffic is moved.

## Constraints

- `services/hocuspocus` must remain service-owned and must not import `@/` aliases, Next route APIs, or Supabase browser clients.
- Runtime startup must validate required values before opening a port.
- Read-only and read-write auth behavior must stay enforced through the Hocuspocus connection configuration and existing hook guards.
- Roadmap fallback behavior must remain explicit and tested.
- No production deployment secrets should be added to source.

## Edge Cases

- Missing `HOCUSPOCUS_PORT` rejects before `listen()`.
- Invalid debounce settings reject before `listen()`.
- Missing auth verifier or persistence hooks fail closed in the service boundary.
- Missing Roadmap Hocuspocus URL or token factory keeps Supabase Realtime fallback active.
- Health/readiness checks do not leak tokens, connection context, or document identifiers.

## Ambiguity Policy

Use the 7-dimension decision gate. Proceed when a decision preserves current canvas behavior, keeps runtime ownership in `services/hocuspocus`, and confidence is at least 80%. Stop and ask before removing the Supabase fallback, changing persistence, or introducing new deployment provider requirements.

## Technical Research

See `docs/research/pr14-realtime-service-runtime-wiring.md`.

TDD scenarios:

1. Hocuspocus runtime entrypoint starts an injected server after config validation.
2. Runtime startup rejects invalid environment without calling `listen()`.
3. Readiness surface returns service identity and healthy status without secrets.
4. Roadmap realtime config helper selects Hocuspocus only when fully configured.
5. Repo-tooling tests prove PR14 plan state, runtime scripts, validation docs, and CI filters are wired.
