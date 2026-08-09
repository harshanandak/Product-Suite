# Canonical database authority

Product-Suite uses one Drizzle migration plane: `packages/db/migrations` and
its `meta/_journal.json` journal. Neon PostgreSQL 17 with the `vector`
extension is the supported hosted authority; the application schema is
`public`, and `neondb` is the canonical database.

There are two URL scopes:

- `DATABASE_URL` is a pooled, least-privilege runtime URL for a service.
- `MIGRATION_DATABASE_URL` is a direct owner-scoped URL available only to the
  gated migration job. It is never a Worker secret and never appears in
  evidence or logs.

The environment pins the migration-history variant. Production uses
`original-production`; fresh, staging, and test use `repaired-bootstrap`.
Invoke the canonical runner from the repository root:

```text
bun run provision:database-roles
bun run migrate:database -- bootstrap --environment fresh --history-variant repaired-bootstrap --expected-pending <ordered-tags>
bun run migrate:database -- apply --environment <environment> --history-variant <pinned-variant> --expected-pending <ordered-tags>
bun run migrate:database -- verify --environment <environment> --history-variant <pinned-variant> --expected-floor <tag>
```

`bootstrap` refuses a nonempty target, non-PostgreSQL-17 server, missing
`vector`, or a non-repaired history. `apply` re-reads the journal after taking
the transaction advisory lock and accepts only an exact contiguous suffix.
Production P0 is limited to `{0018,0019}` or `{0019}`. `verify` is read-only
and reports `NOOP` only when the declared variant is recognized, the expected
floor is present, and no migration is pending.

Historical Supabase, Alembic, and raw SQL roots remain manifest-verified
non-authoritative artifacts. They are not consulted for pending order and must
not be invoked by CI or deployment.
