# Repo Rebinding Runbook

This runbook records the verified cutover state after moving the live Vercel and Railway projects from the legacy repositories to this monorepo.

## Target Mapping

- `Vercel / Roadmap` -> repo `Product-Suite`, root `apps/roadmap-web`
- `Vercel / Meeting frontend` -> repo `Product-Suite`, root `apps/meeting-web`
- `Railway / Meeting API` -> repo `Product-Suite`, root `apps/meeting-api/backend`

## Install Commands

- `roadmap-web`: `bun install --frozen-lockfile`
- `meeting-web`: `bun install`
- `meeting-api`: `py -3.13 -m pip install -r apps/meeting-api/backend/requirements.txt`

## Build Commands

- `roadmap-web`: `bun run build` (`next build --webpack` in the monorepo copy)
- `meeting-web`: `bun run build`
- `meeting-api`: Railway start command remains defined in `apps/meeting-api/backend/railway.json`

## Verified Live State

- `Vercel / Meeting frontend`
  - project: `meeting-agent`
  - git repo: `harshanandak/Product-Suite`
  - root directory: `apps/meeting-web`
  - install command: `bun install --frozen-lockfile`
  - build command: `bun run build`
  - affected deployments: enabled
- `Vercel / Roadmap`
  - project: `roadmap`
  - git repo: `harshanandak/Product-Suite`
  - root directory: `apps/roadmap-web`
  - install command: `bun install --frozen-lockfile`
  - build command: `bun run build`
  - affected deployments: enabled
- `Railway / Meeting API`
  - project: `meeting-agent`
  - service: `backend`
  - git repo: `harshanandak/Product-Suite`
  - root directory: `/apps/meeting-api/backend`
  - watch path: `apps/meeting-api/backend/**`
  - production domain preserved: `https://backend-production-089a.up.railway.app`

## Remaining Operator Tasks

### 1. Add Railway preview repo configuration in GitHub

The monorepo workflow now expects:

- repository variables:
  - `RAILWAY_PROJECT_ID`
  - `RAILWAY_BASE_ENVIRONMENT`
  - `RAILWAY_BACKEND_SERVICE`
- repository secret:
  - `RAILWAY_API_TOKEN`

The non-secret values are now stored in `harshanandak/Product-Suite`. The only remaining missing credential is `RAILWAY_API_TOKEN`.

### 2. Confirm post-cutover app readiness

- `meeting-web` and `roadmap-web` are Git-bound to the monorepo, but they have not yet produced a fresh Git-triggered Vercel deployment from a post-cutover app-path commit.
- `meeting-api` is deploying from the monorepo and the public health endpoint responds, but the current payload still reports `database: false`, so backend runtime readiness needs separate environment verification.

## Risk Checklist

- Wrong root directory selected
- Missing env vars after reconnect
- Old repo still auto-deploying
- Railway service using the wrong path-as-root
- Vercel project still building from cached legacy settings
- Preview URLs attached to the wrong PR or branch

## Success Criteria

- Vercel projects resolve to `harshanandak/Product-Suite` with the expected root directory
- Railway production deploys resolve to `harshanandak/Product-Suite` with root `/apps/meeting-api/backend`
- production domains remain attached to the same Vercel and Railway objects
- old repositories no longer drive those preserved live platform objects
