# Meeting API App Root

The deployable Railway root for the meeting backend is:

`apps/meeting-api/backend`

The Python package layout remains under `backend/` because the existing test suite imports `backend.*` directly. The tests live in:

`apps/meeting-api/tests/backend`

CI sets `PYTHONPATH=apps/meeting-api` so the copied backend package resolves without changing application imports during the transition to the monorepo.

## Hosted Baseline

- Python 3.13 on Windows is the supported local baseline for the Meeting API toolchain.
- The current hosted stack uses Neon Postgres, Neon Auth, Cloudflare R2, and SQLAlchemy Core.
- Hosted session exchange flows through `/api/auth/session/exchange` with app-owned organizations.
- The summary-first flow is exposed through `/api/runtime-config` and the summary-first meeting routes.

## Database migration authority

`packages/db/migrations` is the sole supported schema and migration root. Fresh
clones and hosted schema changes use the canonical Drizzle runner with a direct
Neon `MIGRATION_DATABASE_URL`; application runtimes use their pooled `DATABASE_URL`.

The retained Meeting migration files under
`apps/meeting-api/backend/alembic/versions/` and
`apps/meeting-api/backend/migrations/` are immutable historical evidence only.
They are not a supported migration plane: do not run them, add revisions, or
apply raw SQL from those directories.

