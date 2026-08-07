# BlockSuite spaceDoc persistence and convergence rejection spike

**Feature:** `blocksuite-spacedoc-persistence-and-convergence-spike`
**Date:** 2026-08-07
**Status:** Proposed; intent approved, task-list approval pending
**Classification:** Critical spike / Standard-tier lane
**Forge issue:** `8dfbe355-366a-4518-b377-9f3eccf2745d`

## Purpose

Reach a fast evidence-backed GO or NO-GO on BlockSuite `0.19.5` before any artifact,
Custom Mode, or renderer implementation depends on it. The spike tests the actual persisted
`Doc.spaceDoc` topology and semantic APIs under browserless Bun rather than assuming that raw
Yjs convergence proves BlockSuite compatibility.

## Success criteria

The result is GO only when one deterministic focused command proves all of the following on
exact BlockSuite `0.19.5`:

1. only public package exports are used;
2. an Affine document persists from and restores into `Doc.spaceDoc` with stable block IDs,
   nesting, and text;
3. a browserless Bun process performs semantic `Doc` mutations and two clients converge;
4. no editable document is exposed before canonical state applies and `Doc.load()` succeeds;
5. reconnecting an offline client cannot replace or lose newer canonical content;
6. a frozen `0.19.5` fixture loads deterministically;
7. focused tests, Roadmap lint/typecheck, source-test coupling, and repo-tooling checks pass.

Any core assertion failure is **NO-GO**. A missing, hung, suppressed, or non-reconstructable
result is **INCOMPLETE**, never GO.

## Out of scope

- BlockSuite adoption, fork, patch-package change, or version upgrade
- private/protected package fields or unpublished import paths
- global error suppression, ignored exceptions, polling, sleeps, or readiness timers
- `packages/contracts`, `packages/db`, `apps/platform-web`, meeting, workboard, renderer registry,
  Custom Mode schema, production editor wiring, or UI rollout
- transport/provider redesign, Supabase/Hocuspocus rollout, and production persistence changes
- accessibility, performance, export, custom-block, and page/edgeless UI gates owned by later spikes

## Approach selected

Create an evidence-only headless Bun test under
`apps/roadmap-web/tests/blocksuite-spike/` and freeze a synthetic `0.19.5` fixture beside it.
Use `@blocksuite/store`, `@blocksuite/blocks/schemas`, and existing Yjs only. The test may use
small local functions to create a public-API document, take a semantic snapshot, enforce a
canonical-load barrier, and exchange deltas. It must not change production editor/provider code.

This is the smallest slice that can reject the dependency for the specified core reasons.
Reusing production `HybridProvider` would mix BlockSuite viability with transport behavior;
using raw Yjs maps would not prove BlockSuite semantics.

## Constraints

- Pin all five direct BlockSuite dependencies in Roadmap to exact `0.19.5`; keep both tracked
  Bun locks consistent.
- Headless model imports use the public `@blocksuite/blocks/schemas` export, not the root UI
  package or effects entrypoint.
- Semantic mutation uses `Doc.addBlock`, `Doc.updateBlock`, `Doc.getBlock`, and public `Text`.
- Persistence uses `Doc.spaceDoc`; `_ySpaceDoc`, `yBlocks`, and package source paths are forbidden.
- Canonical bytes apply before `Doc.load()` and before returning an editable handle.
- Fixture content is synthetic and contains no application/user data.
- No failure may be caught and reclassified as PASS.

## Edge cases

- Empty canonical state creates a document only through an explicit initializer after load.
- Malformed/incompatible bytes fail closed without yielding an editable document.
- Slow or failed canonical load never becomes editable based on elapsed time.
- Concurrent clients edit different existing block IDs and exchange updates in both orders.
- An offline client's delta is older than a canonical client's delta at reconnect.
- Repeated application of the same delta is idempotent and does not duplicate roots or children.
- The frozen legacy fixture retains document ID, block IDs, nesting, and text.

## Result policy

The implementation records exactly one outcome in `decisions.md`:

- **GO:** every core assertion and required gate passes on the recorded exact versions.
- **NO-GO:** any core assertion fails, including a headless import/DOM failure.
- **INCOMPLETE:** execution cannot produce deterministic evidence. This blocks GO.

A NO-GO does not authorize a workaround, suppression, private API, fork, renderer change, or
alternative implementation in this issue. It ends the spike and reports the failing invariant.

## Ambiguity policy

Use the `/dev` seven-dimension decision rubric. At least 80% confidence permits the smallest
in-scope choice with a decision-log entry. Below 80%, stop and ask. Any ambiguity that could
weaken a core gate, widen owned paths, or turn failure into PASS is blocked regardless of score.

## Technical research

The complete research bundle, including exact published API evidence, DRY/codebase findings,
OWASP pass, alternatives, and TDD scenarios, is in
`docs/research/blocksuite-spacedoc-persistence-and-convergence-spike.md`.

Key findings:

- `Doc.spaceDoc` is public and returns the Yjs subdocument that backs blocks.
- `@blocksuite/blocks/schemas` is the public model-only Affine schema entrypoint.
- `Doc.load()` is synchronous in `0.19.5`; readiness timers are unnecessary for the headless path.
- Roadmap's manifest ranges drift even though both current locks resolve `0.19.5`.
- Existing persistence/realtime fakes can inform the fixture, but production provider/editor code
  is not needed for the rejection test.

## Files permitted during implementation

- `apps/roadmap-web/package.json`
- `apps/roadmap-web/bun.lock`
- `bun.lock`
- `apps/roadmap-web/tests/blocksuite-spike/**`
- this work folder's `decisions.md`

No other file is authorized without a new user decision and Forge scope update.

## Approval checkpoint

Intent is approved. This plan stage does not approve the task-list/final-lock gate and does not
authorize `/dev`. Implementation begins only after the main agent/user confirms the task list.
