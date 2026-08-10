# Canonical database authority

Product-Suite uses one Drizzle migration plane: `packages/db/migrations` and
its `meta/_journal.json` journal. Neon PostgreSQL 17 with the `vector`
extension is the supported hosted authority; the application schema is
`public`, and `neondb` is the canonical database.

There are three protected URL scopes:

- `DATABASE_URL` is a pooled, least-privilege runtime URL for a service.
- `MIGRATION_DATABASE_URL` in `db-migrate-production` is a direct owner-scoped
  URL available only to the gated apply job.
- `MIGRATION_DATABASE_URL` in `db-preflight-production` is a different direct,
  read-only LOGIN URL available only to the isolated verify job.

Neither protected URL is a Worker secret or may appear in evidence or logs.

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

## Protected production preflight

Production inspection and migration apply use separate GitHub environments and
separate direct credentials. `db-preflight-production` may contain only a
distinct read-only `MIGRATION_DATABASE_URL` for the signed attestation's exact
`loginIdentifier`. `db-migrate-production` retains the separately approved
owner/apply authority. Never reuse or use the owner/apply LOGIN for preflight.

The preflight LOGIN must match the named
`product-suite-neon-preflight-reader-v1` grant-contract digest. The contract
allows `CONNECT`, schema `USAGE`, and only its named migration-ledger reads. It
requires all table and sequence write privileges to be false through direct,
inherited, `PUBLIC`, built-in/default-role, and default-ACL paths. Database and
schema `CREATE` through effective, direct, inherited, `PUBLIC`, default-role,
and default-ACL paths, temporary authority, and sequence `USAGE`, `UPDATE`, or
`SELECT` are denied. Safe autocommit and explicit-transaction probes for
`INSERT`, `UPDATE`, `DELETE`, DDL, and `nextval` must each fail with an
allowlisted read-only or insufficient-privilege code. Probe success is a hard
failure; no business row is a probe target.

Before credentials enter scope, the manual workflow validates
`config/neon-production-preflight-attestation.json` against its JSON Schema and
repository trust file. An authentic configured attestation uses Ed25519 and
binds the canonical payload, immutable control-plane or independently signed
source hash, project, production branch, endpoint, `neondb`, `public`, role,
grant digest, catalog digest, validity/freshness window, and recovery reference.
The job also binds the file SHA-256 and Git blob to the exact current-main run
SHA. A hostname proves an endpoint only; the hostname does not prove the Neon
project or production branch. A shape-only identifier is forbidden and is not
proof.

A dispatch from a non-main ref runs the guard and fails; it is never converted
to a successful skipped job. The independently resolved Git blob ID is carried
into the credentialed verifier step. Pre-credential failures retain the
initialized structured redacted `FAIL` packet; verifier and database failures
overwrite it with a more specific allowlisted code. Missing artifacts never
turn upload handling into the primary failure.

The checked-in file currently says `HUMAN_INFRASTRUCTURE_REQUIRED`. That state,
an empty trust set, a stale/forged signature, or any target/recovery mismatch
fails before a database pool is opened. Infrastructure reviewers must replace
it with authentic non-secret signed inputs; agents must not invent production
IDs or signing material.

After that separate infrastructure gate, dispatch only the exact reviewed main
SHA and fixed command:

```text
bun run migrate:database -- verify --environment production --history-variant original-production --expected-floor 0017
```

Success is the redacted `PREFLIGHT_READY` artifact for the exact 18-row
`0000..0017` original-production vector and derived `0018,0019` suffix. It needs
independent artifact review. A PASS artifact never dispatches, authorizes, or
implies apply; rollout apply requires a fresh lease proof and separate apply
approval in `db-migrate-production`.
