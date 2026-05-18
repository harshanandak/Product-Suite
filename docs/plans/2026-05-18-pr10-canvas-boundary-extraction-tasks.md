# PR10 Canvas Boundary Extraction Tasks

## Task 1: Add Shared Canvas Boundary Package

OWNS: `packages/ui-canvas/**`, `package.json`, `docs/VALIDATION.md`, `.github/workflows/*.yml`, `test/repo-tooling.test.js`

File(s):
- `packages/ui-canvas/package.json`
- `packages/ui-canvas/src/index.ts`
- `packages/ui-canvas/src/index.test.ts`
- `package.json`
- `docs/VALIDATION.md`
- `.github/workflows/meeting-web-ci.yml`
- `.github/workflows/repo-tooling-ci.yml`
- `.github/workflows/roadmap-web-ci.yml`
- `.github/workflows/roadmap-web-playwright.yml`
- `test/repo-tooling.test.js`

What to implement:
- Create `@product-suite/ui-canvas` with pure canvas identity, storage path, editor mode, persistence, realtime, and metadata boundary contracts.
- Register it in root workspaces, validation scripts, docs, and CI path filters.

TDD steps:
1. Write tests proving storage path/editor mode behavior, invalid ID rejection, and absence of Supabase/Next/BlockSuite imports.
2. Run package tests and confirm they fail before the package implementation exists.
3. Implement the package and tooling wiring.
4. Run package and repo-tooling tests until passing.
5. Commit: `feat: add canvas boundary package`.

Expected output:
- `bun run --cwd packages/ui-canvas test` passes.
- `bun run test:repo-tooling` passes.

## Task 2: Inject Canvas Boundaries Into Roadmap Sync

OWNS: `apps/roadmap-web/src/components/blocksuite/**`, `apps/roadmap-web/package.json`, `apps/roadmap-web/next.config.ts`

File(s):
- `apps/roadmap-web/src/components/blocksuite/canvas-boundary.ts`
- `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts`
- `apps/roadmap-web/src/components/blocksuite/persistence-types.ts`
- `apps/roadmap-web/src/components/blocksuite/simple-canvas.tsx`
- `apps/roadmap-web/src/components/blocksuite/storage-client.ts`
- `apps/roadmap-web/src/components/blocksuite/use-blocksuite-sync.ts`
- `apps/roadmap-web/src/components/blocksuite/__tests__/canvas-boundary.test.ts`
- `apps/roadmap-web/package.json`
- `apps/roadmap-web/next.config.ts`

What to implement:
- Add Supabase adapter factories in roadmap and update `HybridProvider` to consume injected persistence, realtime, and metadata boundaries instead of a raw Supabase client.
- Keep BlockSuite and Next config in roadmap.

TDD steps:
1. Write tests proving roadmap adapters are Supabase-specific while `HybridProvider` uses boundary imports and no longer imports `@supabase/supabase-js`.
2. Run the tests and confirm they fail before the refactor.
3. Refactor provider and shell wiring.
4. Run roadmap focused tests and typecheck until passing.
5. Commit: `feat: inject canvas sync boundaries`.

Expected output:
- `bun run --cwd apps/roadmap-web test src/components/blocksuite/__tests__/canvas-boundary.test.ts` passes.
- `bun run --cwd apps/roadmap-web typecheck` passes.
