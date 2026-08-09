# Production Hosted Launch Checklist

- Verify Neon Auth callback URLs.
- Verify Neon Postgres connectivity.
- Verify Cloudflare R2 bucket access.
- Verify `/api/auth/session/exchange` and onboarding invitation flows.
- Verify the approved Drizzle migration floor and environment-pinned history
  variant with the canonical migration runner before deploying application code.
- Apply hosted schema changes only through `packages/db/migrations` with the
  direct owner-scoped `MIGRATION_DATABASE_URL`; keep runtime `DATABASE_URL`
  pooled and least-privilege.
- Treat `backend/alembic/versions/` and `backend/migrations/` as immutable
  historical evidence; never run or extend those files.
