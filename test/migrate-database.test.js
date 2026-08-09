import { describe, expect, test } from "bun:test";

import {
  applyMigrations,
  bootstrapMigrations,
  buildMigrationPlan,
  verifyMigrations,
} from "../scripts/migrate-database.mjs";
import { provisionDatabaseRoles } from "../scripts/provision-database-roles.mjs";

const files = [
  { tag: "0018", hash: "h18", timestamp: 18 },
  { tag: "0019", hash: "h19", timestamp: 19 },
  { tag: "0020", hash: "h20", timestamp: 20 },
];

const authority = { environment: "staging", historyVariant: "repaired-bootstrap" };

describe("canonical migration runner", () => {
  test("plans an exact contiguous suffix and rejects reordered extras", () => {
    expect(buildMigrationPlan({ applied: ["0019"], declared: ["0020"], files, authority })).toMatchObject({
      ok: true,
      pending: ["0020"],
    });
    expect(buildMigrationPlan({ applied: ["0019"], declared: ["0020", "0018"], files, authority }).ok).toBe(false);
  });

  test("rejects environment/flag mismatch and P0 non-allowlisted suffix", () => {
    expect(buildMigrationPlan({ applied: ["0019"], declared: ["0020"], files, authority: { environment: "production", historyVariant: "repaired-bootstrap" } }).ok).toBe(false);
    expect(buildMigrationPlan({ applied: ["0017"], declared: ["0020"], files, authority: { environment: "production", historyVariant: "original-production" } }).ok).toBe(false);
  });

  test("verify emits NOOP without writes at the expected floor", async () => {
    const calls = [];
    const result = await verifyMigrations({
      adapter: { query: async (sql) => { calls.push(sql); return { rows: [{ tag: "0019", hash: "h19" }] }; } },
      applied: ["0019"], files, expectedFloor: "0019", declared: [], authority,
    });
    expect(result).toMatchObject({ ok: true, status: "NOOP" });
    expect(calls).toHaveLength(0);
  });

  test("apply rereads under an advisory lock before executing", async () => {
    const calls = [];
    const result = await applyMigrations({
      adapter: {
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: [{ hash: "h19", timestamp: 19 }] };
          return { rows: [] };
        },
      },
      applied: ["0019"], files, declared: ["0020"], authority,
    });
    expect(result.ok).toBe(true);
    expect(calls.join("\n")).toContain("pg_advisory_xact_lock");
  });

  test("accepts a full Drizzle migration tag when the caller supplies its numeric floor", () => {
    const fullTag = "0019_neon_authority_reconciliation";
    const fullFiles = files.map((file) => file.tag === "0019" ? { ...file, tag: fullTag } : file);
    expect(buildMigrationPlan({
      applied: [{ tag: fullTag, hash: "h19", timestamp: 19 }],
      declared: ["0020"],
      files: fullFiles,
      expectedFloor: "0019",
      authority,
    })).toMatchObject({ ok: true, applied: [fullTag], pending: ["0020"] });
  });

  test("fails closed when the locked history re-read is empty", async () => {
    await expect(applyMigrations({
      adapter: { query: async () => ({ rows: [] }) },
      applied: ["0019"], files, declared: ["0020"], authority,
    })).rejects.toThrow("MIGRATION_TOCTOU");
  });

  test("strips only an outer trailing COMMIT marker from migration SQL", async () => {
    const calls = [];
    const migrationFiles = [
      ...files.slice(0, 2),
      {
        ...files[2],
        sql: "BEGIN;\nSELECT 'COMMIT;';\nSELECT '--> statement-breakpoint';\n--> statement-breakpoint\nselect 2;\n  cOmMiT;\n",
      },
    ];
    const result = await applyMigrations({
      adapter: {
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: [{ hash: "h19", timestamp: 19 }] };
          return { rows: [] };
        },
      },
      applied: ["0019"],
      files: migrationFiles,
      declared: ["0020"],
      authority,
    });
    const migrationSql = calls.find((sql) => sql.includes("SELECT 'COMMIT;'") );

    expect(result.ok).toBe(true);
    expect(migrationSql).toContain("SELECT 'COMMIT;'");
    expect(migrationSql).toContain("SELECT '--> statement-breakpoint';");
    expect(migrationSql).toContain(";\nselect 2;");
    expect(migrationSql).not.toMatch(/commit;\s*$/i);
  });

  test("bootstrap creates its owned journal before inspecting a truly empty database", async () => {
    const calls = [];
    let journalReady = false;
    const bootstrapFiles = files.slice(0, 2).map((file) => ({ ...file, sql: "SELECT 1;" }));
    const result = await bootstrapMigrations({
      adapter: {
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations")) journalReady = true;
          if (sql.includes("count(*) FROM drizzle.__drizzle_migrations") && !journalReady) throw new Error("JOURNAL_MISSING");
          if (sql === "SHOW server_version_num;") return { rows: [{ server_version_num: "170000" }] };
          if (sql.includes("FROM pg_extension")) return { rows: [{ extname: "vector" }] };
          if (sql.includes("count(*) FROM drizzle.__drizzle_migrations")) return { rows: [{ migration_count: "0" }] };
          return { rows: [] };
        },
      },
      files: bootstrapFiles,
      declared: bootstrapFiles.map((file) => file.tag),
      authority: { environment: "test", historyVariant: "repaired-bootstrap" },
    });

    expect(result).toMatchObject({ ok: true, status: "BOOTSTRAPPED" });
    expect(calls.findIndex((sql) => sql.includes("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations"))).toBeLessThan(
      calls.findIndex((sql) => sql.includes("count(*) FROM drizzle.__drizzle_migrations")),
    );
  });

  test.each([
    ["repaired bootstrap", { environment: "test", historyVariant: "repaired-bootstrap" }],
    ["test-only original conformance", { environment: "conformance-original", historyVariant: "original-production" }],
  ])("provisions roles before applying synthetic 0020 then verifies NOOP for %s", async (_label, variantAuthority) => {
    const calls = [];
    const adapter = {
      query: async (sql) => {
        calls.push(sql);
        if (sql.includes("current_user AS rolname")) return { rows: [{ rolname: "neondb_owner", rolcanlogin: true, rolsuper: true, rolcreaterole: true, rolcreatedb: true }] };
        if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: [{ hash: "h19", timestamp: 19 }] };
        if (sql.includes("FROM pg_roles r") && sql.includes("product_suite_platform_runtime")) return {
          rows: [
            { rolname: "product_suite_platform_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
            { rolname: "product_suite_meeting_runtime", rolcanlogin: false, rolsuper: false, rolcreaterole: false, rolcreatedb: false },
          ],
        };
        return { rows: [] };
      },
    };

    const provisioned = await provisionDatabaseRoles({
      adapter,
      databaseUrl: "postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require",
      environment: variantAuthority.environment,
    });
    const applied = await applyMigrations({
      adapter,
      applied: ["0019"],
      files,
      declared: ["0020"],
      authority: variantAuthority,
    });
    const noop = await verifyMigrations({
      adapter,
      applied: ["0019", "0020"],
      files,
      declared: [],
      expectedFloor: "0020",
      authority: variantAuthority,
    });

    expect(provisioned.ok).toBe(true);
    expect(applied).toMatchObject({ ok: true, status: "APPLIED", historyVariant: variantAuthority.historyVariant });
    expect(noop).toMatchObject({ ok: true, status: "NOOP" });
    expect(calls.findIndex((sql) => sql.includes("product-suite:database-roles"))).toBeLessThan(
      calls.findIndex((sql) => sql.includes("product-suite:database-migrations")),
    );
  });
});
