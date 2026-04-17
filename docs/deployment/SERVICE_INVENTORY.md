# Service Inventory

This inventory records the current verified deploy inputs before any platform rebinding work starts.

## Platform Objects

| Service | Platform | Current Repo | Current Branch | Current Build Command | Current Root Dir | Current Production Domain | Current Preview Behavior | Env / Secret Ownership |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `roadmap-web` | `Vercel` | `Roadmap` | `main` | `bun run build` from [apps/roadmap-web/package.json](../../apps/roadmap-web/package.json) | `next-app/` in the legacy repo | `https://platform-test-cyan.vercel.app` from [Roadmap README](C:/Users/harsha_befach/Downloads/Roadmap/README.md:9) | Git-based Vercel previews from the legacy repo | Not stored in repo; app env names are documented in [apps/roadmap-web/.env.example](../../apps/roadmap-web/.env.example) |
| `meeting-web` | `Vercel` | `Meeting-Agent` | `main` | `bun run build` from [apps/meeting-web/package.json](../../apps/meeting-web/package.json) | `frontend/` in the legacy repo, served via root [vercel.json](C:/Users/harsha_befach/Downloads/Meeting-Agent/vercel.json:1) | `https://meeting-agent-coral.vercel.app` from [frontend audit design doc](C:/Users/harsha_befach/Downloads/Meeting-Agent/docs/plans/2026-04-16-production-frontend-audit-design.md:7) | Git-based Vercel previews from the legacy repo | Not stored in repo; frontend env names are documented in [apps/meeting-web/README.md](../../apps/meeting-web/README.md) |
| `meeting-api` | `Railway` | `Meeting-Agent` | `main` | `python -m uvicorn server:app --host 0.0.0.0 --port ${PORT}` from [apps/meeting-api/backend/railway.json](../../apps/meeting-api/backend/railway.json) | `backend/` in the legacy repo | `https://backend-production-089a.up.railway.app` from [frontend audit design doc](C:/Users/harsha_befach/Downloads/Meeting-Agent/docs/plans/2026-04-16-production-frontend-audit-design.md:95) | GitHub Actions creates preview environments using Railway CLI from [meeting-api-railway-preview.yml](../../.github/workflows/meeting-api-railway-preview.yml) | Runtime env names are documented in [apps/meeting-api/backend/.env.example](../../apps/meeting-api/backend/.env.example) and deployment docs |

## Target Roots In This Monorepo

- `roadmap-web` -> `apps/roadmap-web`
- `meeting-web` -> `apps/meeting-web`
- `meeting-api` -> `apps/meeting-api/backend`

## Rebinding Rule

No platform object should be re-pointed until:

1. the corresponding root directory builds in this monorepo,
2. preview or staging deploys succeed from this repo, and
3. the old repo auto-deploy triggers are ready to be disabled immediately after cutover.
