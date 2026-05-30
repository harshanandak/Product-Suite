# PR18 Clerk Auth Foundation Research

## Current State

PR17 chose Clerk as the canonical user-facing auth provider and Supabase Postgres as the platform database target. PR18 is the first implementation slice after that decision, but it must not move database ownership yet.

The repo already has shared auth contracts in `packages/contracts/src/auth.js` and `packages/contracts/contracts/auth-core.json`. Those contracts describe canonical claims, token verification boundaries, session bridging, and workspace access resolution, but the examples still include hosted/Neon-era provider assumptions. Roadmap middleware still refreshes Supabase auth cookies before canonical auth handling, and Meeting API still has Python auth-contract code from the prior hosted auth path.

## Clerk Documentation Notes

Current Clerk Next.js guidance uses:

- `ClerkProvider` from `@clerk/nextjs` in the App Router root layout.
- `clerkMiddleware` and `createRouteMatcher` from `@clerk/nextjs/server` to protect routes.
- public sign-in/sign-up routes and fallback redirect environment variables for return behavior.
- backend token verification with Clerk session JWTs read from `__session` or `Authorization: Bearer`, using Clerk verification helpers or JWKS/public-key verification.
- authorized party/origin checks for cross-origin token usage.

## Codebase Notes

- `apps/roadmap-web/src/middleware.ts` currently chains Supabase session refresh into canonical auth middleware.
- `apps/roadmap-web/src/middleware.test.ts` covers redirect behavior and legacy canvas route preservation.
- `packages/contracts/src/auth.js` validates shared auth claim shape and strips token leakage.
- `packages/contracts/src/auth.test.ts` asserts the committed contract artifact and hosted auth normalization behavior.
- `apps/meeting-api/backend/auth_contracts.py` is the Python-side contract reference for backend validation.

## Recommended Slice

PR18 should establish Clerk-facing contracts and testable integration seams without cutting modules over to a new database shape.

Scope:
- add explicit Clerk env contracts for local, preview, and production runtimes;
- add Clerk provider/middleware expectations to the platform shell boundary;
- extend shared auth contracts for Clerk identity, issuer, audience, authorized party, organization/workspace hints, and token verification failure modes;
- define one callback owner with signed return intent, allowed redirect prefixes, and redirect-loop tests;
- define user/org sync design for future `platform.users`, `platform.workspaces`, and memberships without adding PR19 schema migrations;
- define platform event identity fields that use internal platform user/workspace IDs once PR19 creates them.

Out of scope:
- creating Supabase platform schema tables;
- moving Meeting API from Neon/Postgres defaults to Supabase;
- replacing every existing Roadmap auth path at runtime;
- adding billing or analytics sinks;
- relying on Supabase Auth as the user auth provider.

## Risks

- Accepting Clerk session tokens without issuer, audience, or authorized-party checks could let the wrong environment authenticate. Mitigation: fail closed on missing env and assert issuer/audience/authorized party in shared helpers.
- Redirect callbacks can create open redirects or loops. Mitigation: signed return intent, allowed-prefix whitelist, and loop tests.
- Webhooks can replay or arrive after a user signs in. Mitigation: idempotent sync design and lazy first-request reconciliation.
- Stale org membership claims can authorize sensitive writes. Mitigation: server-side membership checks remain required for sensitive operations.
- Browser Supabase access before PR19 would couple RLS to unfinished Clerk claims. Mitigation: no browser Supabase Clerk access in PR18.

## TDD Scenarios

1. Repo tooling fails until the durable plan points to PR18 research, design, tasks, and decisions artifacts.
2. Shared auth contract tests accept canonical Clerk claims and reject missing subject, issuer, audience, or authorized party when Clerk verification is required.
3. Redirect contract tests reject external `return_to` URLs, preserve allowed module paths, and prevent callback loops.
4. Env contract tests fail closed when Clerk publishable key, secret key, issuer, audience, or allowed origins are missing for a protected runtime.
5. Backend contract tests prove services consume normalized Clerk identity without leaking raw tokens.
