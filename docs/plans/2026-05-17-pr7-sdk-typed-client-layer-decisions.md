# PR7 SDK / Typed Client Layer Decisions

## Initial Plan
- Decision: create `@product-suite/sdk` as a small hand-written package first, not an OpenAPI-generated client.
- Reason: the repo does not currently expose a verified OpenAPI source for Meeting API, and the first goal is to remove duplicated ad hoc request shapes with minimal behavior change.
- Decision: keep `apps/meeting-web/src/lib/api.js` as a compatibility facade.
- Reason: existing app pages/hooks import that module directly; PR7 should move endpoint ownership without forcing a broad caller rewrite.
- Decision: keep runtime config and hosted auth client wiring in `meeting-web`.
- Reason: those concerns depend on browser storage, Vite env fallback, and the Neon React adapter, while the SDK should stay transport/runtime agnostic.
