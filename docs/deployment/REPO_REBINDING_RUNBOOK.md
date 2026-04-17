# Repo Rebinding Runbook

This runbook is the operator checklist for moving Vercel and Railway projects from the legacy repositories to this monorepo.

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

## Manual Steps

### 1. Export Existing Platform Settings

For each platform object, record:

- project / service name
- linked repository
- production branch
- root directory
- build command
- install command
- start command
- env vars present in preview, staging, and production
- domains attached

Use [SERVICE_INVENTORY.md](SERVICE_INVENTORY.md) as the baseline.

### 2. Validate Monorepo Roots Before Rebinding

Run:

```bash
bun run verify:deployment
```

Then validate each service in CI:

- `meeting-web-ci`
- `meeting-api-ci`
- `roadmap-web-ci`
- `roadmap-web-playwright`

### 3. Non-Prod Rebinding First

- Reconnect preview or staging Vercel projects to this repo.
- Reconnect Railway staging or preview deployment source to this repo.
- Keep production objects on the legacy repos until staging is green.

### 4. Production Rebinding

For each live platform object:

1. reconnect the Git source to this monorepo
2. set the root directory
3. verify build, install, and start commands
4. run a controlled deployment
5. smoke test the live URL
6. disable legacy repo auto-deploy immediately

## Risk Checklist

- Wrong root directory selected
- Missing env vars after reconnect
- Old repo still auto-deploying
- Railway service using the wrong path-as-root
- Vercel project still building from cached legacy settings
- Preview URLs attached to the wrong PR or branch

## Success Criteria

- one monorepo PR can generate the expected Vercel preview deployments
- Railway preview deploys from `apps/meeting-api/backend`
- production domains remain attached to the same Vercel and Railway objects
- old repos stop triggering deploys after cutover
