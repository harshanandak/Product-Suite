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

