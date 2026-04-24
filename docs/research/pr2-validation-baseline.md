# PR2 Validation Baseline Research

Date: 2026-04-24
Issue: `product-suite-84m`

## Current Validation Reality

### Root
- Root `package.json` currently exposes:
  - `ci:meeting-web`
  - `ci:roadmap-web`
  - `install:meeting-api`
  - `test:repo-tooling`
  - `test:prepush`
- Root does **not** expose a first-class validation entrypoint for `meeting-api`.

### Meeting Web
- `apps/meeting-web/package.json` exposes:
  - `lint`
  - `test`
  - `build`
- `.github/workflows/meeting-web-ci.yml` runs:
  - `bun install --frozen-lockfile`
  - `bun run lint`
  - `bun run test`
  - `bun run build`

### Roadmap Web
- `apps/roadmap-web/package.json` exposes:
  - `lint`
  - `typecheck`
  - `build`
  - Playwright e2e commands
- `.github/workflows/roadmap-web-ci.yml` runs:
  - `bun install --frozen-lockfile`
  - `bun x tsc --noEmit`
  - `bun run lint` with `continue-on-error: true`
  - `bun run build`
- `.github/workflows/roadmap-web-playwright.yml` separately runs Playwright.

### Meeting API
- `apps/meeting-api/backend/requirements.txt` already includes:
  - `pytest`
  - `flake8`
  - `black`
  - `mypy`
  - `alembic`
- `.github/workflows/meeting-api-ci.yml` runs:
  - Python dependency install
  - Alembic upgrade
  - `pytest`
- The backend CI currently does **not** run a Python lint command even though lint tooling is installed.

## Gaps PR2 Must Close
- No single documented root validation baseline spans all three deployables.
- `meeting-api` remains installable from root but not validate-able from root.
- Roadmap CI and local root scripts are not identical in naming or exact sequence.
- Roadmap lint is still tolerated in CI via `continue-on-error`, which weakens baseline enforcement.
- The local order for JS vs Python validation is not documented from the root.

## Recommended PR2 Direction
- Keep PR2 narrow: do not redesign CI architecture.
- Add explicit root validation entrypoints for:
  - `meeting-web`
  - `roadmap-web`
  - `meeting-api`
- Make root commands the documented local interface for all three deployables.
- For `meeting-api`, baseline should include:
  - dependency install helper
  - lint entrypoint
  - test entrypoint
  - documented migration prerequisite
- Prefer existing installed Python tools instead of adding new ones in PR2.

## Proposed Baseline Commands
- `validate:meeting-web`
  - run lint, test, build
- `validate:roadmap-web`
  - run lint, typecheck, build
- `validate:meeting-api:lint`
  - start with `flake8`
  - optionally include `black --check` if the command surface stays simple
- `validate:meeting-api:test`
  - run pytest
- `validate:meeting-api`
  - lint then test
- `validate`
  - orchestrate all deployables in a documented order

## Risk Notes
- Python validation may need environment prerequisites that differ from JS validation.
- If migrations are required for meaningful tests, PR2 should document that explicitly rather than silently skipping it.
- Tightening Roadmap lint from soft-fail to hard-fail may surface unrelated issues; that needs an explicit decision.

## TDD Scenarios For PR2
1. Root command presence test
   - verify root `package.json` exposes all required validation entrypoints
2. Command target correctness test
   - verify each root command points at the intended app path and toolchain
3. Documentation consistency test
   - verify root docs and CI docs describe the same execution order and entrypoints
