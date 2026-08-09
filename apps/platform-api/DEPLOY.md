# Platform API Deployment to Cloudflare Workers

## Prerequisites
- `wrangler` CLI installed and logged in (`wrangler whoami` to verify)
- Cloudflare account with a Workers enabled domain (or route configured)
- Clerk account with the `CLERK_SECRET_KEY` from your account settings
- A direct Neon migration connection string held only by the gated CI job

## Deployment Steps

### 1. Set up secrets (one time)
```bash
# From the repo root, or from apps/platform-api:
wrangler secret put CLERK_SECRET_KEY --env production
# Paste your Clerk secret key when prompted

wrangler secret put DATABASE_URL --env production
# Paste the pooled Neon runtime connection string: postgresql://...

wrangler secret put CLERK_AUTHORIZED_PARTIES --env production
# Paste the comma-separated list of Clerk-configured allowed origins
# e.g., https://api.befach.dev,https://app.befach.dev

wrangler secret put OPENROUTER_API_KEY --env production
# Paste your OpenRouter key — the /api/agent/* routes and KB embeddings call it
```

All four are verified by the deploy workflow's `preflight` job, which refuses to
migrate or deploy while any of them is unset.

The deployment workflow keeps the migration authority separate from the Worker:
configure `MIGRATION_DATABASE_URL` as an Actions environment secret for the
`db-migrate-production` approval gate. It must be a direct, TLS-enabled Neon URL
for `neondb`, used only by `provision:database-roles` and
`migrate:database`. Never add it with `wrangler secret put`, and never print the
URL, role password, or query output in a build log.

The migration gate provisions `product_suite_platform_runtime` and
`product_suite_meeting_runtime` as NOLOGIN grant roles, applies only the exact
declared suffix under an advisory lock, and then runs a read-only `verify` that
must report `NOOP`. Runtime `DATABASE_URL` remains pooled and is checked by the
Worker secret guard.

### 2. Deploy
```bash
cd apps/platform-api

# Development deploy (staging):
npm run deploy

# Production deploy:
npm run deploy:prod
```

### 3. Verify
```bash
# Check deployment status:
wrangler deployments

# Tail logs:
wrangler tail product-suite-platform-api

# Test the API health endpoint:
curl https://api.befach.dev/health
# Should return: { "ok": true }
```

## Monitoring
- Logs: `wrangler tail product-suite-platform-api`
- Dashboard: https://dash.cloudflare.com → Workers & Pages → product-suite-platform-api
- Uptime: Cloudflare Analytics dashboard

## Configuration in platform-web
Once deployed, set `VITE_API_BASE_URL` in `platform-web`:
```bash
# .env or .dev.vars in apps/platform-web:
VITE_API_BASE_URL=https://api.befach.dev
```

Or keep it empty (default `""`) if the Workers route is `/api/*` on the same origin as the web app.
