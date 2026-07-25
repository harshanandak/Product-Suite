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
MEETING_PREFLIGHT_SOURCE_DATABASE_URL=<current Neon direct source URL>
MEETING_PREFLIGHT_TARGET_DATABASE_URL=<Supabase direct target URL>
MEETING_PREFLIGHT_SOURCE_PROVIDER=neon
MEETING_PREFLIGHT_TARGET_PROVIDER=supabase
PR20_PREFLIGHT_OUTPUT=docs/deployment/meeting-supabase-preflight.json
```

The connection slots are named `SOURCE`/`TARGET`, not by vendor, so the same variables serve either direction. The provider variables are what name the vendors in the archived report; leave one unset and the report records `unspecified` rather than guessing.

If the Neon source contains rows and an approved data migration route exists, rerun with:

```bash
PR20_APPROVED_DATA_MIGRATION=1
```

Do not set `PR20_APPROVED_DATA_MIGRATION=1` just to bypass the gate. It means backup, restore or replication proof exists for the populated Meeting tables. Never set it to make a red preflight go green — record the backup evidence first. This applies in both directions.

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

---

# Reverse Cutover: Supabase → Neon

The sections above describe PR20's original direction (Neon `public` source → Supabase `meeting` target). The Meeting database is now moving **back** to the shared Neon platform database, into a Neon-resident `meeting` schema. The same preflight, the same smoke and the same fail-closed gate cover this direction — nothing is forked, only re-pointed.

Direction summary:

| | Original (PR20) | Reverse (this cutover) |
| --- | --- | --- |
| Source | Neon, `public` schema | Supabase, `meeting` schema |
| Target | Supabase, `meeting` schema | Neon, `meeting` schema |
| Rollback target | Neon | Supabase |

## Reverse Preflight

Nothing about the variables changes — the slots are already vendor-neutral. Point them at the reversed sides and name the vendors so the archived report is honest about which side was which:

```bash
MEETING_PREFLIGHT_SOURCE_DATABASE_URL=<Supabase direct SOURCE URL>
MEETING_PREFLIGHT_TARGET_DATABASE_URL=<Neon direct TARGET URL>
MEETING_PREFLIGHT_SOURCE_PROVIDER=supabase
MEETING_PREFLIGHT_TARGET_PROVIDER=neon
MEETING_PREFLIGHT_SOURCE_SCHEMA=meeting
MEETING_PREFLIGHT_TARGET_SCHEMA=meeting
PR20_PREFLIGHT_OUTPUT=docs/deployment/meeting-neon-preflight.json
```

Then run the same command:

```bash
bun run preflight:meeting-cutover
```

The report records `source.provider`/`target.provider` alongside `source.schema`/`target.schema`, so an archived report always names both the direction it covers and the vendor on each side. The fail-closed gate is unchanged: a populated Supabase `meeting` source fails the preflight unless `PR20_APPROVED_DATA_MIGRATION=1` asserts that backup, restore or replication proof exists. Never set it to make a red preflight go green — record the backup evidence first.

## Reverse Cutover Order

1. Apply the Neon `meeting` schema migration to the shared Neon platform database.
2. Run the reverse preflight (Supabase source, Neon target) and archive the report.
3. If Supabase source rows exist, complete and record the approved data migration route — `pg_dump --schema=meeting` from Supabase, restore into Neon — before continuing.
4. Run the Meeting create/read smoke against the Neon target URL:

   ```bash
   MEETING_TARGET_SMOKE_DATABASE_URL=<Neon target URL>
   MEETING_TARGET_SMOKE_DATABASE_PROVIDER=neon
   ```

   The legacy `MEETING_SUPABASE_SMOKE_DATABASE_URL` still works, so a half-migrated operator env runs the smoke rather than silently skipping it.
5. Set hosted Meeting API `DATABASE_PROVIDER=neon` if the deployment uses the provider label operationally.
6. Set hosted Meeting API `DATABASE_URL` to the Neon runtime URL, and redeploy.
7. Run Meeting health checks and the create/read smoke against the hosted service.

## Reverse Rollback

Rollback is allowed until the Neon smoke tests pass and the Supabase retirement checklist is complete.

To roll back:

1. set Meeting API DATABASE_URL back to the Supabase connection string;
2. set `DATABASE_PROVIDER=supabase` if the deployment uses the provider label operationally;
3. redeploy Meeting API;
4. rerun Meeting health checks and create/read smoke tests against Supabase.

Do not delete Supabase projects, branches, credentials, or backup material during the reverse cutover. The rollback target stays available until the Neon target has passed preflight and create/read smoke coverage.

## Supabase Retirement Criteria

Only retire Supabase after all of the following are true:

- reverse preflight output is archived with zero source rows, or populated source rows have approved migration evidence;
- the Neon target has all Meeting tables and the required `vector` extension;
- Meeting create/read smoke tests pass against Neon;
- production runtime has used the Neon `DATABASE_URL` successfully after deployment;
- rollback proof is no longer needed by the release owner.

Until then, keep Supabase available.
