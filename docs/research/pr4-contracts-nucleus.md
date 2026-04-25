# PR4 Contracts Nucleus Research

Date: 2026-04-24

## Verified Current State

- Root repo tooling now validates all three deployables, but the root workspace list in `package.json` still only names the two JS apps. `packages/contracts` will need explicit workspace wiring before app imports can be truthful.
- `apps/roadmap-web` is TypeScript/Next with bundler resolution and only an `@/*` local alias today. It can consume a package import, but PR4 must avoid introducing app-specific alias assumptions.
- `apps/meeting-web` is Vite + JavaScript. It has no TypeScript project file, so any shared contracts package must ship runnable JavaScript plus type declarations rather than TS-only source.
- `apps/meeting-api` is Python. It cannot consume TypeScript directly, so PR4 cannot pretend a TS-only package is shared across all three deployables.
- `docs/architecture/schema-domain-ownership.md` is now the canonical boundary source:
  - roadmap owns `team`, `workspace`, `thread`, and planning/task state
  - meeting-api owns `meeting`
  - `artifact` is explicitly split by artifact type
- `apps/meeting-api/backend/routes/runtime.py` already exposes a stable runtime payload shape for auth scope, tenant mode, backend/storage metadata, capabilities, engines, and summary policy.
- `apps/meeting-web/src/lib/api.js` already depends on a stable subset of those runtime payload fields:
  - `auth.provider`
  - `auth.neon.auth_url`
  - `apiBaseUrl`
- `apps/roadmap-web/src/lib/supabase/types.ts` already exposes the canonical roadmap-side wire tables for:
  - `chat_threads`
  - `chat_messages`
  - `blocksuite_documents`

## Baseline Checks Run In PR4 Worktree

- `bun run test` at repo root: passed
- `bun run test` in `apps/roadmap-web`: passed (`25/25`)
- `bun run test` in `apps/meeting-web`: passed (`107/107`)
- `bun run validate:meeting-api`: passed (`194` backend tests)

## Implications For PR4

1. PR4 must be **wire-contract-first**, not domain-model-first.
2. PR4 must not try to unify roadmap schema truth with meeting schema truth.
3. PR4 needs one package that JS apps can import directly and the Python backend can validate against indirectly.
4. The minimal shared surface is:
   - identity scope
   - conversation envelope
   - meeting core
   - canvas core
5. Tasks/workflows/webhooks stay out of PR4 even if they look adjacent.

## Recommended Technical Direction

Use `packages/contracts` as a **JSON-contract-first** package:

- source contract fixtures/schemas live in `packages/contracts`
- JS apps import typed JS/TS-friendly exports from the package
- Python tests consume the same serialized contract artifacts from disk

This keeps PR4 cross-language without dragging in SDK generation, OpenAPI expansion, or provider-specific auth logic too early.
