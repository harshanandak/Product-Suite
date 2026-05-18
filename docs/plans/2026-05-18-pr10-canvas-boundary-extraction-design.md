# PR10 Canvas Boundary Extraction Design

## Feature

- Slug: `pr10-canvas-boundary-extraction`
- Date: 2026-05-18
- Status: active
- Beads: `product-suite-c46`

## Purpose

Isolate canvas transport, persistence, and metadata behavior behind reusable contracts before extracting more BlockSuite UI. This lets roadmap keep current product behavior while proving that canvas sync does not require Supabase or Next assumptions in a shared package API.

## Success Criteria

- `packages/ui-canvas` exists and exports canvas identity, storage path, editor mode, persistence, realtime, and metadata boundary contracts.
- `packages/ui-canvas` has tests proving it has no Supabase, Next, or BlockSuite runtime dependency.
- Roadmap `HybridProvider` no longer accepts a Supabase client directly; it consumes injected persistence, realtime, and metadata adapters.
- Roadmap keeps concrete Supabase storage/realtime/metadata adapters in app-owned files.
- Root workspace, validation docs, CI path filters, and repo tooling tests include `packages/ui-canvas`.

## Out Of Scope

- Do not move the full BlockSuite editor UI into `packages/ui-canvas` yet.
- Do not change database schema, Supabase policies, or storage bucket names.
- Do not replace BlockSuite, Yjs, or current Next config hacks in this PR.
- Do not alter canvas routes, permissions, or visible editor behavior.

## Approach Selected

Use a boundary-first extraction:

1. Add `packages/ui-canvas` with pure contracts and utilities.
2. Add roadmap Supabase adapter factories that implement those contracts.
3. Update `HybridProvider`, `useBlockSuiteSync`, and `SimpleCanvas` to consume injected boundaries instead of raw Supabase clients.
4. Update repo tooling and documentation.

This is selected over a full UI extraction because the plan identifies canvas as risky and specifically calls for provider/persistence interfaces first.

## Constraints

- Shared package code must not import `@supabase/*`, `next/*`, `@blocksuite/*`, or app aliases.
- Existing storage path format remains `{team_id}/{doc_id}.yjs`.
- Existing realtime payload validation remains in roadmap before applying Yjs updates.
- Shell-specific `next.config.ts` BlockSuite compatibility stays in roadmap.

## Edge Cases

- Invalid team/document IDs must still be rejected before storage or realtime use.
- Remote Yjs updates must not be rebroadcast locally.
- Save metadata must only clear dirty state when the metadata store confirms an update matched a document.
- Disabled sync must still return non-loading state without creating providers.

## Ambiguity Policy

Use the 7-dimension `/dev` decision gate. Proceed without user input only when the gap scores 0-3, does not change auth/data exposure/schema, and stays within the boundary-first canvas scope. Stop for user input for schema, route, permission, or full UI extraction decisions.

## Technical Research

### Codebase Search

- `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts` currently owns realtime, metadata, unload save, and Yjs update application.
- `apps/roadmap-web/src/components/blocksuite/storage-client.ts` owns Supabase Storage state save/load/delete/list.
- `apps/roadmap-web/src/components/blocksuite/simple-canvas.tsx` creates Supabase clients inside the UI surface.
- `apps/roadmap-web/next.config.ts` contains shell-specific BlockSuite package transpilation and webpack module resolution rules.

### OWASP Review

- A01 Broken Access Control: preserve team/document identity validation and team-scoped metadata updates.
- A03 Injection: keep ID sanitization/validation for storage paths and channel names.
- A05 Security Misconfiguration: do not move Next/BlockSuite config into shared package.
- A08 Software And Data Integrity: validate realtime payload shape before applying Yjs updates.
- A09 Logging And Monitoring: preserve existing warning/error paths for failed sync operations.

### TDD Scenarios

- Happy path: shared package creates stable storage paths and editor modes without app-specific imports.
- Error path: invalid canvas identity rejects unsafe IDs.
- Integration path: roadmap Supabase adapters implement persistence/realtime/metadata contracts and `HybridProvider` no longer accepts raw Supabase clients.
