# Service Inventory

This inventory records supported deploy inputs and explicitly labels retained
legacy services. An archived service is not a production or database-authority
claim.

## Platform Objects

| Service | Platform | Current Repo | Current Branch | Current Build Command | Current Root Dir | Current Production Domain | Current Preview Behavior | Env / Secret Ownership |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `roadmap-web` (archived/unsupported) | `Vercel` (retired binding) | `Product-Suite` (historical source) | `main` | Not a supported deploy input | `apps/roadmap-web` (retained source) | None verified | No supported preview or production workflow | No supported database authority; historical provider env names remain only in the unsupported source boundary |
| `meeting-web` | `Vercel` | `Product-Suite` | `main` | `bun run build` from [apps/meeting-web/package.json](../../apps/meeting-web/package.json) | `apps/meeting-web` on the live Vercel project | `https://meeting-agent-coral.vercel.app` from the live `meeting-agent` Vercel project | Git-based Vercel previews from `harshanandak/Product-Suite` | Not stored in repo; frontend env names are documented in [apps/meeting-web/README.md](../../apps/meeting-web/README.md) |
| `meeting-api` | `Railway` | `Product-Suite` | `main` | `python -m uvicorn server:app --host 0.0.0.0 --port ${PORT}` from [apps/meeting-api/backend/railway.json](../../apps/meeting-api/backend/railway.json) | `/apps/meeting-api/backend` on the live Railway service | `https://backend-production-089a.up.railway.app` from the live `backend` Railway service | GitHub Actions preview workflow now targets the monorepo and the production service source repo is `harshanandak/Product-Suite` | Runtime env names are documented in [apps/meeting-api/backend/.env.example](../../apps/meeting-api/backend/.env.example) and deployment docs |

## Target Roots In This Monorepo

- `roadmap-web` -> `apps/roadmap-web` (unsupported/archived source only)
- `meeting-web` -> `apps/meeting-web`
- `meeting-api` -> `apps/meeting-api/backend`

## Repo Topology Notes

- The root Bun workspace currently covers only the JavaScript web apps.
- `meeting-api` is a first-class deployable service in repo tooling and deployment docs, but it is not a Bun workspace package.
- `packages/` and `services/` are reserved for future shared blocks and standalone runtimes; they do not change current deploy roots.
- PR21 adds shell-native module entries in `roadmap-web`; the retained Roadmap source is not a supported production service. `meeting-web` remains an independently deployed Vite runtime with standalone routes while `/meetings` is the platform shell-owned user-facing entry path.

See also [../architecture/schema-domain-ownership.md](../architecture/schema-domain-ownership.md) for canonical shared-domain ownership before contract extraction work.

## Post-Cutover Notes

- Meeting database authority is Neon Postgres through `packages/db/migrations`; there is no supported Supabase database cutover.
- `roadmap-web` is explicitly unsupported/archived. Its historical source and migrations are immutable evidence, not active deployment inputs.

- `meeting-api` preview automation still requires a valid `RAILWAY_API_TOKEN` secret in `harshanandak/Product-Suite`.
- The Railway health endpoint currently responds from the monorepo deployment, but still reports `database: false`, which is an application readiness issue rather than a repo-binding issue.
