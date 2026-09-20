# Retire Next.js from active delivery

Issue: `cee01acc-7055-4684-8bd5-7a8b7fdc3eb9`. Classification: Critical (security dependency and delivery boundary).

The user explicitly selected complete Next.js retirement. Do not upgrade Next.js. Fetched main (`9cf66fa31cb422c1d06b5d1e2da476950b404681`) marks Roadmap archived and unsupported, but still installs and validates it. Supported Platform Web and Meeting Web use Vite. Roadmap has no supported deployment; references outside its source are orchestration and historical migration evidence.

Remove the archived app from root workspaces, scripts, lock resolutions, CI suite maps, delivery command models and deployment prerequisites. Remove its runnable manifests (Git history is recovery) and mark its remaining source archived. Remove the root Next override and unused BlockSuite patch registration if no supported workspace needs it. Do not remove source, immutable migration evidence, database authority policy, supported canvas package or collaboration tests. Neon auth's optional Next peer and `next-themes` are not Next runtime dependencies.

Preserve meaningful supported checks. Update focused graph/classifier/deployment regressions and validation/runbook documentation. Do not port unsupported Roadmap UI or its superseded Supabase adapter test; future renderer and feature parity belong to baseline issue `414cb9d2-8bd6-4708-9fcf-2f40bb511cd0`.

Required contexts currently include Roadmap-owned `test` and `typecheck-and-build`, while supported Platform Web reports `platform-web`. Before retiring these required contexts, verify the new head's supported checks and preserve the full previous branch protection response for reversal. Retain strict freshness, admin enforcement, linear history and other supported required contexts. No placeholder green checks, bypasses, gate exemptions or self-merge.

The replacement Platform Web check must run when its workspace dependencies change. Add the currently missing `packages/contracts/**` and `packages/ui-chat/**` to both the workflow push paths and its internal changed-files selector. Existing `packages/ui/**`, app, manifest and lock coverage remains. DB Contract already expands transitive workspace dependencies for its verification commands.

Success: frozen supported workspace install has no Next.js runtime resolution; critical audit clears; active workflows do not build Roadmap; supported test/build coverage and historical migration guards pass; reviewed commit is pushed through normal hooks using the personal account; exact-head GitHub checks and protection are verified. This is a separate PR from lint-once. Reverse repository changes by reverting this focused commit; restore captured protection settings if needed.
