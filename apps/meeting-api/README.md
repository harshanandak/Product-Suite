# Meeting API App Root

The deployable Railway root for the meeting backend is:

`apps/meeting-api/backend`

The Python package layout remains under `backend/` because the existing test suite imports `backend.*` directly. The tests live in:

`apps/meeting-api/tests/backend`

CI sets `PYTHONPATH=apps/meeting-api` so the copied backend package resolves without changing application imports during the transition to the monorepo.

