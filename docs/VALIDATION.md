# Validation

Run validation from the repo root so every deployable uses one documented entrypoint.

## Root Commands

- `bun run validate`
  - runs the full baseline in this order:
    1. `bun run validate:meeting-web`
    2. `bun run validate:roadmap-web`
    3. `bun run validate:meeting-api`
- `bun run test:contracts`
  - runs the shared contracts package guard/unit tests in `packages/contracts`
- `bun run test:ui-chat`
  - runs the shared chat UI package tests in `packages/ui-chat`
- `bun run test:ui-canvas`
  - runs the shared canvas boundary package tests in `packages/ui-canvas`
- `bun run test:ui-meeting`
  - runs the shared meeting UI package tests in `packages/ui-meeting`
- `bun run test:ui-planning`
  - runs the shared planning UI package tests in `packages/ui-planning`
- `bun run test:ui-charting`
  - runs the shared charting UI package tests in `packages/ui-charting`
- `bun run test:agent-core`
  - runs the agent-core service tests in `services/agent-core`
- `bun run test:hocuspocus`
  - runs the Hocuspocus realtime transport service tests in `services/hocuspocus`
- `bun run validate:meeting-web`
  - runs Meeting Web lint, tests, and build
- `bun run validate:roadmap-web`
  - runs Roadmap Web lint, typecheck, unit tests, and build
- `bun run install:meeting-api`
  - installs Python dependencies from `apps/meeting-api/backend/requirements.txt`
- `bun run validate:meeting-api`
  - runs the Meeting API lint and pytest baseline
- `bun run validate:meeting-api:lint`
  - runs `python -m flake8 --select=E9,F63,F7,F82 apps/meeting-api/backend apps/meeting-api/tests/backend`
- `bun run validate:meeting-api:test`
  - runs `python -m pytest apps/meeting-api/tests/backend -q`

## Recommended Local Order

1. Run `bun install` for the JavaScript workspaces.
2. Run `bun run test:contracts` after changing `packages/contracts` so the shared wire-contract package stays honest.
3. Run `bun run test:ui-chat` after changing `packages/ui-chat` so the shared chat block stays reusable.
4. Run `bun run test:ui-canvas` after changing `packages/ui-canvas` so canvas boundaries stay shell-agnostic.
5. Run `bun run test:ui-meeting` after changing `packages/ui-meeting` so the shared meeting block stays reusable.
6. Run `bun run test:ui-planning` after changing `packages/ui-planning` so planning blocks stay shell-agnostic.
7. Run `bun run test:ui-charting` after changing `packages/ui-charting` so charting blocks stay shell-agnostic.
8. Run `bun run test:agent-core` after changing `services/agent-core` so long-running agent orchestration stays service-owned.
9. Run `bun run test:hocuspocus` after changing `services/hocuspocus` so canonical canvas collaboration transport stays service-owned.
10. Ensure Python `3.13` is available for the Meeting API toolchain.
11. Run `bun run install:meeting-api` for the Python backend dependencies.
12. Run `bun run validate` from the repo root.

If only Python `3.14+` is installed, `bun run install:meeting-api` fails intentionally. The backend pins dependency versions that are currently validated in CI on Python `3.13`.

## Meeting API Migration Prerequisite

Some Meeting API tests assume a reachable Postgres database that matches the current Alembic head. Before running the backend test baseline against a fresh database, apply migrations manually:

```bash
python -m alembic -c apps/meeting-api/backend/alembic.ini -x db_url=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/meeting_agent upgrade head
```

Use the same `db_url` pattern as CI, adjusted for your local database.

## CI Mapping

- `.github/workflows/meeting-web-ci.yml` validates the same Meeting Web lint, test, and build sequence.
- `.github/workflows/roadmap-web-ci.yml` validates the same Roadmap Web lint, typecheck, unit-test, and build sequence.
- `.github/workflows/meeting-api-ci.yml` installs backend dependencies, runs Meeting API lint, applies migrations, and runs pytest.
- `.github/workflows/repo-tooling-ci.yml` watches shared package and service paths and runs the repo tooling guard plus shared package, agent-core, and hocuspocus tests.
- The Meeting API lint baseline is intentionally limited to fatal flake8 categories in PR2 so root validation is truthful without pulling existing style debt into this slice.

If CI behavior changes, update this document and the root scripts together so local validation and CI keep telling the same story.
