import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const migrationsDir = join(rootDir, "infra", "supabase", "migrations");
const migrationPath = join(
  migrationsDir,
  "20260602120000_create_platform_schema.sql",
);

function compactSql(sql) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

describe("PR19 Supabase platform schema", () => {
  test("creates the platform schema and core platform tables", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = compactSql(readFileSync(migrationPath, "utf8"));

    expect(migration).toContain("create schema if not exists platform");
    for (const tableName of [
      "users",
      "workspaces",
      "memberships",
      "auth_identities",
      "audit_events",
    ]) {
      expect(migration).toContain(`create table if not exists platform.${tableName}`);
    }
    expect(migration).toContain("platform.users");
    expect(migration).toContain("platform.workspaces");
    expect(migration).toContain("platform.memberships");
  });

  test("reserves private module schemas without moving Meeting data", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = compactSql(readFileSync(migrationPath, "utf8"));

    for (const schemaName of ["meeting", "roadmap", "agent"]) {
      expect(migration).toContain(`create schema if not exists ${schemaName}`);
      expect(migration).toContain(`comment on schema ${schemaName}`);
    }
    expect(migration).toContain(
      "supabase owns the built-in realtime schema; pr19 does not alter it",
    );
    expect(migration).not.toContain("create schema if not exists realtime");
    expect(migration).not.toContain("create table if not exists meeting.meetings");
  });
});

describe("PR20 Meeting Supabase schema cutover", () => {
  test("represents Meeting Alembic baseline tables in Supabase migrations", () => {
    const migrationSql = readdirSync(migrationsDir)
      .filter((fileName) => fileName.endsWith(".sql"))
      .sort()
      .map((fileName) => readFileSync(join(migrationsDir, fileName), "utf8"))
      .join("\n");
    const compactedMigrationSql = compactSql(migrationSql);

    for (const tableName of [
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
    ]) {
      expect(compactedMigrationSql).toContain(`create table if not exists meeting.${tableName}`);
    }

    expect(compactedMigrationSql).toContain("create extension if not exists vector");
    expect(compactedMigrationSql).toContain("alembic baseline is read-only history");
    expect(compactedMigrationSql).toContain("create table if not exists public.alembic_version");
    expect(compactedMigrationSql).toContain("alter table public.alembic_version enable row level security");
    expect(compactedMigrationSql).toContain("values ('0005_remove_workos_session_id')");
  });
});
