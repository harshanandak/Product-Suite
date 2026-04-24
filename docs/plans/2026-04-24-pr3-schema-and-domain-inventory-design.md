# PR3 Schema And Domain Inventory Design

Feature: `pr3-schema-and-domain-inventory`
Date: 2026-04-24
Status: planned
Issue: `product-suite-waq`

## Purpose
Create one written schema and domain ownership inventory before shared contracts work starts. The repo currently has real domain overlap across `roadmap-web`, `meeting-web`, and `meeting-api`, but no durable statement of which service or app is canonically responsible for which entity.

## Success Criteria
- The repo has one durable ownership inventory document at `docs/architecture/schema-domain-ownership.md`.
- The inventory covers these shared planning entities:
  - `workspace`
  - `team`
  - `thread`
  - `meeting`
  - `artifact`
  - `task`
- Each entity records:
  - current owner
  - future owner
  - source-of-truth database
  - source-of-truth migration or schema path
- The inventory explicitly records current collisions and drift, including:
  - `users` existing in both roadmap and meeting-api
  - roadmap chat/thread tables vs meeting-api meeting chat tables
  - meeting-api raw SQL migration history vs Alembic migration history
- Root or architecture-facing docs link to the inventory so later PRs can find it without chat history.

## Out Of Scope
- Moving tables between databases
- Changing auth providers or auth claims
- Creating `packages/contracts`
- Rewriting migrations
- Normalizing runtime APIs
- Fixing unrelated pre-existing test failures discovered during baseline validation

## Approach Selected
Use a docs-first inventory pass backed by checked-in schema, auth, and API sources. PR3 should create a durable ownership matrix, a short overlap-and-boundary rules section, and lightweight discoverability coverage so later PRs do not need to infer canonical ownership from scattered code.

Planned implementation target:
- `docs/architecture/schema-domain-ownership.md`

Supporting discoverability targets:
- `README.md`
- `docs/deployment/SERVICE_INVENTORY.md`
- `test/domain-inventory.test.js`

## Why This Approach
- It resolves the immediate blocker for PR4 without pretending schema unification has already happened.
- It keeps PR3 narrow and reversible.
- It forces explicit ownership decisions before contracts or auth abstractions freeze the wrong shape.
- It creates a durable source the team can review and update as later PRs land.

## Constraints
- PR3 must be descriptive, not migratory.
- Canonical ownership must be derived from checked-in repo sources only.
- `meeting-web` is a shell over `meeting-api`; it does not become a schema owner in PR3.
- Roadmap remains the canonical owner of team/workspace planning state unless a verified source proves otherwise.
- Meeting API remains the canonical owner of meeting/transcript/summary/job state unless a verified source proves otherwise.

## Edge Cases
- The same concept name appears in multiple domains:
  - `users` exists in roadmap and meeting-api
  - `chat_messages` exists in roadmap and meeting-api, but with different semantics
- Some roadmap truth exists in both SQL migrations and generated Supabase types, and the generated types contain tables beyond the initial migration.
- Meeting API migration truth is split between `backend/migrations/0001_initial.sql` and Alembic `0001_multi_user_jobs.py`.
- `thread` is not a meeting-api native concept even though meeting chat exists there; roadmap thread ownership must be kept distinct from meeting chat ownership.
- Baseline tests are already red in unrelated suites, so PR3 task validation should use targeted tests instead of assuming a clean repo-wide baseline.

## Technical Research
Verified repo findings:
- Root workspace tooling now exposes `meeting-api` validation commands, but `package.json` still only lists the two web apps as Bun workspaces.
- `apps/roadmap-web/supabase/migrations/20250110000001_initial_multitenant_schema.sql` establishes roadmap as a team/workspace-first product domain with `users`, `teams`, `team_members`, `workspaces`, `features`, `timeline_items`, `feedback`, `custom_dashboards`, and related planning tables.
- `apps/roadmap-web/src/lib/supabase/types.ts` shows roadmap schema truth has expanded beyond the initial migration and includes `chat_threads`, `chat_messages`, `blocksuite_documents`, and additional workspace-scoped operational tables.
- `apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py` establishes meeting-api as a user/meeting/job-first service with `users`, `meetings`, `transcript_segments`, `summaries`, `chat_messages`, and `jobs`.
- `apps/meeting-api/backend/migrations/0001_initial.sql` shows older meeting-api migration history without `users` and `jobs`, which must be called out as migration-path drift.
- `apps/roadmap-web/src/middleware.ts` shows roadmap auth remains Supabase-session driven.
- `apps/meeting-web/src/lib/api.js` and `apps/meeting-api/backend/security.py` show meeting-web and meeting-api are aligned around hosted/local token exchange, not roadmap workspace auth.

Relevant OWASP categories:
- `A01 Broken Access Control`
  - Applies: yes
  - Why: if canonical ownership is guessed incorrectly, later contracts or auth adapters can apply the wrong tenant or resource boundary.
  - Mitigation in PR3: explicitly record owner and access boundary per shared entity before PR4 and PR5.
- `A04 Insecure Design`
  - Applies: yes
  - Why: freezing shared contracts without ownership clarity is a design error, not just an implementation bug.
  - Mitigation in PR3: document current truth, future truth, and non-goals before any contract extraction.
- `A05 Security Misconfiguration`
  - Applies: partially
  - Why: source-of-truth drift across migrations and generated types can lead to incorrect environment or migration assumptions.
  - Mitigation in PR3: document the canonical migration/schema path for each domain.
- `A09 Security Logging and Monitoring Failures`
  - Applies: low relevance
  - Why: PR3 is not adding runtime logging, but Beads planning context still needs to preserve the ownership decision trail.
  - Mitigation in PR3: record design, acceptance, and stage context on the issue.

Minimum TDD scenarios for `/dev`:
1. Happy path: a targeted root test fails until `docs/architecture/schema-domain-ownership.md` exists with the required entity matrix headings.
2. Failure path: the targeted test fails if any required entity row is missing owner or source-of-truth fields.
3. Edge case: the targeted test fails if the inventory omits the explicit overlap notes for roadmap vs meeting-api chat semantics and meeting-api migration drift.

Detailed source notes are saved in `docs/research/pr3-schema-and-domain-inventory.md`.

## Ambiguity Policy
Use the existing staged workflow discipline:
- If an ownership decision is directly supported by checked-in schema or auth sources, document it and proceed.
- If an entity has overlapping storage but distinct semantics, document the split instead of forcing fake unification.
- If a required ownership decision cannot be supported by checked-in sources, stop and record the unresolved contradiction instead of inventing a future truth.
