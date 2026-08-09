# Database migration provenance

This directory records immutable migration evidence; it is not a migration
journal and is never consulted to determine pending work. `packages/db/migrations`
is the only supported Drizzle migration root.

The manifest stores canonical LF SHA-256 values for the historical Supabase,
Meeting Alembic/raw SQL, and Drizzle files. The two repaired Drizzle files also
retain the observed legacy CRLF hashes from production. Production history is
the `original-production` variant; a genuinely empty PostgreSQL 17 + pgvector
bootstrap is the `repaired-bootstrap` variant. The checker accepts only a
complete variant and rejects mixed, unknown, or fabricated hashes.

Only five foreign-key blocks may be guarded with `to_regclass`: four blocks in
`0000_stale_jamie_braddock.sql` and one in `0004_minor_lockheed.sql`. The guard
defers the original constraint when `public.tenants` or `public.users` is not
present; it does not change names, columns, referenced columns, or actions.

Run the focused checks from the repository root:

```text
bun test test/check-historical-db-artifacts.test.js test/check-migration-parity.test.js
bun run check:migration-parity
node scripts/check-historical-db-artifacts.mjs
```

The empty PostgreSQL bootstrap probe requires a local PostgreSQL 17 + pgvector
service. If that service is unavailable, deterministic checker/fixture tests
remain required and the live probe must be reported as INCOMPLETE rather than
treated as a pass.
