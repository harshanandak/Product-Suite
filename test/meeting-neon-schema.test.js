import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { analyzeMigrationParity } from "../scripts/check-migration-parity.mjs";
import { MEETING_SOURCE_TABLES } from "../scripts/meeting-cutover-preflight.mjs";

const rootDir = join(import.meta.dir, "..");
const migrationsDir = join(rootDir, "packages", "db", "migrations");
const migrationPath = join(migrationsDir, "0016_meeting_schema.sql");

function readMigration() {
  expect(existsSync(migrationPath)).toBe(true);
  return readFileSync(migrationPath, "utf8");
}

function compactSql(sql) {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Strips `--` comments so a test can never be satisfied (or tripped) by prose.
 * The migration documents itself heavily; every assertion below is about DDL.
 */
function stripComments(sql) {
  return sql
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n");
}

/**
 * Pulls `{ table, column, type }` for every column declared inside a
 * `create table ... (...)` block, so type assertions read the real DDL rather
 * than a substring of it.
 */
function parseColumns(sql) {
  const columns = [];
  const tableBlocks = stripComments(sql).matchAll(
    /create table if not exists\s+([a-z_.]+)\s*\(([\s\S]*?)\n\);/gi,
  );

  for (const [, tableName, body] of tableBlocks) {
    for (const rawLine of body.split("\n")) {
      const line = rawLine.trim().replace(/,$/, "");
      if (!line || /^(unique|primary key|constraint|check|foreign key)\b/i.test(line)) {
        continue;
      }
      const match = line.match(/^"?([a-z_][a-z0-9_]*)"?\s+(.+)$/i);
      if (!match) continue;
      columns.push({
        table: tableName.toLowerCase(),
        column: match[1].toLowerCase(),
        type: match[2].trim().toLowerCase(),
      });
    }
  }

  return columns;
}

describe("Task A.1 — Neon meeting schema migration", () => {
  test("declares every table the cutover preflight expects", () => {
    const migration = compactSql(readMigration());

    expect(migration).toContain("create schema if not exists meeting");
    // Derived from MEETING_SOURCE_TABLES, never a second hand-kept list: a table
    // added to the preflight can then never silently miss this schema.
    expect(MEETING_SOURCE_TABLES.length).toBeGreaterThan(0);
    for (const tableName of MEETING_SOURCE_TABLES) {
      expect(migration).toContain(`create table if not exists meeting.${tableName}`);
    }
  });

  test("keeps every id and tenant_id column TEXT — no id-shape change in this slice", () => {
    const columns = parseColumns(readMigration());
    expect(columns.length).toBeGreaterThan(0);

    const idColumns = columns.filter(
      ({ column }) => column === "id" || column === "tenant_id",
    );
    // Every one of the 19 tables has an `id`; most also carry `tenant_id`.
    expect(idColumns.length).toBeGreaterThanOrEqual(MEETING_SOURCE_TABLES.length);

    for (const { table, column, type } of idColumns) {
      expect(`${table}.${column}: ${type}`).toMatch(/: text\b/);
    }

    expect(stripComments(readMigration()).toLowerCase()).not.toContain("uuid");
  });

  test("carries no Supabase-only construct that would fail on Neon", () => {
    const migration = compactSql(stripComments(readMigration()));

    expect(migration).not.toContain("enable row level security");
    expect(migration).not.toContain("anon");
    expect(migration).not.toContain("authenticated");
    expect(migration).not.toContain("service_role");
    expect(migration).not.toMatch(/\bgrant\b/);
    expect(migration).not.toMatch(/\brevoke\b/);
    expect(migration).not.toContain("extensions.");
  });

  test("never touches public.alembic_version — the platform public schema is Drizzle-owned", () => {
    const migration = compactSql(stripComments(readMigration()));

    expect(migration).not.toContain("alembic_version");
    expect(migration).not.toContain("public.");
  });

  test("requires the vector extension the embedding column depends on", () => {
    const migration = compactSql(stripComments(readMigration()));

    expect(migration).toContain("create extension if not exists vector;");
    expect(migration).toContain("vector(1536)");
  });

  test("migration parity holds — the journal and the .sql files agree", () => {
    const journal = JSON.parse(
      readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"),
    );
    const sqlFileNames = readdirSync(migrationsDir).filter((fileName) =>
      fileName.endsWith(".sql"),
    );

    expect(sqlFileNames).toContain("0016_meeting_schema.sql");
    expect(journal.entries.map((entry) => entry.tag)).toContain("0016_meeting_schema");
    expect(analyzeMigrationParity(journal, sqlFileNames)).toEqual([]);
  });
});
