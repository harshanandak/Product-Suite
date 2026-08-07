# Decisions: BlockSuite spaceDoc persistence and convergence rejection spike

Date: 2026-08-07
Status: plan-stage decisions only; implementation result pending

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

## Implementation result template

- Outcome: `PENDING`
- Exact BlockSuite versions: `PENDING`
- Commit SHA: `PENDING`
- Focused headless command/result: `PENDING`
- Roadmap tests/typecheck/lint: `PENDING`
- Source-test/repo-tooling: `PENDING`
- First failing invariant, if any: `PENDING`
