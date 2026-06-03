import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const migrationPath = join(
  rootDir,
  "infra",
  "supabase",
  "migrations",
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
