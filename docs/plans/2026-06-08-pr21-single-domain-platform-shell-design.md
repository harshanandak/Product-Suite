# PR21 Single Domain Platform Shell Design

Feature: `pr21-single-domain-platform-shell`
Beads: `product-suite-a49`
Date: 2026-06-08
Status: plan

## Purpose

Bring Meeting, Roadmap, Canvas, Agents, and Settings under one Product Suite shell so the product stops feeling like separate websites while preserving the module ownership established in PR17-PR20.

PR21 should make module navigation, route ownership, compatibility paths, and module failure isolation executable before PR22 hardens permissions.

## Success Criteria

- A shell-owned module registry defines `/meetings`, `/roadmap`, `/canvas`, `/agents`, and `/settings` without importing module runtime bundles.
- A platform shell/app switcher renders all modules, highlights the active module, and can be tested without real auth or backend calls.
- Roadmap/Next owns the single-domain shell routes and exposes shell-native entries for Meeting, Roadmap, Canvas, Agents, and Settings.
- Meeting is mounted as a Product Suite module through shell-owned route entries and shared meeting surfaces while Meeting API remains the data owner.
- A route ownership matrix documents new module routes, old Roadmap routes, old Meeting routes, and compatibility behavior.
- Module route loading and error boundaries prevent one module failure from breaking the whole shell.
- Tests prove protected module return intent is preserved and public auth paths do not redirect-loop.

## Out Of Scope

- No PR22 permission hardening or role model changes.
- No billing, analytics sink, or conversion event implementation.
- No full Meeting Vite runtime merge into Next.js.
- No Meeting API ownership changes.
- No broad Roadmap route rewrite or schema move.
- No new production auth provider cutover beyond the existing PR18/PR19 contracts.

## Approach Selected

Use Roadmap's Next.js App Router app as the Product Suite host and add a shell-native module facade.

The shell will define metadata-only module registry records, platform navigation/app switcher UI, and module-prefixed routes. Meeting is mounted first through shell-owned routes and existing shared meeting presentation surfaces. Existing Meeting Vite routes remain independently validated and documented as compatibility/runtime-owned until a later PR intentionally migrates the full Meeting runtime.

This is selected over a full Vite-to-Next runtime merge because current Meeting routing, hosted auth paths, CSS, browser-only hooks, and runtime config are not yet designed for direct import into the Next App Router. The facade approach gives users one domain and one navigation model while keeping module ownership reviewable.

## Constraints

- Module registry records must stay metadata-only.
- Platform shell UI must not call Meeting API, Roadmap API, Supabase, or Clerk directly.
- Module routes must lazy-load content and have route-level fallback/error behavior.
- Existing Roadmap workspace URLs must keep working.
- Existing Meeting validation must stay separate from Roadmap validation.
- Auth route handling must align with the PR18 platform auth contract and must not create redirect loops.
- Any compatibility redirect must be explicit and covered by a route ownership test.

## Edge Cases

- A module route is unknown, disabled, or missing from the registry.
- Meeting module content fails to load.
- A user deep-links to `/meetings/new` or `/meetings/:meetingId`.
- A user deep-links to an existing Roadmap workspace route.
- A user hits an auth-only path while already authenticated.
- A user is redirected to login from `/meetings` and should return to `/meetings`, not `/`.
- A module link points to a route that is reserved but not fully implemented yet.
- Multiple modules expose a route named `settings`.

## Ambiguity Policy

Use the 7-dimension `/dev` decision gate.

- 0-3: proceed and document in `docs/plans/2026-06-08-pr21-single-domain-platform-shell-decisions.md`.
- 4-7: route to spec review before implementation.
- 8+, auth exposure, route removal, service ownership changes, or module runtime merge: block for developer input.

## Technical Research

Research is recorded in `docs/research/pr21-single-domain-platform-shell.md`.

Key conclusions:

- Next.js App Router route groups and nested layouts support a single shell while keeping module sections organized. Multiple root layouts would make cross-module navigation full-page reload, so PR21 should keep one root shell.
- Next.js route-level `loading.tsx` and `error.tsx` boundaries fit PR21's requirement that module failures stay local.
- Next.js redirects or explicit compatibility routes should own old path behavior rather than leaving route collisions implicit.
- React Router `basename` is the right compatibility lever if Meeting remains independently deployed under `/meetings`.
- Existing Meeting lazy loading and error boundary code should be preserved in the Meeting app while the platform shell mounts a safer shell-native entry.
- Clerk App Router guidance matches the PR18 auth contract: root provider plus middleware route matchers. PR21 should align route protection with that contract but not invent new identity behavior.

## OWASP Notes

- A01 Broken Access Control: applies. Mitigation: PR21 does not weaken membership checks or expose private module APIs; protected route behavior is tested for return intent only.
- A02 Cryptographic Failures: limited applicability. PR21 must not add token storage or raw credential handling.
- A03 Injection: applies to route/redirect inputs. Mitigation: compatibility route definitions and return paths must use same-origin/allowed-prefix checks.
- A04 Insecure Design: applies. Mitigation: module registry is metadata-only and module ownership is documented before runtime consolidation.
- A05 Security Misconfiguration: applies. Mitigation: route ownership matrix and tests prevent accidental public exposure through shell routes.
- A07 Identification And Authentication Failures: applies. Mitigation: align with PR18 auth contract and test auth-only/public/protected route behavior.
- A08 Software And Data Integrity Failures: applies. Mitigation: lazy module loading must not import unreviewed runtime bundles through registry metadata.
- A09 Security Logging And Monitoring Failures: deferred to PR23 except that route compatibility decisions are recorded in the decisions file.
- A10 SSRF: not directly applicable; PR21 should not add network proxying to arbitrary module URLs.

## TDD Scenarios

1. Durable plan artifact test for PR21 files and building-blocks status.
2. Module registry test for required modules, stable hrefs, active-module resolution, and metadata-only imports.
3. Platform shell render test for app switcher, active module, disabled/reserved module behavior, and no backend calls.
4. Route ownership matrix test for new platform routes, preserved Roadmap routes, Meeting compatibility routes, and reserved paths.
5. `/meetings` shell route test that renders a shell-native Meeting entry without importing the Vite `App`.
6. Module error boundary test that renders a scoped fallback when content fails.
7. Auth-route compatibility test for protected return intent and auth-only loop prevention.

