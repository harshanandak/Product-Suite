# PR2 Validation Baseline Decisions

Date: 2026-04-24
Issue: `product-suite-84m`

## Decision 1: Root validation is an orchestrator, not a new build system
- Status: accepted
- Rationale: PR2 should make validation truthful and reproducible without introducing another task runner or hiding app-specific toolchains.
- Chosen option: root commands orchestrate existing JS and Python validation commands.
- Rejected option: add a new monorepo executor in PR2.

## Decision 2: Meeting API stays Python-native in validation
- Status: accepted
- Rationale: `meeting-api` already has a Python-specific dependency and migration flow. Pretending it is a Bun workspace would make the baseline less honest.
- Chosen option: root commands call Python tooling directly.
- Rejected option: force backend validation through Bun workspace semantics.

## Decision 3: Prefer existing installed Python quality tools
- Status: accepted
- Rationale: `requirements.txt` already includes `flake8`, `black`, `mypy`, `pytest`, and `alembic`. PR2 should use what is already present before adding more tooling.
- Chosen option: start from current installed tools and pick the minimum baseline needed for root validation.
- Rejected option: introduce a new Python lint stack in PR2.
