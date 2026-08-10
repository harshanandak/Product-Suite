#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import authorityContract from "../config/database-authority.json" with { type: "json" };
import productionPreflightGrantContract from "../config/neon-production-preflight-grants.json" with { type: "json" };
import { parseNeonUrl } from "./check-database-authority.mjs";
import { createDatabasePool } from "./database-pool.mjs";
import { createMigrationEvidence } from "./migration-evidence.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_ROOT = join(SCRIPT_DIR, "..", "packages", "db", "migrations");
export const HISTORY_VARIANTS = Object.freeze(["original-production", "repaired-bootstrap"]);
export const ENVIRONMENT_HISTORY_PINS = Object.freeze(authorityContract.environmentHistoryPins);

function canonicalHash(value) {
  return createHash("sha256").update(String(value).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function grantContractDigest(contract = productionPreflightGrantContract) {
  return createHash("sha256").update(JSON.stringify(canonicalize(contract)), "utf8").digest("hex");
}

function redactError(error) {
  const code = error?.code || (typeof error?.message === "string" && error.message.startsWith("MIGRATION_") ? error.message : "MIGRATION_FAILED");
  return new Error(code);
}

function tagNumber(tag) {
  const match = /^(\d+)/.exec(String(tag));
  return match ? Number(match[1]) : Number.NaN;
}

function normalizeTag(value) {
  if (typeof value === "string") return value;
  return value?.tag ?? value?.name;
}

function migrationFloorMatches(actualTag, expectedFloor) {
  const actualPrefix = /^(\d+)/.exec(String(actualTag))?.[1];
  const expectedPrefix = /^(\d+)/.exec(String(expectedFloor))?.[1];
  return actualPrefix !== undefined && expectedPrefix !== undefined && Number(actualPrefix) === Number(expectedPrefix);
}

export function loadMigrationFiles(root = MIGRATIONS_ROOT) {
  return readdirSync(root)
    .filter((name) => name.endsWith(".sql"))
    .map((name) => {
      const tag = name.slice(0, -4);
      const sql = readFileSync(join(root, name), "utf8");
      return { tag, file: name, sql, hash: canonicalHash(sql), timestamp: tagNumber(tag) };
    })
    .sort((left, right) => (left.timestamp - right.timestamp) || left.tag.localeCompare(right.tag));
}

function expectedVariant(authority = {}) {
  const environment = authority.environment ?? authority.env;
  const declared = authority.historyVariant ?? authority.history_variant;
  const pinned = ENVIRONMENT_HISTORY_PINS[environment];
  if (!pinned) throw new Error("MIGRATION_ENVIRONMENT_UNDECLARED");
  if (declared !== pinned) throw new Error("MIGRATION_HISTORY_VARIANT_MISMATCH");
  return { environment, historyVariant: pinned };
}

function normalizedFiles(files) {
  const values = (files ?? []).map((file) => typeof file === "string" ? { tag: file, timestamp: tagNumber(file) } : file).filter((file) => file?.tag);
  return values.sort((left, right) => (tagNumber(left.tag) - tagNumber(right.tag)) || left.tag.localeCompare(right.tag));
}

function normalizedApplied(applied) {
  return (applied ?? []).map((entry) => typeof entry === "string" ? { tag: entry } : entry).filter((entry) => entry?.tag);
}

function contiguous(tags) {
  for (let index = 1; index < tags.length; index += 1) {
    if (tagNumber(tags[index]) !== tagNumber(tags[index - 1]) + 1) return false;
  }
  return true;
}

function compareHashes(applied, files) {
  const byTag = new Map(files.map((file) => [file.tag, file]));
  for (const entry of applied) {
    const expected = byTag.get(entry.tag);
    if (!expected) return "MIGRATION_TAG_UNKNOWN";
    const acceptedHashes = new Set([expected.hash, ...(expected.acceptedHashes ?? [])].filter(Boolean));
    if (entry.hash && acceptedHashes.size > 0 && !acceptedHashes.has(entry.hash)) return "MIGRATION_HASH_MISMATCH";
    if (entry.timestamp !== undefined && expected.timestamp !== undefined && Number(entry.timestamp) !== Number(expected.timestamp)) return "MIGRATION_TIMESTAMP_MISMATCH";
  }
  return null;
}

function compareDeclaredHashes(hashes, files) {
  if (!hashes || typeof hashes !== "object") return null;
  const byTag = new Map(files.map((file) => [file.tag, file]));
  for (const [tag, hash] of Object.entries(hashes)) {
    const file = byTag.get(tag);
    if (!file) continue;
    if (hash && file.hash && hash !== file.hash) return "MIGRATION_HASH_MISMATCH";
  }
  return null;
}

function classifyHistoryHashes(hashes = {}) {
  const values = ["0000_stale_jamie_braddock.sql", "0004_minor_lockheed.sql"].map((file) => hashes[file]).filter((value) => value !== undefined);
  if (values.length === 0) return null;
  const variants = values.map((value) => {
    const text = String(value).toLowerCase();
    if (text === "original" || text.startsWith("original-") || text.includes("original")) return "original-production";
    if (text === "repaired" || text.startsWith("repaired-") || text.includes("repaired")) return "repaired-bootstrap";
    return null;
  });
  if (variants.some((variant) => !variant)) return "unknown";
  return new Set(variants).size === 1 ? variants[0] : "mixed";
}

function pendingFor(applied, declared, files) {
  const known = new Set(files.map((file) => file.tag));
  const appliedTags = applied.map((entry) => entry.tag);
  const declaredTags = declared.map((entry) => normalizeTag(entry));
  if (new Set(appliedTags).size !== appliedTags.length || new Set(declaredTags).size !== declaredTags.length) return "MIGRATION_DUPLICATE_TAG";
  if (appliedTags.some((tag) => !known.has(tag)) || declaredTags.some((tag) => !known.has(tag))) return "MIGRATION_TAG_UNKNOWN";
  if (!contiguous(appliedTags) || !contiguous(declaredTags)) return "MIGRATION_SEQUENCE_INVALID";
  const lastApplied = applied.length ? tagNumber(applied.at(-1).tag) : -1;
  const expected = files.filter((file) => tagNumber(file.tag) > lastApplied).map((file) => file.tag).slice(0, declaredTags.length);
  if (declaredTags.some((tag, index) => tag !== expected[index])) return "MIGRATION_SUFFIX_NOT_CONTIGUOUS";
  return null;
}

function isProductionP0Allowed(environment, applied, declared) {
  if (environment !== "production") return true;
  const appliedLast = applied.length ? applied.at(-1).tag : null;
  const pending = declared.map((entry) => normalizeTag(entry));
  return (appliedLast === "0017" && pending.join(",") === "0018,0019") || (appliedLast === "0018" && pending.join(",") === "0019");
}

/** Build a plan without opening a database connection. */
export function buildMigrationPlan({ applied = [], declared = [], files = [], authority = {}, expectedCount, expectedFloor, observedVariant, hashes, history } = {}) {
  let pinned;
  try { pinned = expectedVariant(authority); } catch (error) { return { ok: false, code: error.message }; }
  const inferredVariant = observedVariant ?? history?.variant ?? classifyHistoryHashes(hashes);
  if (inferredVariant === "mixed") return { ok: false, code: "MIGRATION_HISTORY_VARIANT_MIXED" };
  if (inferredVariant === "unknown") return { ok: false, code: "MIGRATION_HISTORY_VARIANT_UNKNOWN" };
  if (!HISTORY_VARIANTS.includes(inferredVariant ?? pinned.historyVariant)) return { ok: false, code: "MIGRATION_HISTORY_VARIANT_UNKNOWN" };
  if (inferredVariant && inferredVariant !== pinned.historyVariant) return { ok: false, code: "MIGRATION_HISTORY_VARIANT_MISMATCH" };

  const normalizedFileList = normalizedFiles(files);
  const normalizedAppliedList = normalizedApplied(applied);
  const normalizedDeclared = normalizedApplied(declared);
  const hashIssue = compareHashes(normalizedAppliedList, normalizedFileList);
  if (hashIssue) return { ok: false, code: hashIssue };
  const declaredHashIssue = compareDeclaredHashes(hashes, normalizedFileList);
  if (declaredHashIssue) return { ok: false, code: declaredHashIssue };
  if (expectedFloor && !migrationFloorMatches(normalizedAppliedList.at(-1)?.tag, expectedFloor)) return { ok: false, code: "MIGRATION_FLOOR_MISMATCH" };
  if (expectedCount !== undefined && normalizedAppliedList.length !== expectedCount) return { ok: false, code: "MIGRATION_COUNT_MISMATCH" };
  const suffixIssue = pendingFor(normalizedAppliedList, normalizedDeclared, normalizedFileList);
  if (suffixIssue) return { ok: false, code: suffixIssue };
  if (!isProductionP0Allowed(pinned.environment, normalizedAppliedList, normalizedDeclared)) return { ok: false, code: "MIGRATION_P0_SUFFIX_FORBIDDEN" };
  return {
    ok: true,
    environment: pinned.environment,
    historyVariant: pinned.historyVariant,
    applied: normalizedAppliedList.map((entry) => entry.tag),
    pending: normalizedDeclared.map((entry) => entry.tag),
    files: normalizedFileList,
  };
}

function migrationRows(rows, files = []) {
  const byHash = new Map(files.filter((file) => file.hash).map((file) => [file.hash, file.tag]));
  return (rows ?? []).map((row) => ({
    tag: row.tag ?? row.name ?? row.migration_tag ?? byHash.get(row.hash),
    hash: row.hash ?? row.hash_value,
    timestamp: row.timestamp ?? row.created_at ?? row.when,
  })).filter((row) => row.tag);
}

async function query(adapter, sql, params) {
  try { return await adapter.query(sql, params); } catch (error) { throw redactError(error); }
}

function lockSql() {
  return "SELECT pg_advisory_xact_lock(hashtext('product-suite:database-migrations'));";
}

// Migration files are Drizzle artifacts and some contain their own BEGIN /
// COMMIT markers.  The guarded runner owns the single transaction (and its
// advisory lock), so strip only those outer markers before sending SQL.
function runnableSql(sql) {
  const withoutBegin = String(sql).replace(/^\s*BEGIN;\s*/i, "");
  const trimmed = withoutBegin.trimEnd();
  const withoutCommit = trimmed.toUpperCase().endsWith("COMMIT;")
    ? trimmed.slice(0, -"COMMIT;".length).trimEnd()
    : withoutBegin;
  return withoutCommit.replace(/^[ \t]*-->[ \t]*statement-breakpoint[ \t]*\r?$/gim, ";");
}

const HISTORY_SQL = "SELECT hash, created_at AS timestamp FROM drizzle.__drizzle_migrations ORDER BY created_at, id;";

const SAFE_PROBE_CODES = new Set(["25006", "42501"]);

function fail(code) { return { ok: false, code }; }

function normalizeIdentity(row = {}) {
  return {
    database: row.database ?? row.database_name,
    schema: row.schema ?? row.schema_name,
    loginIdentifier: row.loginIdentifier ?? row.login_identifier,
    canLogin: row.canLogin ?? row.can_login,
    superuser: row.superuser,
    createDatabase: row.createDatabase ?? row.create_database,
    createRole: row.createRole ?? row.create_role,
    replication: row.replication,
    bypassRls: row.bypassRls ?? row.bypass_rls,
    temporary: row.temporary,
  };
}

function normalizeFact(row = {}) {
  return {
    source: row.source,
    objectKind: row.objectKind ?? row.object_kind,
    objectName: row.objectName ?? row.object_name,
    privilege: row.privilege,
    granted: row.granted,
  };
}

function sameFacts(actual, expected) {
  const sort = (facts) => facts.map(normalizeFact).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return JSON.stringify(sort(actual)) === JSON.stringify(sort(expected));
}

export function validatePreflightSnapshot({ snapshot = {}, attestation = {}, grantContract = productionPreflightGrantContract, expectedEndpointId } = {}) {
  const identity = normalizeIdentity(snapshot.identity);
  if (expectedEndpointId !== attestation.target?.endpointId) return fail("PREFLIGHT_ENDPOINT_MISMATCH");
  if (identity.database !== attestation.target?.database || identity.schema !== attestation.target?.schema) return fail("PREFLIGHT_TARGET_MISMATCH");
  if (identity.loginIdentifier !== attestation.role?.loginIdentifier) return fail("PREFLIGHT_LOGIN_MISMATCH");
  if (attestation.role?.grantContract !== grantContract.name || attestation.role?.grantContractSha256 !== grantContractDigest(grantContract)) return fail("PREFLIGHT_GRANT_CONTRACT_MISMATCH");
  if (identity.canLogin !== true || [identity.superuser, identity.createDatabase, identity.createRole, identity.replication, identity.bypassRls, identity.temporary].some((value) => value !== false)) return fail("PREFLIGHT_ROLE_ADMIN");
  const expectedFacts = [...(grantContract.positivePrivileges ?? []), ...(grantContract.negativePrivileges ?? [])];
  const actualFacts = snapshot.privilegeFacts ?? [];
  if (actualFacts.some((fact) => fact.granted && (grantContract.negativePrivileges ?? []).some((expected) => sameFacts([fact], [{ ...expected, granted: fact.granted }])))) return fail("PREFLIGHT_WRITE_PRIVILEGE");
  if (!sameFacts(actualFacts, expectedFacts)) return fail("PREFLIGHT_PRIVILEGE_PROOF_INCOMPLETE");
  if (!Array.isArray(snapshot.defaultAclWritePaths)) return fail("PREFLIGHT_DEFAULT_ACL_UNPROVEN");
  if (snapshot.defaultAclWritePaths.length > 0) return fail("PREFLIGHT_DEFAULT_ACL_WRITE");
  const expectedProbes = ["autocommit", "transaction"].flatMap((mode) => (grantContract.denialProbes ?? []).map((operation) => `${mode}:${operation}`)).sort();
  const actualProbes = (snapshot.denialProbes ?? []).map((probe) => `${probe.mode}:${probe.operation}`).sort();
  if (JSON.stringify(actualProbes) !== JSON.stringify(expectedProbes)) return fail("PREFLIGHT_DENIAL_PROBE_INCOMPLETE");
  if ((snapshot.denialProbes ?? []).some((probe) => !SAFE_PROBE_CODES.has(probe.code))) return fail("PREFLIGHT_DENIAL_PROBE_SUCCEEDED");
  if (!/^[a-f0-9]{64}$/i.test(snapshot.catalogDigest ?? "") || snapshot.catalogDigest !== attestation.catalog?.catalogSha256) return fail("PREFLIGHT_CATALOG_MISMATCH");
  const metrics = (snapshot.aggregateRowCounts ?? []).map((entry) => entry.metric).sort();
  if (JSON.stringify(metrics) !== JSON.stringify([...(grantContract.rowCountMetrics ?? [])].sort())) return fail("PREFLIGHT_ROW_COUNT_CONTRACT_MISMATCH");
  return {
    ok: true,
    loginIdentifier: identity.loginIdentifier,
    catalogDigest: snapshot.catalogDigest,
    grantDigest: canonicalHash(canonicalize({ privilegeFacts: actualFacts, defaultAclWritePaths: snapshot.defaultAclWritePaths })),
    aggregateRowCounts: snapshot.aggregateRowCounts,
  };
}

const IDENTITY_SQL = `/* preflight:identity */
SELECT current_database() AS database_name, current_schema() AS schema_name,
       current_user AS login_identifier, r.rolcanlogin AS can_login,
       r.rolsuper AS superuser, r.rolcreatedb AS create_database,
       r.rolcreaterole AS create_role, r.rolreplication AS replication,
       r.rolbypassrls AS bypass_rls,
       has_database_privilege(current_user, current_database(), 'TEMPORARY') AS temporary
FROM pg_roles r WHERE r.rolname = current_user;`;

const PRIVILEGE_SQL = `/* preflight:privileges */
WITH RECURSIVE expected AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb)
    AS x(source text, "objectKind" text, "objectName" text, privilege text, granted boolean)
), inherited_roles AS (
  SELECT r.oid, r.rolname FROM pg_roles r WHERE r.rolname = current_user
  UNION
  SELECT parent.oid, parent.rolname FROM pg_auth_members membership
  JOIN inherited_roles member ON member.oid = membership.member
  JOIN pg_roles parent ON parent.oid = membership.roleid
), acl_facts AS (
  SELECT CASE WHEN c.relkind = 'S' THEN 'sequence' ELSE 'table' END AS object_kind, n.nspname || '.' || c.relname AS object_name,
         acl.grantee, acl.privilege_type AS privilege
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault(CASE WHEN c.relkind = 'S' THEN 'S'::"char" ELSE 'r'::"char" END, c.relowner))) acl
  WHERE c.relkind IN ('r','p','S')
  UNION ALL
  SELECT 'schema', n.nspname, acl.grantee, acl.privilege_type
  FROM pg_namespace n CROSS JOIN LATERAL aclexplode(coalesce(n.nspacl, acldefault('n', n.nspowner))) acl
  UNION ALL
  SELECT 'database', d.datname, acl.grantee, acl.privilege_type
  FROM pg_database d CROSS JOIN LATERAL aclexplode(coalesce(d.datacl, acldefault('d', d.datdba))) acl
)
SELECT e.source, e."objectKind" AS object_kind, e."objectName" AS object_name, e.privilege,
  CASE
    WHEN e.source = 'effective' AND e."objectKind" = 'database' THEN has_database_privilege(current_user, e."objectName", e.privilege)
    WHEN e.source = 'effective' AND e."objectKind" = 'schema' THEN has_schema_privilege(current_user, e."objectName", e.privilege)
    WHEN e.source = 'effective' AND e."objectKind" = 'table' THEN has_table_privilege(current_user, e."objectName", e.privilege)
    WHEN e.source = 'effective' AND e."objectKind" = 'sequence' THEN has_sequence_privilege(current_user, e."objectName", e.privilege)
    WHEN e.source = 'PUBLIC' THEN EXISTS (SELECT 1 FROM acl_facts a WHERE a.object_kind=e."objectKind" AND a.object_name=e."objectName" AND a.privilege=e.privilege AND a.grantee=0)
    WHEN e.source = 'direct' THEN EXISTS (SELECT 1 FROM acl_facts a JOIN pg_roles r ON r.oid=a.grantee WHERE r.rolname=current_user AND a.object_kind=e."objectKind" AND a.object_name=e."objectName" AND a.privilege=e.privilege)
    WHEN e.source = 'inherited' THEN EXISTS (SELECT 1 FROM acl_facts a JOIN inherited_roles r ON r.oid=a.grantee WHERE r.rolname<>current_user AND a.object_kind=e."objectKind" AND a.object_name=e."objectName" AND a.privilege=e.privilege)
    WHEN e.source = 'built-in-default-role' THEN EXISTS (SELECT 1 FROM pg_roles r WHERE r.rolname IN ('pg_database_owner','pg_read_all_data','pg_write_all_data') AND pg_has_role(current_user, r.rolname, 'MEMBER'))
    WHEN e.source = 'default-acl' THEN false
    ELSE true
  END AS granted
FROM expected e;`;

const DEFAULT_ACL_SQL = `/* preflight:default-acl */
SELECT defaclrole::regrole::text AS subject, privilege_type AS privilege
FROM pg_default_acl CROSS JOIN LATERAL aclexplode(defaclacl)
WHERE privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','SELECT');`;
const CATALOG_SQL = `/* preflight:catalog */ SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind AS object_kind, pg_get_userbyid(c.relowner) AS owner_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname, c.relname, c.relkind;`;
const ROW_COUNTS_SQL = `/* preflight:row-counts */ SELECT 'drizzle_migration_rows' AS metric, count(*)::bigint::text::int AS count FROM drizzle.__drizzle_migrations;`;

const PROBE_SQL = Object.freeze({
  INSERT: "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT repeat('0', 64), 0 WHERE false;",
  UPDATE: "UPDATE drizzle.__drizzle_migrations SET hash = hash WHERE false;",
  DELETE: "DELETE FROM drizzle.__drizzle_migrations WHERE false;",
  DDL: "CREATE TABLE public.__product_suite_preflight_forbidden (id integer);",
  nextval: "SELECT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);",
});

async function runDenialProbes(client, operations) {
  const results = [];
  await client.query("SET default_transaction_read_only = on;");
  for (const operation of operations) {
    try { await client.query(PROBE_SQL[operation]); results.push({ mode: "autocommit", operation, code: null }); }
    catch (error) { results.push({ mode: "autocommit", operation, code: error?.code ?? null }); }
  }
  for (const operation of operations) {
    await client.query("BEGIN READ ONLY;");
    try { await client.query(PROBE_SQL[operation]); results.push({ mode: "transaction", operation, code: null }); }
    catch (error) { results.push({ mode: "transaction", operation, code: error?.code ?? null }); }
    finally { await client.query("ROLLBACK;"); }
  }
  return results;
}

async function collectPreflightSnapshot(client, contract) {
  const identity = await client.query(IDENTITY_SQL);
  const expectedFacts = [...(contract.positivePrivileges ?? []), ...(contract.negativePrivileges ?? [])];
  const privileges = await client.query(PRIVILEGE_SQL, [JSON.stringify(expectedFacts)]);
  const defaultAcl = await client.query(DEFAULT_ACL_SQL);
  const denialProbes = await runDenialProbes(client, contract.denialProbes ?? []);
  const catalog = await client.query(CATALOG_SQL);
  const rowCounts = await client.query(ROW_COUNTS_SQL);
  return {
    identity: normalizeIdentity(identity?.rows?.[0]),
    privilegeFacts: (privileges?.rows ?? []).map(normalizeFact),
    defaultAclWritePaths: defaultAcl?.rows ?? [],
    denialProbes,
    catalogDigest: catalog?.rows?.[0]?.catalog_digest ?? canonicalHash(canonicalize(catalog?.rows ?? [])),
    aggregateRowCounts: (rowCounts?.rows ?? []).map((entry) => ({ metric: entry.metric, count: Number(entry.count) })),
  };
}

export async function verifyProductionPreflight({ adapter, files = loadMigrationFiles(), expectedFloor, authority, attestation, grantContract = productionPreflightGrantContract, endpointId, runContext = {} } = {}) {
  if (authority?.environment !== "production" || authority?.historyVariant !== "original-production" || expectedFloor !== "0017") return fail("PREFLIGHT_HISTORY_CONTRACT_MISMATCH");
  if (!adapter?.query && !adapter?.connect) return fail("PREFLIGHT_DATABASE_UNAVAILABLE");
  const client = adapter.connect ? await adapter.connect() : adapter;
  try {
    const snapshot = await collectPreflightSnapshot(client, grantContract);
    const validated = validatePreflightSnapshot({ snapshot, attestation, grantContract, expectedEndpointId: endpointId });
    if (!validated.ok) return validated;
    const history = await query(client, HISTORY_SQL);
    const rows = migrationRows(history?.rows, files);
    const pendingFiles = files.filter((file) => tagNumber(file.tag) > 17);
    const plan = buildMigrationPlan({ applied: rows, declared: pendingFiles, files, expectedCount: 18, expectedFloor, authority, observedVariant: "original-production" });
    if (!plan.ok) return plan;
    if (plan.pending.join(",") !== "0018,0019") return fail("PREFLIGHT_PENDING_SUFFIX_MISMATCH");
    return createMigrationEvidence({
      schemaVersion: "neon-production-preflight-evidence.v1",
      operation: "verify", status: "PREFLIGHT_READY", reasonCodes: ["PREFLIGHT_READY"],
      historyVariant: plan.historyVariant, expectedFloor, expectedCount: 18,
      repository: runContext.repository, runId: runContext.runId, runSha: runContext.runSha,
      endpointId, loginIdentifier: validated.loginIdentifier,
      grantContract: grantContract.name, grantContractSha256: grantContractDigest(grantContract),
      catalogDigest: validated.catalogDigest, grantDigest: validated.grantDigest,
      aggregateRowCounts: validated.aggregateRowCounts,
      applied: rows.map((entry) => ({ tag: entry.tag, timestamp: Number(entry.timestamp), hash: entry.hash })),
      pending: pendingFiles.map((entry) => ({ tag: entry.tag, hash: entry.hash })),
    });
  } finally {
    client.release?.();
  }
}

/** Apply only an exact, caller-declared contiguous suffix under one lock. */
export async function applyMigrations({ adapter, applied = [], declared = [], files = loadMigrationFiles(), authority, observedVariant, hashes, history, expectedCount, expectedFloor } = {}) {
  if (declared.length === 0) return { ok: false, code: "MIGRATION_PENDING_REQUIRED" };
  const plan = buildMigrationPlan({ applied, declared, files, authority, observedVariant, hashes, history, expectedCount, expectedFloor });
  if (!plan.ok) return plan;
  if (!adapter || typeof adapter.query !== "function") return { ...plan, status: "PLANNED" };
  const byTag = new Map(files.map((file) => [file.tag, file]));
  await query(adapter, "BEGIN;");
  try {
    await query(adapter, lockSql());
    const reread = await query(adapter, HISTORY_SQL);
    const rereadRows = migrationRows(reread?.rows, files);
    // An empty re-read is also a TOCTOU change: trusting it would allow a
    // caller's stale `applied` list to authorize a suffix on a fresh/changed
    // database.  Always rebuild and compare the observed plan under the lock.
    const rereadPlan = buildMigrationPlan({ applied: rereadRows, declared, files, authority, observedVariant, hashes, history });
    if (!rereadPlan.ok || rereadPlan.applied.join(",") !== plan.applied.join(",")) throw new Error("MIGRATION_TOCTOU");
    for (const tag of plan.pending) {
      const file = byTag.get(tag);
      if (!file) throw new Error("MIGRATION_TAG_UNKNOWN");
      await query(adapter, runnableSql(file.sql));
      await query(adapter, "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2);", [file.hash, file.timestamp]);
    }
    await query(adapter, "COMMIT;");
  } catch (error) {
    try { await query(adapter, "ROLLBACK;"); } catch { /* retain root failure */ }
    throw redactError(error);
  }
  const records = plan.pending.map((tag) => {
    const file = byTag.get(tag);
    return { tag: file.tag, timestamp: file.timestamp, hash: file.hash };
  });
  return createMigrationEvidence({ operation: "apply", status: "APPLIED", historyVariant: plan.historyVariant, expectedCount: plan.applied.length + records.length, applied: [...plan.applied.map((tag) => ({ tag, timestamp: tagNumber(tag), hash: byTag.get(tag)?.hash ?? "" })), ...records] });
}

/** Verify a recognized floor with no pending work.  This function never writes. */
export async function verifyMigrations({ adapter, applied = [], declared = [], files = loadMigrationFiles(), expectedFloor, authority, observedVariant, hashes, history, expectedCount } = {}) {
  let rows = normalizedApplied(applied);
  if (rows.length === 0 && adapter?.query && !declared.length) {
    const result = await query(adapter, HISTORY_SQL);
    rows = migrationRows(result?.rows, files);
  }
  const plan = buildMigrationPlan({ applied: rows, declared, files, authority, observedVariant, hashes, history, expectedCount, expectedFloor });
  if (!plan.ok) return plan;
  if (plan.pending.length > 0) return { ok: false, code: "MIGRATION_PENDING" };
  return createMigrationEvidence({ operation: "verify", status: "NOOP", historyVariant: plan.historyVariant, expectedFloor, expectedCount: rows.length, applied: rows.map((entry) => ({ tag: entry.tag, timestamp: Number(entry.timestamp ?? tagNumber(entry.tag)), hash: entry.hash ?? files.find((file) => file.tag === entry.tag)?.hash ?? "" })) });
}

/** Empty PostgreSQL 17 + pgvector bootstrap gate. */
export async function bootstrapMigrations({ adapter, files = loadMigrationFiles(), declared = files.map((file) => file.tag), authority, serverVersionNum, extensions = ["vector"], applied = [], catalogCount = 0 } = {}) {
  let pinned;
  try { pinned = expectedVariant(authority); } catch (error) { return { ok: false, code: error.message }; }
  if (pinned.historyVariant !== "repaired-bootstrap") return { ok: false, code: "MIGRATION_BOOTSTRAP_VARIANT_REQUIRED" };
  if (serverVersionNum !== undefined && Number(serverVersionNum) < 170000) return { ok: false, code: "POSTGRESQL_17_REQUIRED" };
  if (!extensions.map(String).map((value) => value.toLowerCase()).includes("vector")) return { ok: false, code: "PGVECTOR_REQUIRED" };
  if (catalogCount !== 0 || applied.length !== 0) return { ok: false, code: "BOOTSTRAP_TARGET_NOT_EMPTY" };
  const allTags = files.map((file) => file.tag);
  if (declared.length !== allTags.length || declared.some((tag, index) => normalizeTag(tag) !== allTags[index])) return { ok: false, code: "BOOTSTRAP_PENDING_SET_INVALID" };
  const plan = buildMigrationPlan({ applied: [], declared, files, authority });
  if (!plan.ok) return plan;
  if (!adapter?.query) return createMigrationEvidence({ operation: "bootstrap", status: "BOOTSTRAPPED", historyVariant: plan.historyVariant, expectedCount: plan.pending.length, applied: plan.pending.map((tag) => ({ tag, timestamp: tagNumber(tag), hash: files.find((file) => file.tag === tag)?.hash ?? "" })) });
  const version = await query(adapter, "SHOW server_version_num;");
  const versionValue = Number(version?.rows?.[0]?.server_version_num ?? version?.rows?.[0]?.server_version ?? 0);
  if (versionValue && versionValue < 170000) return { ok: false, code: "POSTGRESQL_17_REQUIRED" };
  const vector = await query(adapter, "SELECT name FROM pg_available_extensions WHERE name = 'vector';");
  if (!(vector?.rows?.length > 0)) return { ok: false, code: "PGVECTOR_REQUIRED" };
  await query(adapter, "CREATE SCHEMA IF NOT EXISTS drizzle;");
  await query(adapter, "CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint NOT NULL);");
  const empty = await query(adapter, "SELECT (SELECT count(*) FROM drizzle.__drizzle_migrations) AS migration_count;");
  if (Number(empty?.rows?.[0]?.migration_count ?? 0) !== 0) return { ok: false, code: "BOOTSTRAP_TARGET_NOT_EMPTY" };
  const result = await applyMigrations({ adapter, applied: [], declared, files, authority, observedVariant: "repaired-bootstrap" });
  if (!result.ok) return result;
  return createMigrationEvidence({
    operation: "bootstrap",
    status: "BOOTSTRAPPED",
    historyVariant: result.historyVariant,
    expectedCount: files.length,
    applied: result.applied,
  });
}

export const bootstrap = bootstrapMigrations;
export const apply = applyMigrations;
export const verify = verifyMigrations;

function parseArgs(args) {
  const options = { declared: [] };
  const operations = new Set(["bootstrap", "apply", "verify"]);
  options.operation = operations.has(args[0]) ? args[0] : null;
  for (let index = 1; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument.startsWith("--")) return null;
    const key = argument.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = args[++index];
    if (value === undefined) return null;
    if (key === "expectedPending") options.declared.push(...value.split(",").filter(Boolean));
    else options[key] = value;
  }
  return options;
}

export async function runMigrationCli({
  args = process.argv.slice(2),
  databaseUrl = process.env.MIGRATION_DATABASE_URL,
  poolFactory = createDatabasePool,
  writeError = (message) => console.error(message),
  writeOutput = (message) => console.log(message),
} = {}) {
  const options = parseArgs(args);
  if (!options?.operation || !options.historyVariant || !options.environment) {
    writeError("usage: bun run migrate:database -- <bootstrap|apply|verify> --environment <environment> --history-variant <variant> [--expected-pending <tags>] [--expected-floor <tag>]");
    process.exitCode = 1;
    return;
  }
  const url = databaseUrl;
  if (!url) { writeError("MIGRATION_DATABASE_URL is required"); process.exitCode = 1; return; }
  if (options.environment === "production") parseNeonUrl(url, "migration");
  let pool;
  try {
    pool = await poolFactory({ databaseUrl: url, environment: options.environment });
    const files = loadMigrationFiles();
    const authority = { environment: options.environment, historyVariant: options.historyVariant };
    let result;
    if (options.operation === "bootstrap") result = await bootstrapMigrations({ adapter: pool, files, declared: options.declared.length ? options.declared : files.map((file) => file.tag), authority });
    else if (options.operation === "apply") result = await applyMigrations({ adapter: pool, files, declared: options.declared, authority });
    else result = await verifyMigrations({ adapter: pool, files, declared: [], expectedFloor: options.expectedFloor, authority });
    if (!result.ok) { writeError(`migration ${options.operation} rejected: ${result.code}`); process.exitCode = 1; return; }
    writeOutput(JSON.stringify(result));
  } catch (error) {
    writeError(`migration ${options.operation} failed: ${error?.message || "unknown"}`);
    process.exitCode = 1;
  } finally {
    await pool?.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate-database.mjs")) await runMigrationCli();
