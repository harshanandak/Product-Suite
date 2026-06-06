# Meeting Supabase Cutover Runbook

PR20 moves the hosted Meeting API database from Neon Postgres to Supabase Postgres. Meeting API remains the write owner for Meeting data, and `infra/supabase/migrations` is the canonical hosted schema path after this cutover.

## Connection Purpose Mapping

Use separate Supabase connection strings by operational purpose:

| Connection string | Purpose | Notes |
| --- | --- | --- |
| Direct connection | migrations, backups, dumps, and restores | Use this for `supabase db push --dry-run`, `pg_dump`, `pg_restore`, extension checks, and other long-running operator tasks. Do not use a pooler URL for dump or restore proof. |
| Session pooler | persistent Meeting API runtime | Use this when the hosted runtime needs IPv4-compatible persistent connections. This is the default hosted API choice when direct IPv6 connectivity is not available. |
| Transaction pooler | transient or serverless clients | Use only for short-lived clients that do not require prepared statements. Do not use it for SQLAlchemy clients that depend on prepared statements or long sessions. |

The Meeting API `DATABASE_URL` should point to the selected Supabase runtime URL. Keep separate operator-only variables for direct migration and backup URLs; do not reuse the runtime pooler string for dumps or restores.

## Preflight

Before changing hosted runtime variables, run:

```bash
bun run preflight:meeting-cutover
```

Required environment variables:

```bash
NEON_DATABASE_URL=<current Neon direct source URL>
SUPABASE_DATABASE_URL=<Supabase direct target URL>
PR20_PREFLIGHT_OUTPUT=docs/deployment/meeting-supabase-preflight.json
```

If the Neon source contains rows and an approved data migration route exists, rerun with:

```bash
PR20_APPROVED_DATA_MIGRATION=1
```

Do not set `PR20_APPROVED_DATA_MIGRATION=1` just to bypass the gate. It means backup, restore or replication proof exists for the populated Meeting tables.

The preflight captures:

- row counts for every Meeting-owned Neon source table;
- Supabase target table readiness for the `meeting` schema;
- required Supabase extension availability, currently `vector`;
- a fail-closed result when source data exists without approved migration evidence.

## Cutover Order

1. Apply the PR20 Supabase migrations to the target project.
2. Run the preflight against Neon source and Supabase target direct URLs.
3. If source rows exist, complete and record the approved data migration route before continuing.
4. Set hosted Meeting API `DATABASE_PROVIDER=supabase`.
5. Set hosted Meeting API `DATABASE_URL` to the selected Supabase runtime URL.
6. Keep hosted auth variables on Neon until the Clerk hosted-token exchange lands; this PR20 cutover only moves the Meeting database to Supabase.
7. Run Meeting create/read smoke tests against the Supabase runtime URL.

## Rollback

Rollback is allowed until the Supabase smoke tests pass and the Neon retirement checklist is complete.

To roll back:

1. set Meeting API DATABASE_URL back to the Neon connection string;
2. set `DATABASE_PROVIDER=neon` if the deployment uses the provider label operationally;
3. restore the previous hosted auth compatibility variables if the release also changed auth settings;
4. redeploy Meeting API;
5. rerun Meeting health checks and create/read smoke tests against Neon.

Do not delete Neon branches, credentials, or backup material during PR20. The rollback target stays available until the Supabase target has passed preflight and create/read smoke coverage.

## Neon Retirement Criteria

Only retire Neon after all of the following are true:

- preflight output is archived with zero source rows, or populated source rows have approved migration evidence;
- Supabase target has all Meeting tables and required extensions;
- Meeting create/read smoke tests pass against Supabase;
- production runtime has used the Supabase `DATABASE_URL` successfully after deployment;
- rollback proof is no longer needed by the release owner.

Until then, keep Neon available until Meeting create/read smoke tests pass against Supabase.
