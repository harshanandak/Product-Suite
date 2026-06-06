#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const MEETING_SOURCE_TABLES = Object.freeze([
  "users",
  "meetings",
  "transcript_segments",
  "summaries",
  "chat_messages",
  "jobs",
  "tenants",
  "meeting_state",
  "chapter_summaries",
  "decisions",
  "action_items",
  "open_questions",
  "audio_assets",
  "agent_invocations",
  "agent_responses",
  "meeting_links",
  "user_auth_identities",
  "organization_memberships",
  "organization_invitations",
]);

export const REQUIRED_TARGET_EXTENSIONS = Object.freeze(["vector"]);
export const DEFAULT_PSQL_TIMEOUT_MS = 30_000;

function quoteLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function qualifiedRegclass(schemaName, tableName) {
  return `${schemaName}.${tableName}`;
}

export function buildSourceRowCountSql({ schemaName = "public" } = {}) {
  const selects = MEETING_SOURCE_TABLES.map(
    (tableName) => `
select
  ${quoteLiteral(tableName)} as table_name,
  coalesce(to_regclass(${quoteLiteral(qualifiedRegclass(schemaName, tableName))})::text, '') as source_relation,
  case
    when to_regclass(${quoteLiteral(qualifiedRegclass(schemaName, tableName))}) is null then null
    else (select count(*)::bigint from ${schemaName}.${tableName})
  end as row_count`,
  );

  return `
with source_counts as (
${selects.join("\nunion all\n")}
)
select coalesce(jsonb_agg(source_counts order by table_name), '[]'::jsonb) as result
from source_counts;
`.trim();
}

export function buildTargetReadinessSql({ schemaName = "meeting" } = {}) {
  const tableValues = MEETING_SOURCE_TABLES.map((tableName) => `(${quoteLiteral(tableName)})`).join(",\n    ");
  const extensionValues = REQUIRED_TARGET_EXTENSIONS.map((extensionName) => `(${quoteLiteral(extensionName)})`).join(",\n    ");

  return `
with expected_tables(table_name) as (
  values
    ${tableValues}
),
required_extensions(extension_name) as (
  values
    ${extensionValues}
),
target_tables as (
  select
    table_name,
    exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = ${quoteLiteral(schemaName)}
        and c.relname = table_name
        and c.relkind in ('r', 'p')
    ) as exists_in_target
  from expected_tables
),
target_extensions as (
  select
    extension_name,
    exists(select 1 from pg_extension where extname = extension_name) as installed
  from required_extensions
)
select jsonb_build_object(
  'tables', (select coalesce(jsonb_agg(target_tables order by table_name), '[]'::jsonb) from target_tables),
  'extensions', (select coalesce(jsonb_agg(target_extensions order by extension_name), '[]'::jsonb) from target_extensions)
) as result;
`.trim();
}

export function evaluatePreflight({ sourceRows, targetTables, targetExtensions, approvedDataMigration }) {
  const failures = [];
  const sourceTablesWithData = sourceRows.filter((row) => Number(row.row_count ?? 0) > 0);
  const missingTargetTables = targetTables.filter((row) => !row.exists_in_target);
  const missingExtensions = targetExtensions.filter((row) => !row.installed);

  if (sourceTablesWithData.length > 0 && !approvedDataMigration) {
    failures.push({
      code: "SOURCE_DATA_REQUIRES_APPROVED_MIGRATION",
      tables: sourceTablesWithData.map((row) => row.table_name),
    });
  }

  if (missingTargetTables.length > 0) {
    failures.push({
      code: "SUPABASE_TARGET_TABLES_MISSING",
      tables: missingTargetTables.map((row) => row.table_name),
    });
  }

  if (missingExtensions.length > 0) {
    failures.push({
      code: "SUPABASE_EXTENSIONS_MISSING",
      extensions: missingExtensions.map((row) => row.extension_name),
    });
  }

  return {
    ok: failures.length === 0,
    failures,
  };
}

export function resolvePsqlTimeoutMs(rawValue = process.env.PR20_PREFLIGHT_PSQL_TIMEOUT_MS) {
  if (!rawValue) {
    return DEFAULT_PSQL_TIMEOUT_MS;
  }

  const parsed = Number(rawValue);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error("PR20_PREFLIGHT_PSQL_TIMEOUT_MS must be a positive number of milliseconds");
  }
  return parsed;
}

function runPsqlJson(databaseUrl, sql) {
  const timeoutMs = resolvePsqlTimeoutMs();
  const result = spawnSync("psql", [databaseUrl, "--no-align", "--tuples-only", "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });

  if (result.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`psql timed out after ${timeoutMs}ms during Meeting cutover preflight`);
    }
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `psql exited with status ${result.status}`);
  }

  return JSON.parse(result.stdout.trim() || "null");
}

export function runPreflight({
  neonDatabaseUrl,
  supabaseDatabaseUrl,
  approvedDataMigration = false,
  outputPath,
} = {}) {
  if (!neonDatabaseUrl) {
    throw new Error("NEON_DATABASE_URL is required for Meeting cutover preflight");
  }
  if (!supabaseDatabaseUrl) {
    throw new Error("SUPABASE_DATABASE_URL is required for Meeting cutover preflight");
  }

  const sourceRows = runPsqlJson(neonDatabaseUrl, buildSourceRowCountSql({ schemaName: "public" }));
  const targetReadiness = runPsqlJson(supabaseDatabaseUrl, buildTargetReadinessSql({ schemaName: "meeting" }));
  const evaluation = evaluatePreflight({
    sourceRows,
    targetTables: targetReadiness.tables ?? [],
    targetExtensions: targetReadiness.extensions ?? [],
    approvedDataMigration,
  });
  const report = {
    generatedAt: new Date().toISOString(),
    source: { provider: "neon", rows: sourceRows },
    target: {
      provider: "supabase",
      tables: targetReadiness.tables ?? [],
      extensions: targetReadiness.extensions ?? [],
    },
    evaluation,
  };

  if (outputPath) {
    writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
  }

  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const report = runPreflight({
      neonDatabaseUrl: process.env.NEON_DATABASE_URL,
      supabaseDatabaseUrl: process.env.SUPABASE_DATABASE_URL,
      approvedDataMigration: process.env.PR20_APPROVED_DATA_MIGRATION === "1",
      outputPath: process.env.PR20_PREFLIGHT_OUTPUT,
    });
    console.log(JSON.stringify(report, null, 2));
    process.exit(report.evaluation.ok ? 0 : 2);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
