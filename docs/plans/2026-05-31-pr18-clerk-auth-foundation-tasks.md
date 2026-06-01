# PR18 Clerk Auth Foundation Tasks

Feature: `pr18-clerk-auth-foundation`
Beads: `product-suite-1yh`
Date: 2026-05-31
Status: ready-for-dev

## Task 1: Durable Plan State

Goal: make the building-blocks plan accurately reflect completed PR17 and active PR18 planning artifacts.

TDD/checks:
- RED: update repo-tooling expectations for PR18 research, design, tasks, and decisions artifacts.
- GREEN: add PR18 artifacts and durable plan links.
- REFACTOR: keep the durable plan wording focused on PR18 only.

Validation:
- `bun run test:repo-tooling`

## Task 2: Clerk Environment Contract

Goal: define fail-closed Clerk env requirements for local, preview, and production runtimes.

Required behavior:
- require public and secret Clerk keys where protected auth is enabled;
- require issuer, audience, and allowed authorized parties/origins for backend verification;
- distinguish public auth routes from protected routes;
- document preview/production instance separation.

TDD/checks:
- RED: add env contract tests that fail when required Clerk settings are absent.
- GREEN: add the env contract helper/docs.
- REFACTOR: remove duplicated env names across apps/services.

## Task 3: Shared Clerk Auth Claims Contract

Goal: extend shared auth contracts so services consume normalized Clerk identity.

Required behavior:
- represent provider `clerk`, subject, issuer, audience, email, display name, workspace/org hints, roles, permissions, issued/expiry times, JWT ID, and provider claims;
- reject missing required Clerk verification fields when Clerk token verification is requested;
- never return raw session tokens in normalized claims or errors.

TDD/checks:
- RED: add contract tests for valid Clerk claims and fail-closed missing/mismatched fields.
- GREEN: update `packages/contracts` auth contract source and artifact.
- REFACTOR: keep hosted/legacy auth examples clearly separate from Clerk examples.

## Task 4: Redirect And Callback Contract

Goal: define one auth callback owner with safe return intent.

Required behavior:
- preserve allowed module paths after sign-in;
- reject external URLs and disallowed prefixes;
- detect and stop redirect loops;
- include module/workspace hints without trusting them for authorization.

TDD/checks:
- RED: add redirect contract tests for allowed paths, external URLs, bad signatures, and loop paths.
- GREEN: add callback/return-intent helper or contract docs.
- REFACTOR: centralize allowed prefixes.

## Task 5: Backend JWT/JWKS Validation Contract

Goal: define shared backend verification expectations before services accept Clerk identity.

Required behavior:
- accept tokens from `Authorization: Bearer` or `__session`;
- validate signature through Clerk JWKS/public key;
- require issuer, audience, subject, expiry/not-before, and authorized party checks;
- return typed auth errors without token leakage.

TDD/checks:
- RED: add backend contract tests for valid token metadata and invalid issuer/audience/authorized party paths.
- GREEN: implement shared validation contract surface for services.
- REFACTOR: keep service-specific wiring out of the shared contract.

## Task 6: User/Org Sync And Event Identity Design

Goal: prepare PR19 identity tables and analytics identity without adding migrations in PR18.

Required decisions:
- Clerk user maps to future `platform.users.external_provider_id`.
- Clerk organization maps to future `platform.workspaces.external_provider_id`.
- memberships are synced idempotently and reconciled lazily on first request.
- platform events use internal platform user/workspace IDs once PR19 creates them.

TDD/checks:
- RED: add documentation/tooling assertions for sync and event identity contracts.
- GREEN: add design docs/contracts for sync payloads and event identity fields.
- REFACTOR: keep PR19 schema details as placeholders, not migrations.

## Task 7: Beads And Stage Context

Goal: make PR18 resumable for `/dev`.

Required updates:
- record plan artifacts on `product-suite-1yh`;
- set design metadata with task count and task file path;
- transition workflow context from `plan` to `dev`;
- commit and push the PR18 planning branch.

Exit criteria:
- research, design, tasks, and decisions files exist;
- durable plan points to PR18 artifacts;
- repo-tooling guard passes;
- `product-suite-1yh` is ready for `/dev`.
