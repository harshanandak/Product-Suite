import { describe, expect, test } from "bun:test";
import {
  buildSourceRowCountSql,
  buildTargetReadinessSql,
  evaluatePreflight,
  MEETING_SOURCE_TABLES,
  REQUIRED_TARGET_EXTENSIONS,
  resolvePsqlTimeoutMs,
} from "../scripts/meeting-cutover-preflight.mjs";

describe("Meeting cutover preflight", () => {
  test("includes every Meeting source table in Neon row-count SQL", () => {
    const sql = buildSourceRowCountSql({ schemaName: "public" }).replace(/\s+/g, " ").toLowerCase();

    for (const tableName of MEETING_SOURCE_TABLES) {
      expect(sql).toContain(`'${tableName}' as table_name`);
      expect(sql).toContain(`to_regclass('public.${tableName}')`);
      expect(sql).toContain(`from public.${tableName}`);
    }
  });

  test("checks every Supabase target table and required extension", () => {
    const sql = buildTargetReadinessSql({ schemaName: "meeting" }).replace(/\s+/g, " ").toLowerCase();

    for (const tableName of MEETING_SOURCE_TABLES) {
      expect(sql).toContain(`('${tableName}')`);
    }
    expect(sql).toContain("from pg_class c");
    expect(sql).toContain("join pg_namespace n on n.oid = c.relnamespace");
    expect(sql).toContain("n.nspname = 'meeting'");
    expect(sql).toContain("c.relkind in ('r', 'p')");

    for (const extensionName of REQUIRED_TARGET_EXTENSIONS) {
      expect(sql).toContain(`('${extensionName}')`);
      expect(sql).toContain("from pg_extension");
    }
  });

  test("fails closed when Neon source rows exist without approved migration evidence", () => {
    const result = evaluatePreflight({
      sourceRows: [
        { table_name: "users", row_count: 1 },
        { table_name: "meetings", row_count: 0 },
      ],
      targetTables: MEETING_SOURCE_TABLES.map((tableName) => ({
        table_name: tableName,
        exists_in_target: true,
      })),
      targetExtensions: REQUIRED_TARGET_EXTENSIONS.map((extensionName) => ({
        extension_name: extensionName,
        installed: true,
      })),
      approvedDataMigration: false,
    });

    expect(result.ok).toBe(false);
    expect(result.failures).toContainEqual({
      code: "SOURCE_DATA_REQUIRES_APPROVED_MIGRATION",
      tables: ["users"],
    });
  });

  test("passes when target is ready and populated source has approved migration evidence", () => {
    const result = evaluatePreflight({
      sourceRows: [
        { table_name: "users", row_count: 1 },
        { table_name: "meetings", row_count: 2 },
      ],
      targetTables: MEETING_SOURCE_TABLES.map((tableName) => ({
        table_name: tableName,
        exists_in_target: true,
      })),
      targetExtensions: REQUIRED_TARGET_EXTENSIONS.map((extensionName) => ({
        extension_name: extensionName,
        installed: true,
      })),
      approvedDataMigration: true,
    });

    expect(result).toEqual({ ok: true, failures: [] });
  });

  test("bounds psql calls with a configurable positive timeout", () => {
    expect(resolvePsqlTimeoutMs()).toBe(30_000);
    expect(resolvePsqlTimeoutMs("15000")).toBe(15_000);
    expect(() => resolvePsqlTimeoutMs("0")).toThrow("PR20_PREFLIGHT_PSQL_TIMEOUT_MS");
  });
});
