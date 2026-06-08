# PR21 Single Domain Platform Shell Decisions

Feature: `pr21-single-domain-platform-shell`
Beads: `product-suite-a49`
Date: 2026-06-08

## Decisions

1. PR21 is a Standard feature slice.
   - Reason: it adds platform shell/routing behavior but does not change payments, schema, production data movement, or permission rules.

2. Roadmap/Next is the platform shell host.
   - Reason: Roadmap already owns the App Router root, middleware, API routes, workspace routes, canvas routes, and shared provider setup.

3. Meeting is mounted through a shell-native module facade in PR21.
   - Reason: importing the full Meeting Vite runtime into Next.js would combine routing, CSS, auth, runtime config, and browser-only concerns in one PR.

4. The module registry must remain metadata-only.
   - Reason: registry imports should not pull Meeting, Canvas, Agent, or Roadmap runtime bundles into the shell baseline.

5. Old route behavior must be explicit.
   - Reason: route collisions and lost bookmarks are the main PR21 failure mode.

6. Beads tooling had Windows/runtime issues during planning setup.
   - Reason: `beads-context.sh stage-transition product-suite-a49 none plan`, `beads-context.sh set-design product-suite-a49 8 docs/plans/2026-06-08-pr21-single-domain-platform-shell-tasks.md`, and `beads-context.sh set-acceptance product-suite-a49 ...` timed out. `forge team verify` failed with `grep: -P supports only unibyte and UTF-8 locales`. The Beads epic itself was created and moved to `in_progress`.

7. PR21 plan exit stops at user task-list review.
   - Reason: the plan workflow requires user confirmation before `/dev`; this branch should not begin implementation until the task list is accepted or adjusted.
