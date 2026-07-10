# Platform API Deployment to Cloudflare Workers

## Prerequisites
- `wrangler` CLI installed and logged in (`wrangler whoami` to verify)
- Cloudflare account with a Workers enabled domain (or route configured)
- Clerk account with the `CLERK_SECRET_KEY` from your account settings
- Neon database connection string

## Deployment Steps

### 1. Set up secrets (one time)
```bash
# From the repo root, or from apps/platform-api:
wrangler secret put CLERK_SECRET_KEY --env production
# Paste your Clerk secret key when prompted

wrangler secret put DATABASE_URL --env production
# Paste your Neon connection string: postgresql://...

wrangler secret put CLERK_AUTHORIZED_PARTIES --env production
# Paste the comma-separated list of Clerk-configured allowed origins
# e.g., https://api.befach.dev,https://app.befach.dev
```

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
