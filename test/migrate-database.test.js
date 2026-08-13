import { describe, expect, test } from "bun:test";

import {
  applyMigrations,
  bootstrapMigrations,
  buildMigrationPlan,
  DEFAULT_ACL_SQL,
  grantContractDigest,
  loadMigrationFiles,
  productionPreflightFiles,
  runMigrationCli,
  validateProductionHistoryRows,
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
const productionManifest = JSON.parse(await Bun.file("docs/history/database-migrations/manifest.json").text());

describe("canonical migration runner", () => {
  const preflightFiles = Array.from({ length: 21 }, (_, index) => ({
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
      { source: "default-acl", objectKind: "database", objectName: "neondb", privilege: "CREATE", granted: false },
      { source: "default-acl", objectKind: "schema", objectName: "public", privilege: "CREATE", granted: false },
      { source: "default-acl", objectKind: "schema", objectName: "drizzle", privilege: "CREATE", granted: false },
      { source: "effective", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "INSERT", granted: false },
      { source: "effective", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "UPDATE", granted: false },
      { source: "effective", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "DELETE", granted: false },
      { source: "effective", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "TRUNCATE", granted: false },
      { source: "effective", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "REFERENCES", granted: false },
      { source: "effective", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "TRIGGER", granted: false },
      { source: "effective", objectKind: "sequence", objectName: "drizzle.__drizzle_migrations_id_seq", privilege: "USAGE", granted: false },
      { source: "effective", objectKind: "sequence", objectName: "drizzle.__drizzle_migrations_id_seq", privilege: "UPDATE", granted: false },
      { source: "effective", objectKind: "sequence", objectName: "drizzle.__drizzle_migrations_id_seq", privilege: "SELECT", granted: false },
      { source: "direct", objectKind: "schema", objectName: "public", privilege: "CREATE", granted: false },
      { source: "inherited", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "INSERT", granted: false },
      { source: "PUBLIC", objectKind: "table", objectName: "drizzle.__drizzle_migrations", privilege: "UPDATE", granted: false },
      { source: "direct", objectKind: "sequence", objectName: "drizzle.__drizzle_migrations_id_seq", privilege: "USAGE", granted: false },
      { source: "default-acl", objectKind: "sequence", objectName: "drizzle.__drizzle_migrations_id_seq", privilege: "USAGE", granted: false },
    ],
    denialProbes: ["INSERT", "UPDATE", "DELETE", "DDL", "nextval"],
    rowCountMetrics: ["drizzle_migration_rows"],
  };
  const loginIdentifier = "product_suite_neon_preflight_reader";
  const preflightAttestation = {
    target: { projectId: "project-test", productionBranchId: "branch-test", endpointId: "test-endpoint", database: "neondb", schema: "public" },
    role: {
      loginIdentifier,
      grantContract: preflightContract.name,
      grantContractSha256: grantContractDigest(preflightContract),
    },
    catalog: { catalogSha256: "a".repeat(64) },
    recovery: { kind: "branch", id: "recovery-test", sourceBranchId: "branch-test" },
    source: { kind: "independently-signed-export", immutableSourceSha256: "b".repeat(64), producedAt: "2026-08-10T09:00:00.000Z" },
    validity: { expiresAt: "2026-08-11T09:00:00.000Z" },
  };
  const privilegeFacts = [...preflightContract.positivePrivileges, ...preflightContract.negativePrivileges]
    .filter((fact) => fact.source !== "default-acl");
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

  test("validates unordered probe and metric inputs with stable lexical ordering", () => {
    expect(validatePreflightSnapshot({
      snapshot: {
        ...snapshot,
        denialProbes: [...snapshot.denialProbes].reverse(),
        aggregateRowCounts: [...snapshot.aggregateRowCounts].reverse(),
      },
      attestation: preflightAttestation,
      grantContract: preflightContract,
      expectedEndpointId: "test-endpoint",
    })).toMatchObject({ ok: true, loginIdentifier });
  });

  test("observes object-specific database and schema CREATE default-ACL paths", () => {
    expect(DEFAULT_ACL_SQL).toContain("object_kind");
    expect(DEFAULT_ACL_SQL).toContain("object_name");
    expect(DEFAULT_ACL_SQL).toContain("privilege");
    expect(DEFAULT_ACL_SQL).toContain("'CREATE'");
    expect(DEFAULT_ACL_SQL).toContain("acldefault('d'");
    expect(DEFAULT_ACL_SQL).toContain("acldefault('n'");
    expect(DEFAULT_ACL_SQL).not.toContain("default-acl' THEN false");
  });

  test.each([
    ["owner role", { identity: { ...snapshot.identity, loginIdentifier: "neondb_owner" } }, "PREFLIGHT_LOGIN_MISMATCH"],
    ["superuser", { identity: { ...snapshot.identity, superuser: true } }, "PREFLIGHT_ROLE_ADMIN"],
    ["missing role attribute proof", { identity: { ...snapshot.identity, bypassRls: undefined } }, "PREFLIGHT_ROLE_ADMIN"],
    ["schema create", { privilegeFacts: privilegeFacts.map((fact) => fact.objectKind === "schema" && fact.privilege === "CREATE" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["effective table DML", { privilegeFacts: privilegeFacts.map((fact) => fact.source === "effective" && fact.objectKind === "table" && fact.privilege === "INSERT" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["effective sequence privilege", { privilegeFacts: privilegeFacts.map((fact) => fact.source === "effective" && fact.objectKind === "sequence" && fact.privilege === "USAGE" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["inherited write", { privilegeFacts: privilegeFacts.map((fact) => fact.source === "inherited" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["PUBLIC write", { privilegeFacts: privilegeFacts.map((fact) => fact.source === "PUBLIC" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["sequence write", { privilegeFacts: privilegeFacts.map((fact) => fact.objectKind === "sequence" ? { ...fact, granted: true } : fact) }, "PREFLIGHT_WRITE_PRIVILEGE"],
    ["database CREATE default ACL", { defaultAclWritePaths: [{ source: "default-acl", objectKind: "database", objectName: "neondb", privilege: "CREATE", granted: true }] }, "PREFLIGHT_DEFAULT_ACL_WRITE"],
    ["schema CREATE default ACL", { defaultAclWritePaths: [{ source: "default-acl", objectKind: "schema", objectName: "public", privilege: "CREATE", granted: true }] }, "PREFLIGHT_DEFAULT_ACL_WRITE"],
    ["unknown default ACL path", { defaultAclWritePaths: [{ source: "default-acl", objectKind: "schema", objectName: "uncontracted", privilege: "CREATE", granted: true }] }, "PREFLIGHT_DEFAULT_ACL_UNPROVEN"],
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
      runContext: {
        runSha: "c".repeat(40), repository: "befach/product-suite", runId: "123",
        attestationBlobId: "d".repeat(40), attestationFileSha256: "e".repeat(64),
        attestationCanonicalPayloadSha256: "f".repeat(64), signatureKeyId: "test-key-v1",
      },
    });

    expect(result).toMatchObject({
      ok: true, status: "PREFLIGHT_READY", historyVariant: "original-production",
      expectedFloor: "0017", expectedCount: 18,
      pending: [
        { tag: "0018", hash: preflightFiles[18].hash },
        { tag: "0019", hash: preflightFiles[19].hash },
        { tag: "0020", hash: preflightFiles[20].hash },
      ],
    });
    expect(calls.join("\n")).toContain("has_schema_privilege");
    expect(calls.join("\n")).toContain("has_table_privilege");
    expect(calls.join("\n")).toContain("has_sequence_privilege");
    expect(calls.join("\n")).toContain("pg_default_acl");
    expect(calls.filter((sql) => /^(?:INSERT|UPDATE|DELETE|CREATE TABLE|SELECT nextval)/i.test(sql))).toHaveLength(10);
  });

  test("maps only the exact original-production raw hashes to tags", () => {
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const timestamps = new Map(productionPreflightFiles(loadMigrationFiles()).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const applied = vector.map((entry) => ({ hash: entry.observedSha256, timestamp: timestamps.get(entry.tag) }));
    const result = buildMigrationPlan({
      applied,
      declared: [],
      files: loadMigrationFiles(),
      authority: { environment: "conformance-original", historyVariant: "original-production" },
      history: { manifest: productionManifest },
      expectedCount: 18,
      expectedFloor: "0017",
    });
    expect(result).toMatchObject({ ok: true, applied: loadMigrationFiles().filter(({ timestamp }) => timestamp <= 17).map(({ tag }) => tag) });
    const unknown = applied.map((entry) => ({ ...entry }));
    unknown[5].hash = "0".repeat(64);
    expect(buildMigrationPlan({
      applied: unknown,
      declared: [],
      files: loadMigrationFiles(),
      authority: { environment: "conformance-original", historyVariant: "original-production" },
      history: { manifest: productionManifest },
      expectedCount: 18,
      expectedFloor: "0017",
    })).toMatchObject({ ok: false, code: "MIGRATION_TAG_UNKNOWN" });
  });

  test("binds repair hashes to their expected original-production filenames", () => {
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    expect(buildMigrationPlan({
      applied: ["0019"],
      declared: ["0020"],
      files,
      authority,
      hashes: {
        "0000_stale_jamie_braddock.sql": vector[1].observedSha256,
        "0004_minor_lockheed.sql": vector[4].observedSha256,
      },
      history: { manifest: productionManifest },
    })).toMatchObject({ ok: false, code: "MIGRATION_HISTORY_VARIANT_UNKNOWN" });
  });

  test("rejects incomplete or mutated original-production prefixes before a suffix", () => {
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const files = loadMigrationFiles();
    const authority = { environment: "conformance-original", historyVariant: "original-production" };
    const plan = (applied) => buildMigrationPlan({ applied, declared: [], files, authority, history: { manifest: productionManifest } });
    const timestamps = new Map(productionPreflightFiles(files).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const valid = vector.map((entry) => ({ hash: entry.observedSha256, timestamp: timestamps.get(entry.tag) }));
    expect(plan(valid)).toMatchObject({ ok: true });
    expect(valid[0].timestamp).toBe(1783601318727);

    const incomplete = valid.slice(1);
    expect(plan(incomplete)).toMatchObject({ ok: false, code: "MIGRATION_HISTORY_PREFIX_INCOMPLETE" });

    const reordered = valid.map((entry) => ({ ...entry }));
    [reordered[0], reordered[1]] = [reordered[1], reordered[0]];
    expect(plan(reordered)).toMatchObject({ ok: false, code: "MIGRATION_HISTORY_SEQUENCE_INVALID" });

    const wrongHash = valid.map((entry) => ({ ...entry }));
    wrongHash[3] = { ...wrongHash[3], tag: "0003_tranquil_tattoo", hash: "0".repeat(64) };
    expect(plan(wrongHash)).toMatchObject({ ok: false, code: "MIGRATION_HASH_MISMATCH" });

    const wrongTimestamp = valid.map((entry) => ({ ...entry }));
    wrongTimestamp[3] = { ...wrongTimestamp[3], timestamp: 99 };
    expect(plan(wrongTimestamp)).toMatchObject({ ok: false, code: "MIGRATION_TIMESTAMP_MISMATCH" });
  });

  test("accepts a valid original-production prefix followed by canonical suffix files", () => {
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const files = loadMigrationFiles();
    const authority = { environment: "conformance-original", historyVariant: "original-production" };
    const timestamps = new Map(productionPreflightFiles(files).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const applied = vector.map((entry) => ({ hash: entry.observedSha256, timestamp: timestamps.get(entry.tag) }));
    for (const file of productionPreflightFiles(files).filter(({ tag }) => Number(tag.slice(0, 4)) > 17)) {
      applied.push({ tag: file.tag, hash: file.hash, timestamp: file.timestamp });
    }
    expect(buildMigrationPlan({ applied, declared: [], files, authority, history: { manifest: productionManifest }, expectedCount: applied.length, expectedFloor: applied.at(-1).tag })).toMatchObject({ ok: true, applied: files.map(({ tag }) => tag) });
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

      expect(errors).toEqual(["migration verify failed: MIGRATION_FAILED"]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  test("fails the fixed production preflight command before opening a pool when attestation is unconfigured", async () => {
    const errors = [];
    const evidence = [];
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
        writeEvidence: (packet) => evidence.push(packet),
      });
      expect(opened).toBe(false);
      expect(errors).toEqual(["migration verify rejected: PREFLIGHT_ATTESTATION_UNCONFIGURED"]);
      expect(evidence).toHaveLength(1);
      expect(evidence[0]).toMatchObject({ status: "FAIL", code: "PREFLIGHT_ATTESTATION_UNCONFIGURED" });
      expect(JSON.stringify(evidence[0])).not.toContain("secret");
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  test("preserves every production journal row and rejects unknown or repaired hashes before planning", () => {
    const strictFiles = preflightFiles.map((file, index) => index === 0
      ? { ...file, hash: "a".repeat(64), acceptedHashes: ["a".repeat(64)], strictAcceptedHashes: true }
      : { ...file, acceptedHashes: [file.hash], strictAcceptedHashes: true });
    const exactRows = strictFiles.slice(0, 18).map((file) => ({ hash: file.hash, timestamp: file.timestamp }));
    expect(validateProductionHistoryRows(exactRows, strictFiles)).toMatchObject({ ok: true, rows: expect.any(Array) });
    expect(validateProductionHistoryRows([...exactRows.slice(0, 17), { hash: "f".repeat(64), timestamp: 17 }], strictFiles)).toEqual({ ok: false, code: "MIGRATION_HASH_UNKNOWN" });
    expect(validateProductionHistoryRows([{ hash: "0".repeat(64), timestamp: 0 }, ...exactRows.slice(1)], strictFiles)).toEqual({ ok: false, code: "MIGRATION_HASH_UNKNOWN" });
    expect(validateProductionHistoryRows([{ ...exactRows[0], tag: "0099" }, ...exactRows.slice(1)], strictFiles)).toEqual({ ok: false, code: "MIGRATION_TAG_HASH_MISMATCH" });
    expect(validateProductionHistoryRows([...exactRows, { hash: strictFiles[18].hash, timestamp: 18 }], strictFiles)).toEqual({ ok: false, code: "MIGRATION_COUNT_MISMATCH" });

    const realOriginalFiles = productionPreflightFiles(loadMigrationFiles());
    const realOriginalRows = realOriginalFiles.slice(0, 18).map((file) => ({ hash: file.hash, timestamp: file.timestamp }));
    const repaired0000Hash = "d3ac8d18d56871931ad7eeabbbd3468a1237e89647e85fb05be822da5f548cd2";
    expect(validateProductionHistoryRows(realOriginalRows, realOriginalFiles)).toMatchObject({ ok: true });
    expect(validateProductionHistoryRows([{ ...realOriginalRows[0], hash: repaired0000Hash }, ...realOriginalRows.slice(1)], realOriginalFiles)).toEqual({ ok: false, code: "MIGRATION_HASH_UNKNOWN" });
  });

  test("returns a stable redacted code when the read-only transaction cannot roll back", async () => {
    const adapter = {
      query: async (sql) => {
        if (sql === "ROLLBACK;") { const error = new Error("password=secret"); error.code = "08006"; throw error; }
        if (sql.includes("preflight:identity")) return { rows: [snapshot.identity] };
        if (sql.includes("preflight:privileges")) return { rows: privilegeFacts };
        if (sql.includes("preflight:default-acl")) return { rows: [] };
        if (sql.includes("preflight:catalog")) return { rows: [{ catalog_digest: snapshot.catalogDigest }] };
        if (sql.includes("preflight:row-counts")) return { rows: snapshot.aggregateRowCounts };
        if (sql.includes("SELECT hash, created_at AS timestamp FROM drizzle.__drizzle_migrations")) return { rows: preflightFiles.slice(0, 18) };
        if (/^(?:INSERT|UPDATE|DELETE|CREATE TABLE|SELECT nextval)/i.test(sql)) { const error = new Error("secret"); error.code = "25006"; throw error; }
        return { rows: [] };
      },
    };
    const result = await verifyProductionPreflight({
      adapter, files: preflightFiles, expectedFloor: "0017",
      authority: { environment: "production", historyVariant: "original-production" },
      attestation: preflightAttestation, grantContract: preflightContract,
      endpointId: "test-endpoint", runContext: {},
    });
    expect(result).toEqual({ ok: false, code: "PREFLIGHT_READ_ONLY_ROLLBACK_FAILED" });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  test("starts the verifier read-only transaction before catalog reads and redacts setup failure", async () => {
    const calls = [];
    const result = await verifyProductionPreflight({
      adapter: { query: async (sql) => { calls.push(sql); const error = new Error("postgresql://reader:secret@example.invalid"); error.code = "08006"; throw error; } },
      files: preflightFiles, expectedFloor: "0017",
      authority: { environment: "production", historyVariant: "original-production" },
      attestation: preflightAttestation, grantContract: preflightContract,
      endpointId: "test-endpoint", runContext: {},
    });
    expect(calls[0]).toBe("BEGIN READ ONLY;");
    expect(result).toEqual({ ok: false, code: "PREFLIGHT_READ_ONLY_SETUP_FAILED" });
    expect(JSON.stringify(result)).not.toContain("postgresql://");
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

  test("verify rejects a nineteenth adapter row with an unknown hash", async () => {
    const migrationFiles = loadMigrationFiles();
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const timestamps = new Map(productionPreflightFiles(migrationFiles).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const rows = vector.map((entry) => ({ hash: entry.observedSha256, timestamp: timestamps.get(entry.tag) }));
    rows.push({ hash: "0".repeat(64), timestamp: 1785081600000 });

    const result = await verifyMigrations({
      adapter: { query: async () => ({ rows }) },
      files: migrationFiles,
      expectedFloor: "0017",
      expectedCount: 18,
      authority: { environment: "conformance-original", historyVariant: "original-production" },
      history: { manifest: productionManifest },
    });

    expect(result).toMatchObject({ ok: false, code: "MIGRATION_TAG_UNKNOWN" });
  });

  test("rejects a truncated original-production baseline even when its floor matches", async () => {
    const migrationFiles = loadMigrationFiles();
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const timestamps = new Map(productionPreflightFiles(migrationFiles).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const rows = vector.slice(1).map((entry) => ({ hash: entry.observedSha256, timestamp: timestamps.get(entry.tag) }));

    const result = await verifyMigrations({
      adapter: { query: async () => ({ rows }) },
      files: migrationFiles,
      expectedFloor: "0017",
      expectedCount: 18,
      authority: { environment: "conformance-original", historyVariant: "original-production" },
      history: { manifest: productionManifest },
    });
    expect(result).toEqual({ ok: false, code: "MIGRATION_COUNT_MISMATCH" });
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

  test("apply reports the exact migration tag when SQL execution fails", async () => {
    await expect(applyMigrations({
      adapter: {
        query: async (sql) => {
          if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: [{ hash: "h19", timestamp: 19 }] };
          if (sql === "undefined") throw new Error("database detail must stay redacted");
          return { rows: [] };
        },
      },
      applied: ["0019"], files, declared: ["0020"], authority,
    })).rejects.toEqual(new Error("MIGRATION_0020_EXECUTION_FAILED"));
  });

  test("apply maps a controlled catalog assertion to a redacted tagged category", async () => {
    await expect(applyMigrations({
      adapter: {
        query: async (sql) => {
          if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: [{ hash: "h19", timestamp: 19 }] };
          if (sql === "undefined") {
            throw Object.assign(new Error("catalog mismatch: column public.secret_table.secret_column"), { code: "P0001" });
          }
          return { rows: [] };
        },
      },
      applied: ["0019"], files, declared: ["0020"], authority,
    })).rejects.toEqual(new Error("MIGRATION_0020_CATALOG_COLUMN_MISMATCH"));
  });

  test("apply distinguishes a tagged history-write failure from SQL execution", async () => {
    await expect(applyMigrations({
      adapter: {
        query: async (sql) => {
          if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: [{ hash: "h19", timestamp: 19 }] };
          if (sql.startsWith("INSERT INTO drizzle.__drizzle_migrations")) throw new Error("database detail must stay redacted");
          return { rows: [] };
        },
      },
      applied: ["0019"], files, declared: ["0020"], authority,
    })).rejects.toEqual(new Error("MIGRATION_0020_HISTORY_WRITE_FAILED"));
  });

  test("locked apply rejects a nineteenth reread row with an unknown hash", async () => {
    const migrationFiles = loadMigrationFiles();
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const timestamps = new Map(productionPreflightFiles(migrationFiles).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const applied = vector.map((entry) => ({ hash: entry.observedSha256, timestamp: timestamps.get(entry.tag) }));
    const reread = [...applied, { hash: "0".repeat(64), timestamp: 1785081600000 }];
    const pending = migrationFiles.find(({ tag }) => tag.startsWith("0018_"));
    const calls = [];

    await expect(applyMigrations({
      adapter: {
        query: async (sql) => {
          calls.push(sql);
          if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: reread };
          return { rows: [] };
        },
      },
      applied,
      files: migrationFiles,
      declared: [pending.tag],
      authority: { environment: "conformance-original", historyVariant: "original-production" },
      history: { manifest: productionManifest },
    })).rejects.toThrow("MIGRATION_TOCTOU");
    expect(calls).toContain("ROLLBACK;");
    expect(calls).not.toContain(pending.sql);
  });

  test("preserves observed original-production hashes in applied evidence", async () => {
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const migrationFiles = loadMigrationFiles();
    const timestamps = new Map(productionPreflightFiles(migrationFiles).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const originalApplied = vector.map((entry) => ({ hash: entry.observedSha256, timestamp: timestamps.get(entry.tag) }));
    const pendingTag = migrationFiles.find(({ timestamp }) => timestamp === 18).tag;
    const result = await applyMigrations({
      adapter: {
        query: async (sql) => {
          if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: originalApplied };
          return { rows: [] };
        },
      },
      applied: originalApplied,
      files: migrationFiles,
      declared: [pendingTag],
      authority: { environment: "conformance-original", historyVariant: "original-production" },
      history: { manifest: productionManifest },
    });
    expect(result).toMatchObject({ ok: true, status: "APPLIED" });
    expect(result.applied.find(({ tag }) => tag === "0000_stale_jamie_braddock")?.hash).toBe(vector[0].observedSha256);
    expect(result.applied.find(({ tag }) => tag === "0004_minor_lockheed")?.hash).toBe(vector[4].observedSha256);
    expect(result.applied.find(({ tag }) => tag === "0000_stale_jamie_braddock")?.timestamp).toBe(1783601318727);
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
  ])("provisions roles before applying the canonical suffix then verifies NOOP for %s", async (_label, variantAuthority) => {
    const calls = [];
    const original = variantAuthority.historyVariant === "original-production";
    const migrationFiles = loadMigrationFiles();
    const vector = productionManifest.drizzle.historyVectors["original-production"].entries;
    const timestamps = new Map(productionPreflightFiles(migrationFiles).map((file) => [file.tag.slice(0, 4), file.timestamp]));
    const originalHistory = vector.map((entry) => ({
      hash: entry.observedSha256,
      timestamp: timestamps.get(entry.tag),
    }));
    const variantFiles = original ? migrationFiles : files;
    const appliedFloor = original ? "0017" : "0019";
    const declared = original
      ? variantFiles.filter((file) => Number(file.tag.slice(0, 4)) > 17).map((file) => file.tag)
      : ["0020"];
    const journalRows = original
      ? originalHistory.map(({ hash, timestamp }) => ({ hash, timestamp }))
      : [{ hash: "h19", timestamp: 19 }];
    const adapter = {
      query: async (sql, params) => {
        calls.push(sql);
        if (sql.includes("current_user AS rolname")) return { rows: [{ rolname: "neondb_owner", rolcanlogin: true, rolsuper: true, rolcreaterole: true, rolcreatedb: true }] };
        if (sql.includes("FROM drizzle.__drizzle_migrations")) return { rows: journalRows.map((row) => ({ ...row })) };
        if (sql.startsWith("INSERT INTO drizzle.__drizzle_migrations") && params?.length === 2) {
          journalRows.push({ hash: params[0], timestamp: params[1] });
          return { rows: [] };
        }
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
      applied: original ? originalHistory : [appliedFloor],
      files: variantFiles,
      declared,
      authority: variantAuthority,
      ...(original ? { history: { manifest: productionManifest } } : {}),
    });
    const noop = await verifyMigrations({
      adapter,
      applied: original ? applied.applied : ["0019", "0020"],
      files: variantFiles,
      declared: [],
      expectedFloor: "0020",
      authority: variantAuthority,
      ...(original ? { history: { manifest: productionManifest } } : {}),
    });

    expect(provisioned.ok).toBe(true);
    expect(applied).toMatchObject({ ok: true, status: "APPLIED", historyVariant: variantAuthority.historyVariant });
    expect(noop).toMatchObject({ ok: true, status: "NOOP" });
    expect(applied.applied.map((entry) => entry.tag)).toEqual(
      (original ? variantFiles : [{ tag: "0019" }, { tag: "0020" }]).map((entry) => entry.tag),
    );
    expect(calls.findIndex((sql) => sql.includes("product-suite:database-roles"))).toBeLessThan(
      calls.findIndex((sql) => sql.includes("product-suite:database-migrations")),
    );
  });
});
