# Decisions: canonical Neon database authority

## Task 1 - URL validation stays structural and redacted

**Decision:** Validate only the Neon hostname shape, TLS, database name, project
and branch identifiers, declared URL purpose, and the environment-pinned history
variant. The validator accepts secrets exclusively from process environment
variables and never includes connection strings, user names, passwords, or query
parameters in an error or report.

**Reason:** This makes provider and topology drift fail before a client is created
without creating a new path for secrets to reach CLI logs.

**Scope:** Task 1 only.

## Task 8 - Runtime readiness and fail-closed real-Neon evidence

**Decision:** Platform runtime URLs are pooled Neon URLs for `neondb`; direct
migration URLs remain outside application bindings. `/health/ready` reports only
opaque `ok/provider/schema/revision` fields and never returns a URL, role,
project, branch, table, row, or query error. Readiness requires
`0019_neon_authority_reconciliation`.

**Decision:** The real conformance lane must create an isolated test-only Neon
project/root for `repaired-bootstrap` and a separate production-derived branch
for `original-production`. Project identity, root/default status, empty catalog,
NOLOGIN role provisioning, privilege negatives, deletion request, and deletion
proof are mandatory. A populated production child is never reported as an empty
test root.

**Decision:** Missing `NEON_API_KEY` or `NEON_PROJECT_ID` is `INCOMPLETE` locally
and a hard failure in the required CI lane. `NEON_PROJECT_ID` identifies the
production/source project; the real harness must create a distinct disposable
project for the empty-root proof. No local test or workflow may silently convert
absent credentials or an unimplemented project-control-plane adapter into a green
conformance result. No production or external Neon resource was mutated during
this worktree run.

**Scope:** Task 8.

## Task 9 - Canonical documentation and PR A handoff

**Decision:** Current docs name one Neon/public physical topology and one
Drizzle migration plane. Supabase, Alembic, and raw Meeting roots remain
`historical_non_authoritative` evidence; the manifest is validation/provenance,
never a pending journal. The applied floor is `0019`, and PR A's exact next
revision is `0020_meeting_authority_foundation.sql`.

**Decision:** PR A must run:

```text
bun run migrate:database -- apply --history-variant <variant> --expected-pending <ordered-tags>
bun run migrate:database -- verify --history-variant <variant> --expected-floor <tag>
```

for both `original-production` and `repaired-bootstrap`, with production pinned
to the former. It provisions/validates the pre-`0019` NOLOGIN roles, checks the
exact catalog/grant contract, and does not touch the five-block historical repair.

**Scope:** Task 9.
