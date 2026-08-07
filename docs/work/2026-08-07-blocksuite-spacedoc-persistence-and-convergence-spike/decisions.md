# Decisions: BlockSuite spaceDoc persistence and convergence rejection spike

Date: 2026-08-07
Status: NO-GO recorded from exact-version rejection evidence

## D1 - Evidence-only headless spike

Use focused Bun tests and synthetic fixtures only. Do not wire the spike into the renderer or
production provider. This isolates BlockSuite public model/store viability from existing UI and
transport behavior.

## D2 - Public API boundary

Allowed BlockSuite surfaces are published exports from `@blocksuite/store` and
`@blocksuite/blocks/schemas`, including `Doc.spaceDoc` and semantic `Doc` methods. Private fields,
source-path imports, patches, forks, suppression, and readiness timers are forbidden.

## D3 - Exact release under test

The five direct BlockSuite dependencies must be exact `0.19.5`. Current lock resolution alone is
not enough because Roadmap's manifest uses caret ranges. Yjs stays unchanged to keep one variable.

## D4 - Canonical state precedes editability

Canonical bytes apply before `Doc.load()` and before any editable handle is exposed. An empty
canonical result may initialize an explicit new document; load failure never falls back to an
editable stale document.

## D5 - Tri-state result

GO requires all core and repository gates. Any core failure is NO-GO. Missing, timed-out,
suppressed, or non-reconstructable evidence is INCOMPLETE and cannot GO. Neither failure state
authorizes a workaround in this issue.

## D6 - Task-list approval remains open

Intent was approved in Forge comment `c242885d-4deb-4868-865c-71b14fcecacc`. This worker does not
approve the final task-list/plan-lock gate and does not authorize `/dev`.

Superseded operationally on 2026-08-07: the main agent confirmed task-list approval and assigned
the implementation under actor `codex-wave1-blocksuite-20260807`. `forge issue owns` returned
`owned: true`; the issue was already in active `dev`.

## D7 - NO-GO: public spaceDoc bytes do not reconstruct semantic blocks

The exact `0.19.5` public imports and fresh semantic document creation pass. The frozen synthetic
fixture also hashes correctly. The core persistence invariant fails when a same-ID fresh document
receives `Y.applyUpdate(doc.spaceDoc, bytes)` before `Doc.load()`: BlockSuite emits
`BlockSuiteError` code 4, `block children is not found when creating model`, for the restored
blocks, and the resulting public semantic snapshot is empty instead of the four-block tree.

This is the rejection condition specified by the plan. Tasks 3-5 were not attempted. No private
field, source-path import, patch, fork, suppression, timer, production provider change, or alternate
load ordering was used to turn the failure into a pass.

The published package graph also emits duplicate-constructor warnings for `@blocksuite/store` and
Yjs during the headless run. These warnings were retained as evidence, not suppressed.

## Implementation result

- Outcome: `NO-GO`
- Exact BlockSuite versions: all five direct Roadmap dependencies pinned to `0.19.5`; root and
  Roadmap lockfiles already resolved the same graph and required no content change.
- Evidence commit SHA: `c1cf4f00ffc2792b7c1f2ece5ba5357c8a63ca66`
- Focused headless command/result: `bun test apps/roadmap-web/tests/blocksuite-spike` -> 2 pass,
  1 fail; the public import/manifest tests pass and the frozen persistence test fails closed.
- Existing BlockSuite tests: `bun run --cwd apps/roadmap-web test src/components/blocksuite/__tests__`
  -> 7 files, 43 tests passed.
- Roadmap lint: passed.
- Roadmap typecheck: failed because this repository does not provide declarations for the
  evidence harness's `bun:test` imports (`TS2307` in both test files). No typing suppression or
  new dependency was added after the core hard stop.
- Source-test coupling: passed.
- Repo tooling: 122 tests passed.
- Full supported validation: `bun run test:prepush` ran for 662.5s; earlier package,
  platform-web (108 files / 1085 tests), meeting-web (27 files / 132 tests), and repo-tooling
  checks passed, then the run failed at Roadmap typecheck on the same two `TS2307` errors.
- Security audit: `bun audit --production` failed with 106 existing advisories (40 high,
  55 moderate, 11 low), including transitive advisories through BlockSuite packages.
- Forge adapter note: `forge dev` placed/read the issue in active dev, but its optional Beads audit
  write failed because the configured Dolt `product_suite` database was unavailable. Kernel lease
  ownership remained proven.
- First failing invariant: public `Doc.spaceDoc` encode/apply-before-load does not restore stable
  BlockSuite models; `Doc.load()` leaves `semanticSnapshot()` empty after code-4 model errors.
