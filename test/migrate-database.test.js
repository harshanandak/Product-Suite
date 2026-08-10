import { describe, expect, test } from "bun:test";

import {
  applyMigrations,
  bootstrapMigrations,
  buildMigrationPlan,
  grantContractDigest,
  runMigrationCli,
  validatePreflightSnapshot,
  verifyMigrations,
  verifyProductionPreflight,
} from "../scripts/migrate-database.mjs";
import { provisionDatabaseRoles } from "../scripts/provision-database-roles.mjs";

const files = [
  { tag: "0018", hash: "h18", timestamp: 18 },
  { tag: "0019", hash: "h19", timestamp: 19 },
  { tag: "0020", hash: "h20", timestamp: 20 },
];

const authority = { environment: "staging", historyVariant: "repaired-bootstrap" };

describe("canonical migration runner", () => {
  const preflightFiles = Array.from({ length: 20 }, (_, index) => ({
    tag: String(index).padStart(4, "0"),
    hash: String(index).padStart(64, "0"),
    timestamp: index,
  }));
  const preflightContract = {
    schemaVersion: "neon-production-preflight-grants.v1",
    name: "product-suite-neon-preflight-reader-v1",
    database: "neondb",
    schema: "public",
    positivePrivileges: [
      { source: "effective", objectKind: "database", objectName: "neondb", privilege: "CONNECT", granted: true },
      { source: "effective", objectKind: "schema", objectName: "public", privilege: "USAGE", granted: true },
      { source: "effective", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "SELECT", granted: true },
    ],
    negativePrivileges: [
      { source: "direct", objectKind: "schema", objectName: "public", privilege: "CREATE", granted: false },
      { source: "inherited", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "INSERT", granted: false },
      { source: "PUBLIC", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "UPDATE", granted: false },
      { source: "default-acl", objectKind: "sequence", objectName: "drizzle.__drizzle_migrations_id_seq", privilege: "USAGE", granted: false },
    ],
    denialProbes: ["INSERT", "UPDATE", "DELETE", "DDL", "nextval"],
    rowCountMetrics: ["drizzle_migration_rows"],
  };
  const loginIdentifier = "product_suite_neon_preflight_reader";
  const preflightAttestation = {
    target: { endpointId: "test-endpoint", database: "neondb", schema: "public" },
    role: {
      loginIdentifier,
      grantContract: preflightContract.name,
      grantContractSha256: grantContractDigest(preflightContract),
    },
    catalog: { catalogSha256: "a".repeat(64) },
  };
  const privilegeFacts = [...preflightContract.positivePrivileges, ...preflightContract.negativePrivileges];
  const denialProbes = ["autocommit", "transaction"].flatMap((mode) =>
    preflightContract.denialProbes.map((operation) => ({ mode, operation, code: "25006" })),
  );
  const snapshot = {
    identity: {
      database: "neondb", schema: "public", loginIdentifier,
      canLogin: true, superuser: false, createDatabase: false, createRole: false,
      replication: false, bypassRls: false, temporary: false,
    },
    privilegeFacts,
    defaultAclWritePaths: [],
    denialProbes,
    catalogDigest: "a".repeat(64),
    aggregateRowCounts: [{ metric: "drizzle_migration_rows", count: 18 }],
  };

  test("validates the pinned preflight LOGIN, grant digest, all privilege paths, and denial probes", () => {
    expect(validatePreflightSnapshot({
      snapshot,
      attestation: preflightAttestation,
      grantContract: preflightContract,
      expectedEndpointId: "test-endpoint",
    })).toMatchObject({ ok: true, loginIdentifier, catalogDigest: "a".repeat(64) });
  });

  test.each([
    ["owner role", { identity: { ...snapshot.identity, loginIdentifier: "neondb_owner" } }, "PREFLIGHT_LOGIN_MISMATCH"],
    ["superuser", { identity: { ...snapshot.identity, superuser: true } }, "PREFLIGHT_ROLE_ADMIN"],
    ["missing role attribute proof", { identity: { ...snapshot.identity, bypassRls: undefined } }, "PREFLIGHT_ROLE_ADMIN"],
    ["schema create", { privilegeFacts: privilegeFacts.map((fact) => fact.objectKind === "schema" && fact.privilege === "CREATE" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["inherited write", { privilegeFacts: privilegeFacts.map((fact) => fact.source === "inherited" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["PUBLIC write", { privilegeFacts: privilegeFacts.map((fact) => fact.source === "PUBLIC" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["sequence write", { privilegeFacts: privilegeFacts.map((fact) => fact.objectKind === "sequence" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["default ACL write", { defaultAclWritePaths: [{ subject: loginIdentifier, privilege: "INSERT" }] }, "PREFLIGHT_DEFAULT_ACL_WRITE"],
    ["successful autocommit probe", { denialProbes: denialProbes.map((probe, index) => index === 0 ? { ...probe, code: null } : probe) }, "PREFLIGHT_DENIAL_PROBE_SUCCEEDED"],
    ["catalog mismatch", { catalogDigest: "b".repeat(64) }, "PREFLIGHT_CATALOG_MISMATCH"],
  ])("fails closed for %s", (_label, override, code) => {
    expect(validatePreflightSnapshot({
      snapshot: { ...snapshot, ...override },
      attestation: preflightAttestation,
      grantContract: preflightContract,
      expectedEndpointId: "test-endpoint",
    })).toEqual({ ok: false, code });
  });

  test("derives the exact original-production suffix and emits PREFLIGHT_READY without a successful mutation", async () => {
    const calls = [];
    const adapter = {
      connect: async () => ({
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("preflight:identity")) return { rows: [snapshot.identity] };
          if (sql.includes("preflight:privileges")) return { rows: privilegeFacts };
          if (sql.includes("preflight:default-acl")) return { rows: [] };
          if (sql.includes("preflight:catalog")) return { rows: [{ catalog_digest: snapshot.catalogDigest }] };
          if (sql.includes("preflight:row-counts")) return { rows: snapshot.aggregateRowCounts };
          if (sql.includes("SELECT hash, created_at AS timestamp FROM drizzle.__drizzle_migrations")) return { rows: preflightFiles.slice(0, 18) };
          if (/INSERT|UPDATE|DELETE|CREATE TABLE|nextval/i.test(sql)) {
            const error = new Error("redacted"); error.code = "25006"; throw error;
          }
          return { rows: [] };
        },
        release: () => {},
      }),
    };

    const result = await verifyProductionPreflight({
      adapter,
      files: preflightFiles,
      expectedFloor: "0017",
      authority: { environment: "production", historyVariant: "original-production" },
      attestation: preflightAttestation,
      grantContract: preflightContract,
      endpointId: "test-endpoint",
      runContext: { runSha: "c".repeat(40), repository: "befach/product-suite", runId: "123" },
    });

    expect(result).toMatchObject({
      ok: true, status: "PREFLIGHT_READY", historyVariant: "original-production",
      expectedFloor: "0017", expectedCount: 18,
      pending: [{ tag: "0018", hash: preflightFiles[18].hash }, { tag: "0019", hash: preflightFiles[19].hash }],
    });
    expect(calls.join("\n")).toContain("has_schema_privilege");
    expect(calls.join("\n")).toContain("has_table_privilege");
    expect(calls.join("\n")).toContain("has_sequence_privilege");
    expect(calls.join("\n")).toContain("pg_default_acl");
    expect(calls.filter((sql) => /^(?:INSERT|UPDATE|DELETE|CREATE TABLE|SELECT nextval)/i.test(sql))).toHaveLength(10);
  });

  test("reports a controlled CLI failure when pool creation is unavailable", async () => {
    const errors = [];
    const previousExitCode = process.exitCode ?? 0;
    process.exitCode = 0;
    try {
      await runMigrationCli({
        args: ["verify", "--environment", "test", "--history-variant", "repaired-bootstrap"],
        databaseUrl: "postgresql://postgres:secret@localhost:5432/app",
        poolFactory: async () => { throw new Error("DATABASE_POOL_UNAVAILABLE"); },
        writeError: (message) => errors.push(message),
      });

      expect(errors).toEqual(["migration verify failed: DATABASE_POOL_UNAVAILABLE"]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  test("fails the fixed production preflight command before opening a pool when attestation is unconfigured", async () => {
    const errors = [];
    let opened = false;
    const previousExitCode = process.exitCode ?? 0;
    process.exitCode = 0;
    try {
      await runMigrationCli({
        args: ["verify", "--environment", "production", "--history-variant", "original-production", "--expected-floor", "0017"],
        databaseUrl: "postgresql://reader:secret@ep-test-endpoint.us-east-2.aws.neon.tech/neondb?sslmode=require",
        poolFactory: async () => { opened = true; return { query: async () => ({ rows: [] }) }; },
        preflightAttestation: { configured: false, schemaVersion: "neon-production-preflight-attestation.v1" },
        preflightTrust: { schemaVersion: "neon-production-preflight-trust.v1", keys: [] },
        preflightFileBytes: '{"configured":false,"schemaVersion":"neon-production-preflight-attestation.v1"}',
        runContext: { runSha: "d".repeat(40), repository: "befach/product-suite", runId: "123" },
        writeError: (message) => errors.push(message),
      });
      expect(opened).toBe(false);
      expect(errors).toEqual(["migration verify rejected: PREFLIGHT_ATTESTATION_UNCONFIGURED"]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

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
    expect(calls.join("\n")).not.toContain("pg_available_extensions");
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

  test("bootstrap accepts available-but-not-installed pgvector and reaches its migrations", async () => {
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
          if (sql.includes("FROM pg_available_extensions")) return { rows: [{ name: "vector" }] };
          if (sql.includes("FROM pg_extension")) return { rows: [] };
          if (sql.includes("count(*) FROM drizzle.__drizzle_migrations")) return { rows: [{ migration_count: "0" }] };
          return { rows: [] };
        },
      },
      files: bootstrapFiles,
      declared: bootstrapFiles.map((file) => file.tag),
      authority: { environment: "test", historyVariant: "repaired-bootstrap" },
    });

    expect(result).toMatchObject({ ok: true, status: "BOOTSTRAPPED" });
    expect(calls).toContain("SELECT 1;");
    expect(calls.join("\n")).not.toContain("FROM pg_extension");
    expect(calls.findIndex((sql) => sql.includes("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations"))).toBeLessThan(
      calls.findIndex((sql) => sql.includes("count(*) FROM drizzle.__drizzle_migrations")),
    );
  });

  test("bootstrap rejects a target where pgvector is unavailable", async () => {
    const calls = [];
    const result = await bootstrapMigrations({
      adapter: {
        query: async (sql) => {
          calls.push(sql);
          if (sql === "SHOW server_version_num;") return { rows: [{ server_version_num: "170000" }] };
          if (sql.includes("FROM pg_available_extensions")) return { rows: [] };
          return { rows: [] };
        },
      },
      files,
      declared: files.map((file) => file.tag),
      authority: { environment: "test", historyVariant: "repaired-bootstrap" },
    });

    expect(result).toEqual({ ok: false, code: "PGVECTOR_REQUIRED" });
    expect(calls.join("\n")).toContain("FROM pg_available_extensions");
    expect(calls.join("\n")).not.toContain("CREATE SCHEMA");
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
