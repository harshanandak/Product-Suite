# Product Suite Monorepo

This repository is the single Git source for:

- `apps/roadmap-web`
- `apps/meeting-web`
- `apps/meeting-api/backend`
- `infra/supabase`
- future shared code in `packages/*`
- future backend runtimes in `services/*`

## Purpose

The existing Vercel and Railway service identities now point at this monorepo while preserving their production domains and project/service objects. Deployments flow from `harshanandak/Product-Suite`, and each platform object is scoped to its app-specific root directory.

## Dependency Management

- `apps/meeting-web` uses `bun`
- `apps/roadmap-web` uses `bun`
- `apps/meeting-api/backend` uses `pip` with Python `3.13`

This keeps the transition safe while the apps still carry different runtime stacks. Shared packages can be extracted later without forcing the Python service into the JavaScript workspace toolchain.

## Repo Topology

- `apps/*` are deployable product shells or deployable app roots.
- `apps/meeting-api/backend` remains a Python service root even though its repo folder sits under `apps/meeting-api`.
- `packages/*` is reserved for future shared building blocks.
- `services/*` is reserved for future standalone backend runtimes.

The root Bun workspace intentionally includes only the JavaScript web apps. The Python backend is first-class in repo tooling and deployment docs, but it is not treated as a Bun workspace package.

## App Layout

- `apps/roadmap-web` contains the Next.js Roadmap product.
- `apps/meeting-web` contains the Vite Meeting-Agent frontend.
- `apps/meeting-api/backend` contains the FastAPI Meeting-Agent backend.
- `apps/meeting-api/tests/backend` contains the backend pytest suite.
- `packages/` is reserved for shared monorepo building blocks that will be extracted later.
- `services/` is reserved for future standalone backend runtimes.
- `infra/supabase` contains Roadmap Supabase migrations and config.

## Deployment Notes

- Deployment roots and live platform mappings are maintained in the deployment inventory.
- `Neon`, `Supabase`, and `R2` remain environment/data systems. They are not repo-linked deploy targets.

See [docs/deployment/SERVICE_INVENTORY.md](docs/deployment/SERVICE_INVENTORY.md) and [docs/deployment/REPO_REBINDING_RUNBOOK.md](docs/deployment/REPO_REBINDING_RUNBOOK.md).
