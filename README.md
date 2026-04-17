# Product Suite Monorepo

This repository is the single Git source for:

- `apps/roadmap-web`
- `apps/meeting-web`
- `apps/meeting-api/backend`
- `infra/supabase`

## Purpose

The existing Vercel and Railway service identities now point at this monorepo while preserving their production domains and project/service objects. Deployments flow from `harshanandak/Product-Suite`, and each platform object is scoped to its app-specific root directory.

## Dependency Management

- `apps/meeting-web` uses `bun`
- `apps/roadmap-web` uses `bun`
- `apps/meeting-api/backend` uses `pip` with Python `3.13`

This keeps the transition safe while the apps still carry different runtime stacks. Shared packages can be extracted later without forcing the Python service into the JavaScript workspace toolchain.

## App Layout

- `apps/roadmap-web` contains the Next.js Roadmap product.
- `apps/meeting-web` contains the Vite Meeting-Agent frontend.
- `apps/meeting-api/backend` contains the FastAPI Meeting-Agent backend.
- `apps/meeting-api/tests/backend` contains the backend pytest suite.
- `infra/supabase` contains Roadmap Supabase migrations and config.

## Deployment Notes

- `Vercel / Roadmap` target root directory: `apps/roadmap-web`
- `Vercel / Meeting frontend` target root directory: `apps/meeting-web`
- `Railway / Meeting API` target root directory: `apps/meeting-api/backend`
- `Railway / Meeting API` watch path: `apps/meeting-api/backend/**`
- `Neon`, `Supabase`, and `R2` remain environment/data systems. They are not repo-linked deploy targets.

See [docs/deployment/SERVICE_INVENTORY.md](docs/deployment/SERVICE_INVENTORY.md) and [docs/deployment/REPO_REBINDING_RUNBOOK.md](docs/deployment/REPO_REBINDING_RUNBOOK.md).
