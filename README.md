# Product Suite Monorepo

This repository is the single Git source for:

- retained unsupported Roadmap source under `apps/roadmap-web`
- `apps/platform-web`
- `apps/platform-api`
- `apps/meeting-web`
- `apps/meeting-api/backend`
- historical database roots under `infra/supabase` and the legacy Meeting paths
- shared code in `packages/*`
- backend runtimes in `services/*`

## Purpose

The supported Vercel and Railway service identities point at this monorepo while preserving their production domains and project/service objects. Deployments flow from `harshanandak/Product-Suite`, and each supported platform object is scoped to its app-specific root directory.

## Dependency Management

- `apps/platform-web` and `apps/platform-api` use `bun`
- `apps/meeting-web` uses `bun`
- `apps/meeting-api/backend` uses `pip` with Python `3.13`

`apps/roadmap-web` has no package manifest, install command, or supported runtime.

This keeps the supported JavaScript workspace and Python service toolchains independent while allowing them to share repository contracts and validation.

## Repo Topology

- Supported app directories contain deployable product shells or app roots; `apps/roadmap-web` is retained unsupported source.
- `apps/meeting-api/backend` remains a Python service root even though its repo folder sits under `apps/meeting-api`.
- `packages/*` contains shared contracts, SDK, database, and UI building blocks.
- `services/*` contains standalone backend runtimes such as agent-core and Hocuspocus.

The root Bun workspace includes the supported JavaScript apps, shared packages, and JavaScript services. The Python backend is first-class in repo tooling and deployment docs, but it is not treated as a Bun workspace package.

## App Layout

- `apps/roadmap-web` contains archived historical Roadmap source without a supported runtime or deployment target; see `apps/roadmap-web/ARCHIVED.md`.
- `apps/platform-web` contains the supported Vite platform frontend.
- `apps/platform-api` contains the supported Bun platform API.
- `apps/meeting-web` contains the Vite Meeting-Agent frontend.
- `apps/meeting-api/backend` contains the FastAPI Meeting-Agent backend.
- `apps/meeting-api/tests/backend` contains the backend pytest suite.
- `packages/` contains shared monorepo building blocks used by the supported Vite apps and services.
- `services/` contains standalone agent-core and Hocuspocus runtimes.
- `infra/supabase` and `apps/roadmap-web/supabase/migrations` are preserved
  historical roots for the unsupported legacy Roadmap application; they are not
  active database configuration.

## Deployment Notes

- Deployment roots and live platform mappings are maintained in the deployment inventory.
- Neon is the sole live Postgres authority for supported Product Suite services.
- Neon PostgreSQL (`neondb`, schema `public`) is the sole live Postgres authority
  and sole supported live database. Supabase and Alembic paths are historical evidence only; R2 remains
  an independent object-storage system.

The current migration plane is Drizzle in `packages/db/migrations`, with
`packages/db/migrations/meta/_journal.json` as its only pending journal. The
applied floor is `0019_neon_authority_reconciliation`; production pins
`original-production`, while fresh/staging/test pin `repaired-bootstrap`.

PR A consumes candidate `0020_meeting_authority_foundation.sql` on both variants:

```text
bun run migrate:database -- apply --history-variant <variant> --expected-pending <ordered-tags>
bun run migrate:database -- verify --history-variant <variant> --expected-floor <tag>
```

The required real-Neon lane is INCOMPLETE when its disposable-project
credentials are unavailable; it must fail closed rather than report a skipped
run as success.

See [docs/deployment/SERVICE_INVENTORY.md](docs/deployment/SERVICE_INVENTORY.md) and [docs/deployment/REPO_REBINDING_RUNBOOK.md](docs/deployment/REPO_REBINDING_RUNBOOK.md).

Architecture ownership boundaries for shared domains are recorded in [docs/architecture/schema-domain-ownership.md](docs/architecture/schema-domain-ownership.md).

## Validation

Run repo validation from the root with the documented commands in [docs/VALIDATION.md](docs/VALIDATION.md).
