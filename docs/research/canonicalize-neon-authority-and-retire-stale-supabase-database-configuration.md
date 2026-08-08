# Research: canonical Neon database authority

**Issue:** `59efc6dc-07a1-4b31-9942-ba2f1fcac8e1`
**Date:** 2026-08-09
**Base:** `origin/main@42e30d88bc516dc6472c9f1bb837bd694844aa47`
**Decision fed:** choose the one supported Postgres topology, migration owner, and safe reconciliation path before DEV.
**Result:** **CONFIRMED** — Neon is the only verifiable live Postgres authority. Supabase and Alembic still appear in executable configuration, CI, and documentation, but the evidence does not support either as a live production database.

## Evidence standard and safety boundary

All database and control-plane checks in this research were read-only. No schema, row, branch, deployment, secret, or migration history was mutated. Connection strings, passwords, API keys, provider subjects, row contents, and secret values were not printed or retained.

The user's statement that the Supabase-to-Neon data move is complete is canonical. This plan does not attempt another dump, restore, replication, table copy, schema move, drop, or down migration.

## Verified current state

### Live Neon provenance

A read-only query used the configured `packages/db/.env` connection without displaying it. The URL is a pooled Neon URL. The Neon control plane and Postgres server agreed on:

- project `cool-glitter-50094249` (`Space Agent`), AWS Singapore, PostgreSQL 17;
- default branch `production`, state `ready`, read-write endpoint active;
- database `neondb`, role `neondb_owner`, current schema `public`;
- schemas `public`, `drizzle`, and `neon_auth`; there is no `meeting` schema and no Supabase-managed schema;
- extensions `plpgsql` and `vector`;
- meeting, identity, work-item, proposal, memory, and knowledge tables all coexist in `public`;
- the database is populated (including meetings, users, memberships, work items, proposals, and memories), so destructive baseline recreation is forbidden.

The production database contains two history tables:

- `drizzle.__drizzle_migrations`: 18 applied entries, through repository migration `0017`;
- `public.alembic_version`: `0005_remove_workos_session_id`.

`origin/main` contains 19 Drizzle migrations through `0018_collaboration_fabric.sql`; therefore live Neon is currently one tracked Drizzle migration behind main. The differing stored hashes are not content drift: entries `0000`–`0016` match CRLF working-tree bytes, while `0017` matches the LF-normalized Git content. The repository needs a cross-platform hash policy before treating byte hashes as integrity evidence.

### Runtime and deployment provenance

- `packages/db/src/index.ts` uses `@neondatabase/serverless` and Drizzle's Neon HTTP driver. `packages/db/drizzle.config.ts` and `packages/db/package.json` define the current generated migration plane.
- `.github/workflows/platform-api-deploy.yml` explicitly runs `packages/db` Drizzle migrations before deploying the Cloudflare Worker.
- Cloudflare reports a current `platform-api-production` deployment (2026-08-06) with a `DATABASE_URL` secret binding. Secret listing proves the binding name, not its value. Runtime validation must therefore reject a non-Neon URL in code and exercise a DB-backed readiness query.
- The GitHub `DATABASE_URL` secret was updated on 2026-08-06; `NEON_API_KEY`, `NEON_PROJECT_ID`, and `NEON_PARENT_BRANCH_ID` are present for the real-Neon contract tier.
- The documented `api.befach.dev` name does not resolve. The documented Railway meeting API and both documented Vercel production URLs return provider 404s. Railway and Vercel CLI credentials are expired, so their environment values could not be inspected. These are deployment-documentation defects, not evidence of a second live database.
- GitHub still contains Supabase credential names and `.github/workflows/roadmap-supabase.yml`; that workflow last ran on 2026-06-06. These are stale active surfaces that should be retired only after repository consumers are proven absent.

## Repository source classification

| Class | Evidence | Treatment |
| --- | --- | --- |
| Canonical runtime | `packages/db`, `apps/platform-api`, current Cloudflare deploy, Neon branch/test harness | Keep; harden as Neon-only |
| Real stale runtime adapter | Meeting hosted default `DATABASE_PROVIDER=supabase`, provider-dependent `meeting,public` search path, legacy Supabase smoke variable | Remove or reject in supported hosted mode |
| Real stale automation | `.github/workflows/roadmap-supabase.yml`, root Supabase exposure/cutover commands, Supabase live type generation | Remove from active CI/deploy surface |
| Historical migration evidence | `infra/supabase/migrations/**`, `apps/roadmap-web/supabase/migrations/**`, `apps/meeting-api/backend/alembic/versions/**`, `apps/meeting-api/backend/migrations/**` | Preserve byte-for-byte under a checked manifest; never run for new Neon changes |
| Executable second migration authority | Alembic config/runner and raw SQL runner around the historical meeting files | Retire after the Drizzle reconciliation migration can bootstrap the same schema |
| Stale current-state docs | schema ownership matrix, Supabase cutover runbook, service inventory/registry, Meeting env example | Replace with Neon authority and accurate deployment status |
| Unsupported legacy product | `apps/roadmap-web` Supabase data client and setup guide; documented Vercel deployment is gone | Mark explicitly unsupported/archived; do not claim it is an active database authority or migrate its data in this issue |
| Historical plans/research | PR19/PR20 plans, research, decisions | Retain as historical narrative; do not rewrite them into current truth |

## Options considered

### A. Keep Drizzle and Alembic as domain-specific co-owners

Rejected. The same physical `public` schema already contains objects created by both histories, the deploy pipeline runs only Drizzle, and PR A needs cross-domain constraints in one ordered migration. Two writers cannot provide one total order, fresh-clone path, or unambiguous rollback boundary.

### B. Make Alembic the owner because it created the meeting baseline

Rejected. Platform, collaboration, memory, proposal, and work-item changes already use Drizzle, Cloudflare deploy runs Drizzle, and the real-Neon contract harness is TypeScript/Drizzle-native. Moving those domains to Alembic would create a larger migration and tooling conversion with no user value.

### C. Canonicalize `packages/db` Drizzle and adopt the live meeting schema additively

Selected. Add `0019_neon_authority_reconciliation.sql` plus canonical Drizzle schema definitions for the tables currently represented only by historical Alembic. On populated production Neon, the migration is additive/idempotent and does not copy or drop data. On an empty Postgres 17 database, the full Drizzle chain becomes sufficient to create the supported schema. Alembic/Supabase SQL stays immutable history; their runners and active automation retire.

This makes the next post-reconciliation migration slot `0020`, which is the interface PR A consumes after this prerequisite merges and live deployment verifies `0019`.

## Current official guidance

- Neon's current Drizzle guide recommends generated SQL migrations and a direct, non-pooled connection for migrations; pooled migration URLs can fail. The application runtime should continue using pooling, while CI gets a separate `MIGRATION_DATABASE_URL`. [Neon: Schema migration with Neon Postgres and Drizzle ORM](https://neon.com/docs/guides/drizzle-migrations)
- Neon documents pooled PgBouncer URLs for high-concurrency applications and direct URLs for schema migrations, dumps/restores, and session-level operations. [Neon: Choosing your connection method](https://neon.com/docs/connect/choose-connection), [Neon: Connection pooling](https://neon.com/docs/connect/connection-pooling)
- Neon branches are isolated copy-on-write clones and are suitable for testing schema changes without loading the parent. A pre-migration restore branch or timestamp is the rollback evidence; it is not permission to destructively roll back production. [Neon: Branching](https://neon.com/docs/introduction/branching)
- Drizzle stores generated SQL and a journal under the configured migration directory and applies changes with `drizzle-kit migrate`; `push` is positioned for local iteration, not the production history contract. [Drizzle: Drizzle with Neon Postgres](https://orm.drizzle.team/docs/tutorials/drizzle-with-neon)
- Supabase's current CLI documents its own migration-history repair/list/up semantics. Leaving Supabase CLI automation active would therefore continue to advertise a separate remote history owner. Preserve the SQL as evidence but remove linked-project commands from the supported path. [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction)
- PostgreSQL resolves unqualified names through `search_path`, and adding a writable schema to it trusts users with `CREATE` on that schema. Canonical code should use `public` explicitly where practical and the migration should revoke public schema creation from `PUBLIC`. [PostgreSQL 17: Schemas and search path](https://www.postgresql.org/docs/current/ddl-schemas.html)

## Migration and security design consequences

1. Runtime and migration credentials have different purposes: pooled, least-privilege `DATABASE_URL` for applications; direct, migration-only `MIGRATION_DATABASE_URL` for the human-gated job.
2. Existing migration SQL is immutable. New schema state is introduced only by the next migration and journal entry. Cross-platform integrity compares canonical LF content while recognizing the explicitly recorded legacy CRLF hashes already present in Neon.
3. Production schema changes are forward-only and additive. Application rollback reactivates the prior Worker/service version; it never restores Supabase, drops columns, deletes rows, or rewrites migration history.
4. `public.alembic_version` remains historical metadata on production and need not be recreated on a fresh database. Runtime readiness moves to the canonical Drizzle revision/schema contract.
5. A clean Postgres 17 CI database runs only the Drizzle chain. An ephemeral Neon branch then proves provider-specific application behavior and that applying pending migrations converges without touching the parent.
6. The deployment job validates exact `main` SHA, project/branch provenance, direct-vs-pooled purpose, pending migration set, and post-migration schema before deploying.

## OWASP Top 10 pass

| Category | Applies | Risk | Planned mitigation |
| --- | --- | --- | --- |
| A01 Broken Access Control | Yes | Owner credentials or writable `search_path` widen DB authority | Separate least-privilege runtime role, explicit schema qualification, revoke `CREATE` on `public` from `PUBLIC` |
| A02 Cryptographic Failures | Yes | DSNs/tokens in logs or reports | Secrets remain out-of-band; validators return provider/purpose only and redact full URLs/errors |
| A03 Injection | Yes | URL string heuristics and unqualified SQL can select unintended targets | Parse URLs structurally; exact Neon hostname suffix; parameterized SQL; explicit schema names |
| A04 Insecure Design | Yes | Dual journals allow order inversion and non-reproducible clones | One Drizzle root, one journal, one deploy runner, immutable historical manifest |
| A05 Security Misconfiguration | Yes | Supabase hosted default, pooled migration URL, stale secrets/workflows | Hosted defaults Neon and rejects Supabase; split URL purposes; remove live Supabase workflow; rotate stale secrets after proof |
| A06 Vulnerable Components | Indirect | Migration tooling behavior changes | Keep lockfile; use repository-pinned Drizzle/Neon packages; no dependency upgrade in this issue |
| A07 Identification/Auth Failures | Indirect | Provider identity confused with DB authority | Preserve auth APIs; database provider validation is separate from Neon Auth/Clerk identity |
| A08 Software/Data Integrity Failures | Yes | Edited historical SQL, mixed line endings, unknown applied hashes | LF policy, historical hash manifest, applied-history verifier, exact-SHA deploy gate |
| A09 Logging/Monitoring Failures | Yes | Migration failure or wrong target cannot be reconstructed | Privacy-safe revision/hash/provider/branch evidence; no DSNs or row contents |
| A10 SSRF | Yes | User-controlled DB URL could target arbitrary host | Configuration-only secrets, parsed allowlist, no request-controlled connection strings |

## DRY and blast-radius findings

Reuse rather than duplicate:

- `scripts/check-migration-parity.mjs` is the base for repository journal/file checks.
- `apps/platform-api/test/db-contract/neon-branch.ts` already owns ephemeral branch lifecycle and safe cleanup.
- `.github/workflows/platform-api-deploy.yml` already provides exact-main-SHA and approval/concurrency gates.
- Meeting `load_settings`, DB pool construction, and readiness tests are the correct seams for hosted provider rejection and API-compatible changes.

Mandatory replacement/removal blast radius includes:

- Meeting: `.env.example`, `config.py`, `db.py`, Alembic configs/tests/requirements, target smoke tests, hosted launch docs.
- Root tooling: `package.json`, cutover preflight script/tests, Supabase exposure/schema tests.
- Deployment: `platform-api-deploy.yml`, `db-contract.yml`, `meeting-api-ci.yml`, `roadmap-supabase.yml`.
- Architecture/docs: schema ownership, cutover runbook, service inventory/registry, platform API deploy guide, README references.
- Historical migration roots remain unchanged and are recorded in the new manifest rather than bulk-edited.

## Required TDD scenarios

1. Happy path: hosted Meeting and Platform runtime accept a pooled Neon production URL, while migration tooling accepts a direct URL to the same configured project/branch; the clean Postgres bootstrap and ephemeral Neon conformance both pass.
2. Failure path: any supported hosted config using a Supabase hostname, `DATABASE_PROVIDER=supabase`, two production database URLs, or a pooled migration URL fails before a connection or deploy.
3. Edge case: production contains both Drizzle and Alembic history plus populated tables; `0019` converges additively, preserves row counts and the Alembic marker, then records exactly one new Drizzle migration.
4. Integrity edge: a historical file changed only by line ending is classified against the recorded legacy form; a semantic byte change, unknown hash, duplicate journal index, or edit to an already-applied migration fails.
5. Fresh clone: an empty Postgres 17 service runs only `packages/db` migrations and reaches Meeting readiness without invoking Alembic or Supabase CLI.
6. Rollback: after additive migration, the previous application version still starts and reads existing API fields; rollback never invokes a down migration or Supabase.

## Unknowns that remain human-gated

- The values of Cloudflare, Railway, Vercel, and GitHub secrets cannot be read back. Provider proof must come from validation at secret-set/deploy time and a DB-backed readiness query.
- Railway and Vercel accounts require reauthentication before their stale project metadata can be formally archived or removed. Their public URLs already fail.
- Applying repository migration `0018`, then reconciliation `0019`, changes live Neon and is DEV/deploy work. This PLAN authorizes neither.

## Sources

- [Neon: Schema migration with Neon Postgres and Drizzle ORM](https://neon.com/docs/guides/drizzle-migrations)
- [Neon: Choosing your connection method](https://neon.com/docs/connect/choose-connection)
- [Neon: Connection pooling](https://neon.com/docs/connect/connection-pooling)
- [Neon: Branching](https://neon.com/docs/introduction/branching)
- [Drizzle: Drizzle with Neon Postgres](https://orm.drizzle.team/docs/tutorials/drizzle-with-neon)
- [Supabase CLI reference](https://supabase.com/docs/reference/cli/introduction)
- [PostgreSQL 17: Schemas](https://www.postgresql.org/docs/current/ddl-schemas.html)

Parallel search evidence was saved outside the repository at `C:\Users\harsha_befach\AppData\Local\Temp\neon-db-authority-docs.json`.
