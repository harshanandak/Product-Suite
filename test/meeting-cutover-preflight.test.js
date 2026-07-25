import { describe, expect, test } from "bun:test";
import {
  buildSourceRowCountSql,
  buildTargetReadinessSql,
  evaluatePreflight,
  MEETING_SOURCE_TABLES,
  REQUIRED_TARGET_EXTENSIONS,
  resolvePsqlTimeoutMs,
  runPreflight,
  UNSPECIFIED_PROVIDER,
} from "../scripts/meeting-cutover-preflight.mjs";

/**
 * Captures the (databaseUrl, sql) pair of every query `runPreflight` issues,
 * so the schema names it threads into the SQL builders are observable without
 * a live psql. Returns readiness for the target query and rows for the source
 * query, matching what the real psql JSON would produce.
 */
function recordingRunner({ sourceRows = [], targetTables, targetExtensions } = {}) {
  const calls = [];
  const runner = (databaseUrl, sql) => {
    calls.push({ databaseUrl, sql });
    if (sql.includes("target_extensions")) {
      return {
        tables:
          targetTables ??
          MEETING_SOURCE_TABLES.map((table_name) => ({ table_name, exists_in_target: true })),
        extensions:
          targetExtensions ??
          REQUIRED_TARGET_EXTENSIONS.map((extension_name) => ({ extension_name, installed: true })),
      };
    }
    return sourceRows;
  };
  return { calls, runner };
}

describe("Meeting cutover preflight", () => {
  test("includes every Meeting source table in Neon row-count SQL", () => {
    const sql = buildSourceRowCountSql({ schemaName: "public" }).replace(/\s+/g, " ").toLowerCase();

    for (const tableName of MEETING_SOURCE_TABLES) {
      expect(sql).toContain(`('${tableName}')`);
      expect(sql).not.toContain(`from public.${tableName}`);
    }
    expect(sql).toContain("left join pg_class c");
    expect(sql).toContain("c.relkind in ('r', 'p')");
    expect(sql).toContain("query_to_xml(format('select count(*)::bigint as count from %i.%i'");
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

  test("passes the source schema through to buildSourceRowCountSql", () => {
    const { calls, runner } = recordingRunner();

    runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      sourceSchema: "meeting",
      runQuery: runner,
    });

    const sourceCall = calls.find((call) => call.databaseUrl === "postgres://source");
    expect(sourceCall.sql).toBe(buildSourceRowCountSql({ schemaName: "meeting" }));
  });

  test("passes the target schema through to buildTargetReadinessSql", () => {
    const { calls, runner } = recordingRunner();

    runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      targetSchema: "staging_meeting",
      runQuery: runner,
    });

    const targetCall = calls.find((call) => call.databaseUrl === "postgres://target");
    // Pinned as PASSED, not incidentally correct: the default happens to be
    // "meeting", so only a non-default value proves it is threaded through.
    expect(targetCall.sql).toBe(buildTargetReadinessSql({ schemaName: "staging_meeting" }));
  });

  test("defaults preserve the forward direction (public source, meeting target)", () => {
    const { calls, runner } = recordingRunner();

    runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      runQuery: runner,
    });

    expect(calls.find((call) => call.databaseUrl === "postgres://source").sql).toBe(
      buildSourceRowCountSql({ schemaName: "public" }),
    );
    expect(calls.find((call) => call.databaseUrl === "postgres://target").sql).toBe(
      buildTargetReadinessSql({ schemaName: "meeting" }),
    );
  });

  test("reverse direction qualifies every source table as meeting.<table>", () => {
    const sql = buildSourceRowCountSql({ schemaName: "meeting" }).replace(/\s+/g, " ").toLowerCase();

    expect(sql).toContain("left join pg_namespace n on n.nspname = 'meeting'");
    expect(sql).toContain(
      "query_to_xml(format('select count(*)::bigint as count from %i.%i', 'meeting', table_name)",
    );
    expect(sql).not.toContain("'public'");
    for (const tableName of MEETING_SOURCE_TABLES) {
      expect(sql).toContain(`('${tableName}')`);
    }
  });

  test("reversing direction does not weaken the fail-closed data-migration gate", () => {
    // Regression pin: the gate is direction-agnostic. A populated `meeting`
    // source still fails without approval evidence, exactly as a populated
    // `public` source did.
    const { runner } = recordingRunner({
      sourceRows: [
        { table_name: "action_items", row_count: 12 },
        { table_name: "meetings", row_count: 0 },
      ],
    });

    const report = runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      sourceSchema: "meeting",
      runQuery: runner,
    });

    expect(report.evaluation.ok).toBe(false);
    expect(report.evaluation.failures).toContainEqual({
      code: "SOURCE_DATA_REQUIRES_APPROVED_MIGRATION",
      tables: ["action_items"],
    });
  });

  test("records both schemas in the report so archived evidence names its direction", () => {
    const { runner } = recordingRunner();

    const report = runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      sourceSchema: "meeting",
      targetSchema: "meeting",
      runQuery: runner,
    });

    expect(report.source.schema).toBe("meeting");
    expect(report.target.schema).toBe("meeting");
  });

  test("records the caller's providers, so reverse evidence names Supabase → Neon", () => {
    const { runner } = recordingRunner();

    const report = runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      sourceProvider: "supabase",
      targetProvider: "neon",
      sourceSchema: "meeting",
      targetSchema: "meeting",
      runQuery: runner,
    });

    expect(report.source.provider).toBe("supabase");
    expect(report.target.provider).toBe("neon");
  });

  test("never guesses a vendor: unset providers are recorded as unspecified", () => {
    const { runner } = recordingRunner();

    const report = runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      runQuery: runner,
    });

    // The old hardcoded "neon"/"supabase" labels were wrong in reverse mode.
    // Absent evidence must read as absent, not as the forward direction.
    expect(report.source.provider).toBe(UNSPECIFIED_PROVIDER);
    expect(report.target.provider).toBe(UNSPECIFIED_PROVIDER);
    expect(report.source.provider).not.toBe("neon");
    expect(report.target.provider).not.toBe("supabase");
  });

  test("names the source and target connection slots, not vendors, when a URL is missing", () => {
    expect(() => runPreflight({ targetDatabaseUrl: "postgres://target" })).toThrow(
      "MEETING_PREFLIGHT_SOURCE_DATABASE_URL",
    );
    expect(() => runPreflight({ sourceDatabaseUrl: "postgres://source" })).toThrow(
      "MEETING_PREFLIGHT_TARGET_DATABASE_URL",
    );
  });

  test("still fails on missing target tables and a missing vector extension", () => {
    const { runner } = recordingRunner({
      targetTables: MEETING_SOURCE_TABLES.map((table_name) => ({
        table_name,
        exists_in_target: table_name !== "action_items",
      })),
      targetExtensions: [{ extension_name: "vector", installed: false }],
    });

    const report = runPreflight({
      sourceDatabaseUrl: "postgres://source",
      targetDatabaseUrl: "postgres://target",
      sourceSchema: "meeting",
      targetSchema: "meeting",
      runQuery: runner,
    });

    expect(report.evaluation.ok).toBe(false);
    const codes = report.evaluation.failures.map((failure) => failure.code);
    // Vendor-neutral codes: in this direction the target is Neon, so a
    // `SUPABASE_`-prefixed failure would misname the side that failed.
    expect(codes).toContain("TARGET_TABLES_MISSING");
    expect(codes).toContain("TARGET_EXTENSIONS_MISSING");
  });

  test("bounds psql calls with a configurable positive timeout", () => {
    expect(resolvePsqlTimeoutMs()).toBe(30_000);
    expect(resolvePsqlTimeoutMs("15000")).toBe(15_000);
    expect(() => resolvePsqlTimeoutMs("0")).toThrow("PR20_PREFLIGHT_PSQL_TIMEOUT_MS");
  });
});
