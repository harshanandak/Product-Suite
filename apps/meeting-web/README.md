# Frontend

This frontend is a Vite-powered static SPA for Meeting Agent.

## Local development

```bash
bun install
bun run dev
```

The frontend prefers `VITE_BACKEND_URL` for the backend origin. `REACT_APP_BACKEND_URL` is still read as a temporary compatibility alias while deploy targets migrate.

Example:

```bash
VITE_BACKEND_URL=http://localhost:8000
```

## Build

```bash
bun run build
```

Build output is written to `dist/`.

## Routing and hosting

The app is a client-rendered SPA. Hosts must rewrite unknown routes to `index.html` so these paths resolve directly:

- `/`
- `/auth/sign-in`
- `/auth/callback`
- `/auth/signed-out`
- `/app`
- `/meetings`
- `/meetings/:meetingId`

## Deployment

- Vercel uses the repo-root `vercel.json` and serves `frontend/dist`.
- Cloudflare Pages should also serve `frontend/dist` with SPA fallback rewrites.
- Optional `/runtime-config.json` can inject runtime overrides at deploy time.

## Validation

```bash
bun run test
```
