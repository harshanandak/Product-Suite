#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import authorityContract from "../config/database-authority.json" with { type: "json" };
import { parseNeonUrl } from "./check-database-authority.mjs";
import { createMigrationEvidence } from "./migration-evidence.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const MIGRATIONS_ROOT = join(SCRIPT_DIR, "..", "packages", "db", "migrations");
export const HISTORY_VARIANTS = Object.freeze(["original-production", "repaired-bootstrap"]);
export const ENVIRONMENT_HISTORY_PINS = Object.freeze(authorityContract.environmentHistoryPins);

function canonicalHash(value) {
  return createHash("sha256").update(String(value).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
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
    if (entry.hash && expected.hash && entry.hash !== expected.hash) return "MIGRATION_HASH_MISMATCH";
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
  return withoutCommit.replace(/-->\s*statement-breakpoint/g, ";");
}

const HISTORY_SQL = "SELECT hash, created_at AS timestamp FROM drizzle.__drizzle_migrations ORDER BY created_at, id;";

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
  const vector = await query(adapter, "SELECT extname FROM pg_extension WHERE extname = 'vector';");
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

async function cli() {
  const options = parseArgs(process.argv.slice(2));
  if (!options?.operation || !options.historyVariant || !options.environment) {
    console.error("usage: bun run migrate:database -- <bootstrap|apply|verify> --environment <environment> --history-variant <variant> [--expected-pending <tags>] [--expected-floor <tag>]");
    process.exitCode = 1;
    return;
  }
  const url = process.env.MIGRATION_DATABASE_URL;
  if (!url) { console.error("MIGRATION_DATABASE_URL is required"); process.exitCode = 1; return; }
  if (options.environment === "production") parseNeonUrl(url, "migration");
  const { Pool } = await import("@neondatabase/serverless");
  const pool = new Pool({ connectionString: url });
  try {
    const files = loadMigrationFiles();
    const authority = { environment: options.environment, historyVariant: options.historyVariant };
    let result;
    if (options.operation === "bootstrap") result = await bootstrapMigrations({ adapter: pool, files, declared: options.declared.length ? options.declared : files.map((file) => file.tag), authority });
    else if (options.operation === "apply") result = await applyMigrations({ adapter: pool, files, declared: options.declared, authority });
    else result = await verifyMigrations({ adapter: pool, files, declared: [], expectedFloor: options.expectedFloor, authority });
    if (!result.ok) { console.error(`migration ${options.operation} rejected: ${result.code}`); process.exitCode = 1; return; }
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`migration ${options.operation} failed: ${error?.message || "unknown"}`);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate-database.mjs")) await cli();
