# BlockSuite spaceDoc persistence and convergence spike research

Date: 2026-08-07
Status: plan evidence only
Forge issue: `8dfbe355-366a-4518-b377-9f3eccf2745d`

## Decision fed by this research

Decide whether the already-used BlockSuite `0.19.5` release can remain a candidate for
canonical document work. This spike is a rejection gate, not adoption or renderer rollout.
Any failure of persistence, headless semantic mutation, two-client convergence,
canonical-load locking, or reconnect overwrite safety produces **NO-GO**.

## Exact dependency state

- Pre-pin baseline: `apps/roadmap-web/package.json:31-35` declared five BlockSuite packages as
  `^0.19.5`, so the manifest does not guarantee the evaluated release.
- At that baseline, `bun.lock:564-612` and `apps/roadmap-web/bun.lock:242-272` resolved the
  BlockSuite graph to `0.19.5`, including `@blocksuite/store@0.19.5` with integrity
  `sha512-PK+4wQtwk0U4Y...Y3ZjbPUxo0vLw==`.
- The published `@blocksuite/store@0.19.5` tarball has SHA-1
  `3b933060bbbbdc028907dc02adbbb49f95e8728d`; the published
  `@blocksuite/blocks@0.19.5` tarball has SHA-1
  `e6d1a5e7308473debe86bb2fedf29ce1abbd085f`.
- BlockSuite's official `v0.19.5` release is commit `df17751`:
  <https://github.com/toeverything/blocksuite/releases/tag/v0.19.5>.

The spike must replace the five caret ranges with exact `0.19.5` values and regenerate
both tracked Bun locks. Yjs remains at its existing compatible range; changing it would
evaluate two variables at once.

## Verified public API topology in 0.19.5

The published package source and declaration exports establish these supported entrypoints:

- `@blocksuite/store` publicly exports `Doc`, `DocCollection`, `Schema`, and `Text`.
- `Doc.spaceDoc` is a public getter returning the document's Yjs subdocument. The backing
  `_ySpaceDoc` field is protected and marked internal; the spike must never access it.
- `Doc.load(init?)` is synchronous in `0.19.5` and returns the same `Doc`; it calls the
  Yjs subdocument's `load()`, installs block observers, runs the optional initializer,
  and marks the block collection ready.
- `Doc.addBlock`, `Doc.updateBlock`, `Doc.getBlock`, and `Doc.getBlocksByFlavour` are the
  semantic document APIs. Direct reads or writes to the internal `blocks` Y.Map are forbidden.
- `DocCollection.meta.initialize()`, `DocCollection.createDoc({ id })`, and
  `DocCollection.getDoc(id)` are public lifecycle APIs.
- `@blocksuite/blocks/schemas` is a public export whose source comment says it imports
  models only. It exports `AffineSchemas` without requiring the editor effects entrypoint.

Primary artifacts:

- <https://unpkg.com/@blocksuite/store@0.19.5/dist/index.d.ts>
- <https://unpkg.com/@blocksuite/store@0.19.5/dist/store/doc/doc.d.ts>
- <https://unpkg.com/@blocksuite/store@0.19.5/dist/store/collection.d.ts>
- <https://unpkg.com/@blocksuite/blocks@0.19.5/dist/schemas.d.ts>
- <https://registry.npmjs.org/@blocksuite/store/-/store-0.19.5.tgz>
- <https://registry.npmjs.org/@blocksuite/blocks/-/blocks-0.19.5.tgz>

## Existing code and reuse

- `apps/roadmap-web/src/components/blocksuite/blocksuite-editor.tsx:155-187` already
  constructs a `Schema`, registers `AffineSchemas`, initializes `DocCollection.meta`,
  creates a document, and adds page/surface/note/paragraph blocks.
- `apps/roadmap-web/src/components/blocksuite/use-blocksuite-sync.ts:35-48` already names
  `editor.doc.spaceDoc` as the persistence boundary.
- `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts:165-170` persists a full
  Yjs state update, and lines 336-348 load by applying an update with remote origin.
- Existing `hybrid-provider.test.ts` and `canvas-boundary.test.ts` provide small in-memory
  persistence/realtime fakes that can be copied into a headless test fixture without adding
  a dependency or changing `packages/ui-canvas`.

The existing editor also globally suppresses BlockSuite errors and waits with readiness
timers (`blocksuite-editor.tsx:15-29,236-265`). Those paths are explicitly outside this
spike and cannot count as evidence. Passing evidence must come from a browserless Bun test
that imports only public model/store entrypoints.

## Selected spike shape

Use one headless Bun test file and small local fixtures under
`apps/roadmap-web/tests/blocksuite-spike/`. It will:

1. build an Affine document through `Schema`, `AffineSchemas`, `DocCollection`, `Text`,
   `Doc.load`, `Doc.addBlock`, and `Doc.updateBlock`;
2. persist and restore only `Doc.spaceDoc` with public Yjs encoding/apply APIs;
3. seed two clients from the same canonical bytes, perform semantic BlockSuite mutations,
   exchange Yjs deltas in both directions, and compare semantic block IDs, nesting, and text;
4. expose no editable document until canonical bytes have applied and `Doc.load()` succeeds;
5. simulate offline edits plus newer canonical edits, reconnect by applying both deltas, and
   prove the saved merged state retains canonical content rather than replacing it;
6. load a checked-in `0.19.5` golden fixture and assert its stable IDs and nesting.

The harness returns PASS only if every assertion completes. Import failure, DOM dependency,
load error, lost semantic content, non-convergence, edit-before-load, or canonical loss is a
core failure and records NO-GO. Missing or timed-out evidence is INCOMPLETE and also cannot GO.

## Alternatives rejected

1. **Wire the spike into `BlockSuiteEditor`.** Rejected because renderer rollout, readiness
   timers, and current suppression behavior would contaminate headless evidence.
2. **Exercise raw Y.Maps.** Rejected because raw CRDT convergence would not prove BlockSuite
   semantic mutation APIs or schema/model reconstruction.
3. **Use private fields, patch the package, or fork.** Rejected by scope and because it would
   convert a public-API rejection gate into a maintenance commitment.
4. **Change `HybridProvider` during the spike.** Rejected: existing transport behavior is not
   needed to prove the core BlockSuite topology and would enlarge the blast radius.

## OWASP Top 10 pass

| Category | Applies | Spike treatment |
| --- | --- | --- |
| A01 Broken Access Control | No authority change | No API, tenant, auth, or viewer path is touched. |
| A02 Cryptographic Failures | No | Fixtures contain synthetic text only; no secrets or user data. |
| A03 Injection | Low | No HTML/editor effects are loaded; assertions use fixed synthetic strings. |
| A04 Insecure Design | Blocked | Canonical-load locking, convergence, and reconnect remained unverified after the Task 2 hard stop. |
| A05 Security Misconfiguration | Yes | Exact pins and public export guards prevent silent version drift. |
| A06 Vulnerable Components | Advisory | Existing dependency only; release/security scanning remains a later adoption gate. |
| A07 Identification/Auth Failures | No | No identity surface is changed. |
| A08 Software/Data Integrity | Yes | Golden fixture hash, exact package versions, stable IDs, and semantic round-trip are asserted. |
| A09 Logging/Monitoring Failures | Yes | No error suppression; failures are explicit GO/NO-GO evidence. |
| A10 SSRF | No | The headless test performs no network requests. |

## TDD scenarios

1. **Public API/persistence:** an Affine page with stable IDs and text is encoded from
   `source.spaceDoc`, applied to `target.spaceDoc`, loaded, and recovered semantically.
2. **Headless convergence:** two clients mutate different named blocks through BlockSuite APIs,
   exchange deltas, and converge to equal semantic snapshots.
3. **Canonical-load lock:** an attempted mutation before canonical load is rejected; after load,
   mutation succeeds through `Doc.updateBlock`.
4. **Reconnect safety:** an offline client and canonical client each edit; applying both deltas
   preserves canonical and offline edits, and persisted merged bytes reproduce both.
5. **Legacy fixture:** a frozen `0.19.5` spaceDoc fixture restores its IDs, parent-child nesting,
   and text exactly.
6. **Failure path:** malformed or incompatible canonical bytes yield NO-GO and never expose an
   editable document.

## Unresolved API risks for the spike to settle

- Whether `@blocksuite/blocks/schemas` imports cleanly in the repository's actual Bun runtime.
- Whether applying a stored subdocument update before `Doc.load()` reconstructs models without
  relying on collection root metadata beyond explicit public initialization.
- Whether independent semantic edits against cloned `spaceDoc` state converge without root-block
  duplication or unstable model IDs.
- Whether a persisted legacy fixture validates under the default `enable_legacy_validation` path.

Each is intentionally a core gate. The plan does not pre-decide the result.
