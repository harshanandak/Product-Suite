# PR6 Auth Provider Rollout Tasks

Issue: product-suite-fto
Design: docs/plans/2026-05-16-pr6-auth-provider-rollout-design.md

## Wave 1: Baseline And Contracts

Task 1: Baseline auth-provider inventory tests
OWNS: test/repo-tooling.test.js docs/plans/building-blocks-transformation-pr-plan.md
File(s): test/repo-tooling.test.js, docs/plans/building-blocks-transformation-pr-plan.md
What to implement: Update the durable plan status so PR5 is merged/verified and PR6 is active; add repo-tooling coverage that rejects stale PR5-active status.
TDD steps:
1. Write test: add assertion that the building-blocks plan marks PR5 merged/verified and PR6 active.
2. Run test: confirm it fails on current stale status text.
3. Implement: update the status section only.
4. Run test: confirm repo-tooling passes.
5. Commit: `docs: mark pr6 auth rollout active`
Expected output: repo tooling proves the plan points to PR6, not stale PR5 work.

Task 2: Canonical auth contract fixtures
OWNS: packages/contracts/src/auth.test.ts packages/contracts/src/auth.js packages/contracts/contracts/auth-core.json
File(s): packages/contracts/src/auth.test.ts, packages/contracts/src/auth.js, packages/contracts/contracts/auth-core.json
What to implement: Add canonical hosted auth fixture coverage for issuer, audience, tenant, workspace, roles, permissions, issued/expires timestamps, and provider claims.
TDD steps:
1. Write test: canonical hosted claims normalize and validate without provider-token leakage.
2. Run test: confirm any missing fields or normalization gaps fail.
3. Implement: extend contract validation only if the test exposes a real gap.
4. Run test: confirm contract tests pass.
5. Commit: `test: cover canonical hosted auth claims`
Expected output: shared contracts represent the canonical hosted identity shape needed by PR6.

## Wave 2: Roadmap Canonical Session Boundary

Task 3: Roadmap canonical auth facade
OWNS: apps/roadmap-web/src/lib/canonical-auth.ts apps/roadmap-web/src/lib/__tests__/canonical-auth.test.ts
File(s): apps/roadmap-web/src/lib/canonical-auth.ts, apps/roadmap-web/src/lib/__tests__/canonical-auth.test.ts
What to implement: Add a server-safe facade that reads canonical hosted session/token inputs and returns PR5 `AuthClaims`; include fail-closed helpers for missing/invalid sessions.
TDD steps:
1. Write test: valid hosted session maps to `AuthClaims`.
2. Write test: missing subject/email fails closed.
3. Implement: facade functions with no Supabase `auth.getUser()` fallback.
4. Run test: confirm all facade tests pass.
5. Commit: `feat: add roadmap canonical auth facade`
Expected output: roadmap has a provider-independent auth truth boundary.

Task 4: Roadmap middleware route protection switch
OWNS: apps/roadmap-web/src/middleware.ts apps/roadmap-web/src/lib/canonical-auth-middleware.ts apps/roadmap-web/src/lib/__tests__/canonical-auth-middleware.test.ts
File(s): apps/roadmap-web/src/middleware.ts, apps/roadmap-web/src/lib/canonical-auth-middleware.ts, apps/roadmap-web/src/lib/__tests__/canonical-auth-middleware.test.ts
What to implement: Route protected/auth pages through canonical auth checks while keeping non-auth redirects such as `/mind-maps` to `/canvas`.
TDD steps:
1. Write test: protected route without canonical session redirects to `/login`.
2. Write test: auth page with canonical session redirects to `/dashboard`.
3. Write test: `/mind-maps` redirect still works.
4. Implement: middleware helper and wiring.
5. Run test: confirm middleware tests pass.
6. Commit: `feat: route roadmap middleware through canonical auth`
Expected output: roadmap shell stops using Supabase Auth as route-auth truth.

## Wave 3: Supabase Data And RLS Bridge

Task 5: RLS-dependent Supabase auth audit
OWNS: docs/research/pr6-auth-provider-rollout.md apps/roadmap-web/src/lib/__tests__/auth-rls-bridge.test.ts
File(s): docs/research/pr6-auth-provider-rollout.md, apps/roadmap-web/src/lib/__tests__/auth-rls-bridge.test.ts
What to implement: Codify the RLS constraint: paths depending on `auth.uid()` must either use an RLS-compatible canonical token or server-side membership checks.
TDD steps:
1. Write test: document/audit helper lists RLS policy files that depend on `auth.uid()`.
2. Run test: confirm audit fails if policies are ignored.
3. Implement: small audit helper or fixture-backed test.
4. Run test: confirm audit passes.
5. Commit: `test: capture roadmap rls auth bridge constraints`
Expected output: PR6 cannot silently drop Supabase database authorization semantics.

Task 6: Roadmap server auth replacement pilot
OWNS: apps/roadmap-web/src/app/page.tsx apps/roadmap-web/src/app/auth/callback/route.ts apps/roadmap-web/src/lib/__tests__/roadmap-auth-routing.test.ts
File(s): apps/roadmap-web/src/app/page.tsx, apps/roadmap-web/src/app/auth/callback/route.ts, apps/roadmap-web/src/lib/__tests__/roadmap-auth-routing.test.ts
What to implement: Replace the highest-level roadmap landing/callback auth truth with canonical auth helpers, leaving Supabase data access separate.
TDD steps:
1. Write test: authenticated canonical user reaches dashboard/home behavior.
2. Write test: unauthenticated user redirects to login.
3. Implement: use canonical auth facade for auth truth.
4. Run test: confirm routing tests pass.
5. Commit: `feat: use canonical auth for roadmap entry routes`
Expected output: top-level roadmap auth no longer depends on Supabase `auth.getUser()`.

## Wave 4: Meeting API Canonical Verification

Task 7: Meeting API canonical JWKS config
OWNS: apps/meeting-api/backend/config.py apps/meeting-api/backend/security.py apps/meeting-api/tests/backend/test_auth_actor.py apps/meeting-api/tests/backend/test_config.py
File(s): apps/meeting-api/backend/config.py, apps/meeting-api/backend/security.py, apps/meeting-api/tests/backend/test_auth_actor.py, apps/meeting-api/tests/backend/test_config.py
What to implement: Make canonical issuer, audience, JWKS URL, and provider name explicit in config and tests; preserve OSS/local token behavior.
TDD steps:
1. Write test: hosted token verification uses configured canonical JWKS URL, issuer, and audience.
2. Write test: JWKS verification failure returns 401.
3. Implement: config naming and verification wiring.
4. Run test: confirm meeting-api auth tests pass.
5. Commit: `feat: make meeting api canonical jwks verification explicit`
Expected output: backend verifies the same canonical identity model used by web apps.

## Wave 5: Docs, Env, And Validation

Task 8: Auth rollout docs and env examples
OWNS: apps/meeting-web/.env.example apps/meeting-api/backend/.env.example apps/roadmap-web/.env.example docs/plans/building-blocks-transformation-pr-plan.md docs/research/pr6-auth-provider-rollout.md
File(s): apps/meeting-web/.env.example, apps/meeting-api/backend/.env.example, apps/roadmap-web/.env.example, docs/plans/building-blocks-transformation-pr-plan.md, docs/research/pr6-auth-provider-rollout.md
What to implement: Document canonical provider env vars, trusted origins/callback URLs, JWKS/issuer/audience settings, RLS bridge notes, and rollback steps.
TDD steps:
1. Write test: repo tooling verifies PR6 docs mention canonical provider, JWKS, issuer, audience, trusted origins, and rollback.
2. Run test: confirm docs test fails before docs updates.
3. Implement: docs/env updates.
4. Run test: confirm repo-tooling passes.
5. Commit: `docs: document canonical auth rollout config`
Expected output: deployers know exactly how to configure and roll back PR6.

Task 9: Full validation
OWNS: no source ownership; validation only
File(s): package.json scripts, CI-equivalent commands
What to implement: Run the PR6 validation matrix and record exact results.
TDD steps:
1. Run `bun run test:contracts`.
2. Run `bun run test:repo-tooling`.
3. Run `bun run ci:meeting-web`.
4. Run `bun run ci:roadmap-web`.
5. Run `bun run ci:meeting-api`.
6. Commit any validation-only doc updates if required.
Expected output: all deployable validation gates pass before `/ship`.
