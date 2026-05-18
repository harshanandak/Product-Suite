# PR10 Canvas Boundary Extraction Research

Date: 2026-05-18
Status: active

## Current Coupling

- `apps/roadmap-web/src/components/blocksuite/hybrid-provider.ts` owns Yjs sync, Supabase realtime channels, Supabase metadata updates, unload saves, and local dirty state.
- `apps/roadmap-web/src/components/blocksuite/storage-client.ts` owns Supabase Storage access for Yjs binary state.
- `apps/roadmap-web/src/components/blocksuite/simple-canvas.tsx` creates the Supabase client directly and passes it into `HybridProvider`.
- `apps/roadmap-web/next.config.ts` carries BlockSuite-specific transpilation and webpack compatibility rules. Those remain shell-specific for this PR.

## Boundary Direction

Create `packages/ui-canvas` as a thin canvas boundary package. It should define reusable canvas identity, persistence, realtime, and metadata interfaces plus small pure helpers. Roadmap keeps the concrete Supabase implementation behind adapters.

This avoids moving the full BlockSuite editor into a package before the transport/persistence seam is proven.

## Validation Focus

- Package tests must prove helpers and adapter contracts are reusable without importing Supabase, Next, or BlockSuite.
- Roadmap tests must prove the shell creates Supabase-backed canvas adapters while `HybridProvider` consumes only boundary interfaces.
- Repo tooling tests must include the new package in workspace, validation, and CI path filters.
