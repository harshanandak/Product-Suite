# Product Suite documentation index

## Current database contract

- [Schema and domain ownership](architecture/schema-domain-ownership.md) —
  current Neon/public topology, Drizzle owner, domain boundaries, and historical
  evidence classification.
- [Database authority](deployment/DATABASE_AUTHORITY.md) — guarded role and
  migration operations.
- [Canonical Neon authority plan](work/2026-08-09-neon-db-authority/plan.md)
  and [task list](work/2026-08-09-neon-db-authority/tasks.md) — exact
  `0019` floor, both history variants, and PR A `0020` interface.
- [Authority decisions](work/2026-08-09-neon-db-authority/decisions.md) —
  redaction, role, cleanup, and real-Neon evidence decisions.

The active database authority is Neon PostgreSQL (`neondb`, `public`) with
Drizzle migrations in `packages/db/migrations` and journal
`packages/db/migrations/meta/_journal.json`. Production uses
`original-production`; fresh/staging/test use `repaired-bootstrap`.

```text
bun run migrate:database -- apply --history-variant <variant> --expected-pending <ordered-tags>
bun run migrate:database -- verify --history-variant <variant> --expected-floor <tag>
```

PR A's candidate is `0020_meeting_authority_foundation.sql`; it must apply and
verify/no-op on both variants without touching the five-block `0000`/`0004`
repair. Required NOLOGIN grant roles are provisioned before `0019` by the direct
SQL authority; application credentials remain pooled, per-service LOGIN roles.

## Historical roots

The Supabase and Alembic/raw Meeting roots are preserved as
`historical_non_authoritative` evidence; the manifest is validation/provenance,
not a second journal. The
historical manifest is validation/provenance only. The unsupported legacy
Roadmap application remains archived rather than silently becoming a supported
Neon service.

## Evidence status

The real-Neon disposable-project/root and production-derived-branch proof is INCOMPLETE when the required Neon control-plane credentials are unavailable.
CI fails the required lane closed in that case; it never treats a skipped test
as conformance evidence. No production database or external project is mutated
by local unit/docs validation.
