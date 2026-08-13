#!/usr/bin/env node

import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import authorityContract from "../config/database-authority.json" with { type: "json" };
import productionPreflightGrantContract from "../config/neon-production-preflight-grants.json" with { type: "json" };
import { parseNeonUrl } from "./check-database-authority.mjs";
import { validateOriginalProductionVector } from "./check-historical-db-artifacts.mjs";
import { createDatabasePool } from "./database-pool.mjs";
import { createMigrationEvidence, createPreflightFailureEvidence, verifyMigrationEvidence } from "./migration-evidence.mjs";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SHA1 = /^[a-f0-9]{40}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;
const IDENTIFIER = /^[a-z0-9][a-z0-9_.-]{2,127}$/i;
const REPOSITORY = /^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i;
const lexicalCompare = (left, right) => String(left).localeCompare(String(right));
const GIT_EXECUTABLES = Object.freeze({
  win32: Object.freeze([
    "C:\\Program Files\\Git\\cmd\\git.exe",
    "C:\\Program Files\\Git\\bin\\git.exe",
  ]),
  linux: Object.freeze(["/usr/bin/git"]),
  darwin: Object.freeze([
    "/usr/bin/git",
    "/opt/homebrew/bin/git",
    "/usr/local/bin/git",
  ]),
});
export const MIGRATIONS_ROOT = join(SCRIPT_DIR, "..", "packages", "db", "migrations");
export const HISTORY_VARIANTS = Object.freeze(["original-production", "repaired-bootstrap"]);
export const ENVIRONMENT_HISTORY_PINS = Object.freeze(authorityContract.environmentHistoryPins);
const HISTORY_MANIFEST_PATH = join(SCRIPT_DIR, "..", "docs", "history", "database-migrations", "manifest.json");
const HISTORY_JOURNAL_PATH = join(MIGRATIONS_ROOT, "meta", "_journal.json");

function canonicalHash(value) {
  return createHash("sha256").update(String(value).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

function rawSha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort(lexicalCompare).map((key) => [key, canonicalize(value[key])]));
  return value;
}

export function canonicalPreflightPayload(attestation = {}) {
  const payload = Object.fromEntries(Object.entries(attestation).filter(([key]) => key !== "signature"));
  return JSON.stringify(canonicalize(payload));
}

function gitBlobId(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
  const gitExecutable = resolveGitExecutable();
  if (!gitExecutable) return null;
  try {
    const blobId = execFileSync(gitExecutable, ["hash-object", "--stdin"], {
      input: buffer,
      encoding: "utf8",
      windowsHide: true,
    }).trim();
    return SHA1.test(blobId) ? blobId : null;
  } catch {
    return null;
  }
}

export function resolveGitExecutable({ platform = process.platform, fileExists = existsSync } = {}) {
  return GIT_EXECUTABLES[platform]?.find((candidate) => fileExists(candidate)) ?? null;
}

function attestationParts(attestation) {
  return {
    target: attestation.target ?? {},
    role: attestation.role ?? {},
    recovery: attestation.recovery ?? {},
    source: attestation.source ?? {},
    validity: attestation.validity ?? {},
    signature: attestation.signature ?? {},
  };
}

function hasValidAttestationIdentities({ target, role, recovery }) {
  return [target.projectId, target.productionBranchId, target.endpointId, role.loginIdentifier, recovery.id, recovery.projectId, recovery.sourceBranchId]
    .every((value) => IDENTIFIER.test(value ?? ""));
}

function hasValidAttestationDigests(attestation, { role, source }) {
  return [role.grantContractSha256, attestation.catalog?.catalogSha256, source.immutableSourceSha256]
    .every((value) => SHA256.test(value ?? ""));
}

function verifyAttestationSignature(attestation, trust, signature) {
  const payload = canonicalPreflightPayload(attestation);
  const payloadDigest = canonicalHash(payload);
  if (signature.algorithm !== "Ed25519" || signature.canonicalPayloadSha256 !== payloadDigest || typeof signature.value !== "string") return fail("PREFLIGHT_ATTESTATION_SIGNATURE_INVALID");
  const trustedKey = trust.keys?.find((key) => key.keyId === signature.keyId && key.algorithm === "Ed25519");
  if (!trustedKey) return fail("PREFLIGHT_ATTESTATION_KEY_UNTRUSTED");
  try {
    if (!verifySignature(null, Buffer.from(payload), createPublicKey(trustedKey.publicKeyPem), Buffer.from(signature.value, "base64"))) return fail("PREFLIGHT_ATTESTATION_SIGNATURE_INVALID");
  } catch {
    return fail("PREFLIGHT_ATTESTATION_SIGNATURE_INVALID");
  }
  return { ok: true, payloadDigest };
}

function isFreshAttestation({ validity, recovery, source }, now) {
  const instants = [
    now instanceof Date ? now.getTime() : new Date(now).getTime(),
    Date.parse(validity.notBefore),
    Date.parse(validity.expiresAt),
    Date.parse(recovery.createdAt),
    Date.parse(recovery.expiresAt),
    Date.parse(source.producedAt),
  ];
  const [instant, notBefore, expiresAt, recoveryCreatedAt, recoveryExpiresAt, sourceProducedAt] = instants;
  return instants.every(Number.isFinite)
    && instant >= notBefore && instant < expiresAt && instant < recoveryExpiresAt
    && sourceProducedAt <= instant && recoveryCreatedAt <= instant;
}

export function verifyProductionPreflightAttestation({ attestation = {}, trust = {}, fileBytes = "", fileBlobId, runSha, repository, now = new Date() } = {}) {
  if (attestation.configured !== true) return fail("PREFLIGHT_ATTESTATION_UNCONFIGURED");
  if (attestation.schemaVersion !== "neon-production-preflight-attestation.v1" || trust.schemaVersion !== "neon-production-preflight-trust.v1") return fail("PREFLIGHT_ATTESTATION_SCHEMA_INVALID");
  if (!SHA1.test(runSha ?? "") || !REPOSITORY.test(repository ?? "")) return fail("PREFLIGHT_RUN_CONTEXT_INVALID");
  const parts = attestationParts(attestation);
  const { target, role, recovery, source, signature } = parts;
  if (!hasValidAttestationIdentities(parts)) return fail("PREFLIGHT_ATTESTATION_IDENTITY_INVALID");
  if (target.database !== "neondb" || target.schema !== "public" || recovery.projectId !== target.projectId || recovery.sourceBranchId !== target.productionBranchId) return fail("PREFLIGHT_ATTESTATION_TARGET_MISMATCH");
  if (role.grantContract !== productionPreflightGrantContract.name || role.grantContractSha256 !== grantContractDigest()) return fail("PREFLIGHT_ATTESTATION_GRANT_MISMATCH");
  if (!hasValidAttestationDigests(attestation, parts)) return fail("PREFLIGHT_ATTESTATION_DIGEST_INVALID");
  if (!["branch", "snapshot"].includes(recovery.kind) || !["neon-control-plane-export", "independently-signed-export"].includes(source.kind)) return fail("PREFLIGHT_ATTESTATION_SOURCE_INVALID");
  const signatureProof = verifyAttestationSignature(attestation, trust, signature);
  if (!signatureProof.ok) return signatureProof;
  const parsedFile = (() => { try { return JSON.parse(String(fileBytes)); } catch { return null; } })();
  if (!parsedFile || JSON.stringify(canonicalize(parsedFile)) !== JSON.stringify(canonicalize(attestation))) return fail("PREFLIGHT_ATTESTATION_FILE_MISMATCH");
  const observedBlobId = gitBlobId(fileBytes);
  if (!SHA1.test(fileBlobId ?? "") || observedBlobId !== fileBlobId) return fail("PREFLIGHT_ATTESTATION_BLOB_MISMATCH");
  if (!isFreshAttestation(parts, now)) return fail("PREFLIGHT_ATTESTATION_STALE");
  return {
    ok: true, runSha, repository,
    attestationBlobId: observedBlobId,
    attestationFileSha256: rawSha256(fileBytes),
    attestationCanonicalPayloadSha256: signatureProof.payloadDigest,
    signatureKeyId: signature.keyId,
  };
}

export function grantContractDigest(contract = productionPreflightGrantContract) {
  return createHash("sha256").update(JSON.stringify(canonicalize(contract)), "utf8").digest("hex");
}

function controlledMigrationFailureCode(error) {
  const message = String(error?.message ?? "");
  const categories = [
    ["required runtime role", "MIGRATION_ROLE_PREFLIGHT_FAILED"],
    ["unauthorized administrative membership", "MIGRATION_ROLE_MEMBERSHIP_FAILED"],
    ["catalog mismatch: missing relation for constraint", "MIGRATION_CATALOG_CONSTRAINT_RELATION_MISSING"],
    ["catalog mismatch: meetings.visibility", "MIGRATION_CATALOG_VISIBILITY_MISMATCH"],
    ["catalog mismatch: constraint", "MIGRATION_CATALOG_CONSTRAINT_MISMATCH"],
    ["catalog mismatch: relation", "MIGRATION_CATALOG_RELATION_MISMATCH"],
    ["catalog mismatch: column", "MIGRATION_CATALOG_COLUMN_MISMATCH"],
    ["catalog mismatch: enum", "MIGRATION_CATALOG_ENUM_MISMATCH"],
    ["catalog mismatch: index", "MIGRATION_CATALOG_INDEX_MISMATCH"],
    ["runtime grant manifest table missing", "MIGRATION_RUNTIME_GRANT_TABLE_MISSING"],
  ];
  return categories.find(([fragment]) => message.includes(fragment))?.[1];
}

function redactError(error) {
  const code = controlledMigrationFailureCode(error)
    || error?.code
    || (typeof error?.message === "string" && error.message.startsWith("MIGRATION_") ? error.message : "MIGRATION_FAILED");
  return new Error(code);
}

function tagNumber(tag) {
  const match = /^(\d+)/.exec(String(tag));
  return match ? Number(match[1]) : Number.NaN;
}

function failureTag(tag) {
  return /^(\d{4})/.exec(String(tag))?.[1] ?? "UNKNOWN";
}

function taggedMigrationFailure(tag, fallback, error) {
  const message = String(error?.message ?? "");
  const reason = message !== "MIGRATION_FAILED" && /^MIGRATION_[A-Z0-9_]+$/.test(message)
    ? message.slice("MIGRATION_".length)
    : fallback;
  return new Error(`MIGRATION_${failureTag(tag)}_${reason}`);
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
  return (applied ?? []).map((entry) => typeof entry === "string" ? { tag: entry } : entry).filter((entry) => entry && typeof entry === "object");
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
    const acceptedHashes = new Set((expected.strictAcceptedHashes ? expected.acceptedHashes : [expected.hash, ...(expected.acceptedHashes ?? [])]).filter(Boolean));
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

function classifyHistoryHashes(hashes = {}, history = {}) {
  const values = ["0000_stale_jamie_braddock.sql", "0004_minor_lockheed.sql"]
    .map((file) => ({ file, value: hashes[file] }))
    .filter(({ value }) => value !== undefined);
  if (values.length === 0) return null;
  const variants = values.map(({ file, value }) => {
    const text = String(value).toLowerCase();
    if (history?.manifest?.drizzle?.historyVectors?.["original-production"]?.entries?.some((entry) => entry.filename === file && entry.observedSha256 === value)) return "original-production";
    if (text === "original" || text.startsWith("original-") || text.includes("original")) return "original-production";
    if (text === "repaired" || text.startsWith("repaired-") || text.includes("repaired")) return "repaired-bootstrap";
    return null;
  });
  if (variants.some((variant) => !variant)) return "unknown";
  return new Set(variants).size === 1 ? variants[0] : "mixed";
}

function originalProductionFiles(files, history = {}) {
  const manifest = history.manifest ?? JSON.parse(readFileSync(HISTORY_MANIFEST_PATH, "utf8"));
  const journal = history.journal ?? JSON.parse(readFileSync(HISTORY_JOURNAL_PATH, "utf8"));
  const vector = validateOriginalProductionVector({ manifest, root: join(SCRIPT_DIR, "..") });
  if (!vector.ok) return { ok: false, code: "MIGRATION_HISTORY_VECTOR_INVALID" };
  const byFile = new Map(vector.entries.map((entry) => [entry.filename, entry.observedSha256]));
  const timestamps = new Map((journal.entries ?? []).map((entry) => [entry.tag, Number(entry.when)]));
  return {
    ok: true,
    files: files.map((file) => {
      const observedHash = byFile.get(file.file);
      return {
        ...file,
        ...(observedHash ? { hash: observedHash, acceptedHashes: [observedHash], strictAcceptedHashes: true } : {}),
        timestamp: timestamps.get(file.tag) ?? file.timestamp,
      };
    }),
    manifest,
    journal,
  };
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

function originalHistoryPrefixIssue(applied, files) {
  const expected = files.filter((file) => tagNumber(file.tag) <= 17);
  if (expected.length !== 18 || applied.length < expected.length) return "MIGRATION_HISTORY_PREFIX_INCOMPLETE";
  for (let index = 0; index < expected.length; index += 1) {
    const observed = applied[index];
    const canonical = expected[index];
    if (!observed || observed.tag !== canonical.tag) return "MIGRATION_HISTORY_SEQUENCE_INVALID";
    if (observed.hash !== undefined && observed.hash !== canonical.hash) return "MIGRATION_HASH_MISMATCH";
    if (observed.timestamp !== undefined && Number(observed.timestamp) !== Number(canonical.timestamp)) return "MIGRATION_TIMESTAMP_MISMATCH";
  }
  return null;
}

function isProductionP0Allowed(environment, applied, declared) {
  if (environment !== "production") return true;
  const appliedLast = applied.length ? applied.at(-1).tag : null;
  const pending = declared.map((entry) => normalizeTag(entry));
  return (appliedLast === "0017" && pending.join(",") === "0018,0019,0020,0021")
    || (appliedLast === "0018" && pending.join(",") === "0019,0020,0021")
    || (appliedLast === "0019" && pending.join(",") === "0020,0021")
    || (appliedLast === "0020" && pending.join(",") === "0021");
}

function resolvePlanVariant({ authority, observedVariant, hashes, history }) {
  let pinned;
  try {
    pinned = expectedVariant(authority);
  } catch (error) {
    return { ok: false, code: error.message };
  }
  const inferredVariant = observedVariant ?? history?.variant ?? classifyHistoryHashes(hashes, history) ?? pinned.historyVariant;
  if (inferredVariant === "mixed") return { ok: false, code: "MIGRATION_HISTORY_VARIANT_MIXED" };
  if (inferredVariant === "unknown" || !HISTORY_VARIANTS.includes(inferredVariant)) return { ok: false, code: "MIGRATION_HISTORY_VARIANT_UNKNOWN" };
  if (inferredVariant !== pinned.historyVariant) return { ok: false, code: "MIGRATION_HISTORY_VARIANT_MISMATCH" };
  return { ok: true, pinned, inferredVariant };
}

function validatePlanConstraints({ applied, declared, files, inferredVariant, expectedCount, expectedFloor, pinned, hashes }) {
  const hashIssue = compareHashes(applied, files);
  if (hashIssue) return hashIssue;
  const declaredHashIssue = compareDeclaredHashes(hashes, files);
  if (declaredHashIssue) return declaredHashIssue;
  if (expectedFloor && !migrationFloorMatches(applied.at(-1)?.tag, expectedFloor)) return "MIGRATION_FLOOR_MISMATCH";
  if (expectedCount !== undefined && applied.length !== expectedCount) return "MIGRATION_COUNT_MISMATCH";
  if (inferredVariant === "original-production" && files.some((file) => tagNumber(file.tag) === 0)) {
    const prefixIssue = originalHistoryPrefixIssue(applied, files);
    if (prefixIssue) return prefixIssue;
  }
  const suffixIssue = pendingFor(applied, declared, files);
  if (suffixIssue) return suffixIssue;
  if (!isProductionP0Allowed(pinned.environment, applied, declared)) return "MIGRATION_P0_SUFFIX_FORBIDDEN";
  return null;
}

/** Build a plan without opening a database connection. */
export function buildMigrationPlan({ applied = [], declared = [], files = [], authority = {}, expectedCount, expectedFloor, observedVariant, hashes, history } = {}) {
  const variant = resolvePlanVariant({ authority, observedVariant, hashes, history });
  if (!variant.ok) return variant;
  const normalizedFileList = normalizedFiles(files);
  const productionFiles = variant.inferredVariant === "original-production" ? originalProductionFiles(normalizedFileList, history) : { ok: true, files: normalizedFileList };
  if (!productionFiles.ok) return productionFiles;
  const effectiveFiles = productionFiles.files;
  const byObservedHash = new Map(effectiveFiles.filter((file) => file.hash).map((file) => [file.hash, file.tag]));
  const normalizedAppliedList = normalizedApplied(applied).map((entry) => entry.tag ? entry : { ...entry, tag: byObservedHash.get(entry.hash ?? entry.hash_value) });
  const normalizedDeclared = normalizedApplied(declared);
  const issue = validatePlanConstraints({ applied: normalizedAppliedList, declared: normalizedDeclared, files: effectiveFiles, inferredVariant: variant.inferredVariant, expectedCount, expectedFloor, pinned: variant.pinned, hashes });
  if (issue) return { ok: false, code: issue };
  return {
    ok: true,
    environment: variant.pinned.environment,
    historyVariant: variant.pinned.historyVariant,
    applied: normalizedAppliedList.map((entry) => entry.tag),
    pending: normalizedDeclared.map((entry) => entry.tag),
    files: effectiveFiles,
  };
}

function migrationRows(rows, historyVariant, history, files = []) {
  const effective = historyVariant === "original-production" ? originalProductionFiles(files, history).files ?? files : files;
  const byHash = new Map(effective.flatMap((file) => [file.hash, ...(file.acceptedHashes ?? [])].filter(Boolean).map((hash) => [hash, file.tag])));
  return (rows ?? []).map((row) => {
    const value = row && typeof row === "object" ? row : {};
    return {
      tag: value.tag ?? value.name ?? value.migration_tag ?? byHash.get(value.hash ?? value.hash_value),
      hash: value.hash ?? value.hash_value,
      timestamp: value.timestamp ?? value.created_at ?? value.when,
    };
  });
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

export function validateProductionHistoryRows(historyRows, files) {
  if (!Array.isArray(historyRows)) return fail("MIGRATION_HISTORY_UNAVAILABLE");
  const tagsByHash = acceptedHistoryTags(files);
  const normalized = historyRows.map((row) => normalizeProductionHistoryRow(row, tagsByHash));
  const invalid = normalized.find((row) => !row.ok);
  if (invalid) return fail(invalid.code);
  const rows = normalized.map(({ value }) => value);
  if (rows.length !== 18) return fail("MIGRATION_COUNT_MISMATCH");
  if (new Set(rows.map((row) => row.tag)).size !== rows.length) return fail("MIGRATION_DUPLICATE_TAG");
  return { ok: true, rows };
}

function acceptedHistoryTags(files) {
  const byHash = new Map();
  for (const file of files ?? []) {
    const hashes = file.strictAcceptedHashes ? file.acceptedHashes : [file.hash, ...(file.acceptedHashes ?? [])];
    for (const hash of hashes ?? []) if (hash) byHash.set(hash, file.tag);
  }
  return byHash;
}

function normalizeProductionHistoryRow(row, tagsByHash) {
  const hash = row?.hash ?? row?.hash_value;
  const mappedTag = tagsByHash.get(hash);
  if (!mappedTag) return fail("MIGRATION_HASH_UNKNOWN");
  const suppliedTag = row?.tag ?? row?.name ?? row?.migration_tag;
  if (suppliedTag !== undefined && suppliedTag !== mappedTag) return fail("MIGRATION_TAG_HASH_MISMATCH");
  return { ok: true, value: { tag: mappedTag, hash, timestamp: row?.timestamp ?? row?.created_at ?? row?.when } };
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
  const expectedFacts = [...(grantContract.positivePrivileges ?? []), ...(grantContract.negativePrivileges ?? [])]
    .filter((fact) => fact.source !== "default-acl");
  const expectedDefaultAclPaths = (grantContract.negativePrivileges ?? []).filter((fact) => fact.source === "default-acl");
  const actualFacts = snapshot.privilegeFacts ?? [];
  if (actualFacts.some((fact) => fact.granted && (grantContract.negativePrivileges ?? []).some((expected) => sameFacts([fact], [{ ...expected, granted: fact.granted }])))) return fail("PREFLIGHT_WRITE_PRIVILEGE");
  if (!sameFacts(actualFacts, expectedFacts)) return fail("PREFLIGHT_PRIVILEGE_PROOF_INCOMPLETE");
  if (!Array.isArray(snapshot.defaultAclWritePaths)) return fail("PREFLIGHT_DEFAULT_ACL_UNPROVEN");
  if (expectedDefaultAclPaths.length === 0 || expectedDefaultAclPaths.some((fact) => !fact.objectKind || !fact.objectName || !fact.privilege || fact.granted !== false)) return fail("PREFLIGHT_DEFAULT_ACL_UNPROVEN");
  if (snapshot.defaultAclWritePaths.some((path) => !expectedDefaultAclPaths.some((expected) => sameFacts([normalizeFact(path)], [{ ...expected, granted: true }])))) return fail("PREFLIGHT_DEFAULT_ACL_UNPROVEN");
  if (snapshot.defaultAclWritePaths.length > 0) return fail("PREFLIGHT_DEFAULT_ACL_WRITE");
  const expectedProbes = ["autocommit", "transaction"].flatMap((mode) => (grantContract.denialProbes ?? []).map((operation) => `${mode}:${operation}`)).sort(lexicalCompare);
  const actualProbes = (snapshot.denialProbes ?? []).map((probe) => `${probe.mode}:${probe.operation}`).sort(lexicalCompare);
  if (JSON.stringify(actualProbes) !== JSON.stringify(expectedProbes)) return fail("PREFLIGHT_DENIAL_PROBE_INCOMPLETE");
  if ((snapshot.denialProbes ?? []).some((probe) => !SAFE_PROBE_CODES.has(probe.code))) return fail("PREFLIGHT_DENIAL_PROBE_SUCCEEDED");
  if (!/^[a-f0-9]{64}$/i.test(snapshot.catalogDigest ?? "") || snapshot.catalogDigest !== attestation.catalog?.catalogSha256) return fail("PREFLIGHT_CATALOG_MISMATCH");
  const metrics = (snapshot.aggregateRowCounts ?? []).map((entry) => entry.metric).sort(lexicalCompare);
  if (JSON.stringify(metrics) !== JSON.stringify([...(grantContract.rowCountMetrics ?? [])].sort(lexicalCompare))) return fail("PREFLIGHT_ROW_COUNT_CONTRACT_MISMATCH");
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
    ELSE true
  END AS granted
FROM expected e;`;

export const DEFAULT_ACL_SQL = `/* preflight:default-acl */
WITH RECURSIVE expected AS (
  SELECT * FROM jsonb_to_recordset($1::jsonb)
    AS x(source text, "objectKind" text, "objectName" text, privilege text, granted boolean)
), inherited_roles AS (
  SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user
  UNION
  SELECT parent.oid FROM pg_auth_members membership
  JOIN inherited_roles member ON member.oid = membership.member
  JOIN pg_roles parent ON parent.oid = membership.roleid
), relevant_grantees AS (
  SELECT 0::oid AS oid
  UNION SELECT oid FROM inherited_roles
), catalog_defaults AS (
  SELECT 'database' AS object_kind, d.datname AS object_name, acl.grantee, acl.privilege_type AS privilege
  FROM pg_database d
  CROSS JOIN LATERAL aclexplode(acldefault('d', d.datdba)) acl
  WHERE d.datacl IS NULL
  UNION ALL
  SELECT 'schema', n.nspname, acl.grantee, acl.privilege_type
  FROM pg_namespace n
  CROSS JOIN LATERAL aclexplode(acldefault('n', n.nspowner)) acl
  WHERE n.nspacl IS NULL
  UNION ALL
  SELECT CASE defaults.defaclobjtype WHEN 'r' THEN 'table' WHEN 'S' THEN 'sequence' WHEN 'n' THEN 'schema' END,
         CASE WHEN defaults.defaclobjtype = 'n' THEN '*' ELSE coalesce(namespace.nspname, '*') || '.*' END,
         acl.grantee, acl.privilege_type
  FROM pg_default_acl defaults
  LEFT JOIN pg_namespace namespace ON namespace.oid = defaults.defaclnamespace
  CROSS JOIN LATERAL aclexplode(defaults.defaclacl) acl
  WHERE defaults.defaclobjtype IN ('r', 'S', 'n')
)
SELECT e.source, e."objectKind" AS object_kind, e."objectName" AS object_name, e.privilege, true AS granted
FROM expected e
WHERE e.source = 'default-acl'
  AND e.privilege IN ('CREATE','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','USAGE','SELECT')
  AND EXISTS (
    SELECT 1 FROM catalog_defaults actual
    JOIN relevant_grantees grantee ON grantee.oid = actual.grantee
    WHERE actual.object_kind = e."objectKind"
      AND actual.privilege = e.privilege
      AND (
        actual.object_name = e."objectName"
        OR (actual.object_name = '*' AND e."objectKind" = 'schema')
        OR (e."objectKind" IN ('table','sequence') AND (actual.object_name = '*' OR e."objectName" LIKE replace(actual.object_name, '.*', '.%')))
      )
  );`;
const CATALOG_SQL = `/* preflight:catalog */ SELECT n.nspname AS schema_name, c.relname AS object_name, c.relkind AS object_kind, pg_get_userbyid(c.relowner) AS owner_name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname, c.relname, c.relkind;`;
const ROW_COUNTS_SQL = `/* preflight:row-counts */ SELECT 'drizzle_migration_rows' AS metric, count(*)::bigint::text::int AS count FROM drizzle.__drizzle_migrations;`;

const PROBE_SQL = Object.freeze({
  INSERT: "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) SELECT repeat('0', 64), 0 WHERE false;",
  UPDATE: "UPDATE drizzle.__drizzle_migrations SET hash = hash WHERE false;",
  DELETE: "DELETE FROM drizzle.__drizzle_migrations WHERE false;",
  DDL: "CREATE TABLE public.__product_suite_preflight_forbidden (id integer);",
  nextval: "SELECT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);",
});

async function runAutocommitDenialProbes(client, operations) {
  const results = [];
  await client.query("SET default_transaction_read_only = on;");
  for (const operation of operations) {
    try { await client.query(PROBE_SQL[operation]); results.push({ mode: "autocommit", operation, code: null }); }
    catch (error) { results.push({ mode: "autocommit", operation, code: error?.code ?? null }); }
  }
  return results;
}

async function runTransactionDenialProbes(client, operations) {
  const results = [];
  for (const operation of operations) {
    await client.query("SAVEPOINT preflight_denial_probe;");
    try { await client.query(PROBE_SQL[operation]); results.push({ mode: "transaction", operation, code: null }); }
    catch (error) { results.push({ mode: "transaction", operation, code: error?.code ?? null }); }
    finally {
      await client.query("ROLLBACK TO SAVEPOINT preflight_denial_probe;");
      await client.query("RELEASE SAVEPOINT preflight_denial_probe;");
    }
  }
  return results;
}

async function collectPreflightSnapshot(client, contract) {
  const identity = await client.query(IDENTITY_SQL);
  const expectedFacts = [...(contract.positivePrivileges ?? []), ...(contract.negativePrivileges ?? [])];
  const privileges = await client.query(PRIVILEGE_SQL, [JSON.stringify(expectedFacts.filter((fact) => fact.source !== "default-acl"))]);
  const defaultAcl = await client.query(DEFAULT_ACL_SQL, [JSON.stringify(expectedFacts.filter((fact) => fact.source === "default-acl"))]);
  const catalog = await client.query(CATALOG_SQL);
  const rowCounts = await client.query(ROW_COUNTS_SQL);
  return {
    identity: normalizeIdentity(identity?.rows?.[0]),
    privilegeFacts: (privileges?.rows ?? []).map(normalizeFact),
    defaultAclWritePaths: defaultAcl?.rows ?? [],
    denialProbes: [],
    catalogDigest: catalog?.rows?.[0]?.catalog_digest ?? canonicalHash(canonicalize(catalog?.rows ?? [])),
    aggregateRowCounts: (rowCounts?.rows ?? []).map((entry) => ({ metric: entry.metric, count: Number(entry.count) })),
  };
}

export async function verifyProductionPreflight({ adapter, files = loadMigrationFiles(), expectedFloor, authority, attestation, grantContract = productionPreflightGrantContract, endpointId, runContext = {} } = {}) {
  if (authority?.environment !== "production" || authority?.historyVariant !== "original-production" || expectedFloor !== "0017") return fail("PREFLIGHT_HISTORY_CONTRACT_MISMATCH");
  if (!adapter?.query && !adapter?.connect) return fail("PREFLIGHT_DATABASE_UNAVAILABLE");
  const client = adapter.connect ? await adapter.connect() : adapter;
  try {
    try { await client.query("BEGIN READ ONLY;"); }
    catch { return fail("PREFLIGHT_READ_ONLY_SETUP_FAILED"); }
    let snapshot;
    let historyRows;
    let transactionProbes;
    let readFailure = null;
    try {
      snapshot = await collectPreflightSnapshot(client, grantContract);
      const history = await query(client, HISTORY_SQL);
      historyRows = history?.rows;
      transactionProbes = await runTransactionDenialProbes(client, grantContract.denialProbes ?? []);
    } catch {
      readFailure = fail("PREFLIGHT_DATABASE_READ_FAILED");
    }
    try { await client.query("ROLLBACK;"); }
    catch { return fail("PREFLIGHT_READ_ONLY_ROLLBACK_FAILED"); }
    if (readFailure) return readFailure;
    let autocommitProbes;
    try { autocommitProbes = await runAutocommitDenialProbes(client, grantContract.denialProbes ?? []); }
    catch { return fail("PREFLIGHT_READ_ONLY_SETUP_FAILED"); }
    snapshot.denialProbes = [...autocommitProbes, ...transactionProbes];
    const validated = validatePreflightSnapshot({ snapshot, attestation, grantContract, expectedEndpointId: endpointId });
    if (!validated.ok) return validated;
    const productionFiles = originalProductionFiles(files);
    if (!productionFiles.ok) return productionFiles;
    const history = validateProductionHistoryRows(historyRows, productionFiles.files);
    if (!history.ok) return history;
    const rows = history.rows;
    const pendingFiles = productionFiles.files.filter((file) => tagNumber(file.tag) > 17);
    const plan = buildMigrationPlan({
      applied: rows,
      declared: pendingFiles,
      files: productionFiles.files,
      expectedCount: 18,
      expectedFloor,
      authority,
      observedVariant: "original-production",
      history: { manifest: productionFiles.manifest, journal: productionFiles.journal },
    });
    if (!plan.ok) return plan;
    if (plan.pending.join(",") !== "0018,0019,0020,0021") return fail("PREFLIGHT_PENDING_SUFFIX_MISMATCH");
    const evidence = createMigrationEvidence({
      schemaVersion: "neon-production-preflight-evidence.v1",
      operation: "verify", status: "PREFLIGHT_READY", reasonCodes: ["PREFLIGHT_READY"],
      historyVariant: plan.historyVariant, expectedFloor, expectedCount: 18,
      repository: runContext.repository, runId: runContext.runId, runSha: runContext.runSha,
      projectId: attestation.target?.projectId, branchId: attestation.target?.productionBranchId,
      endpointId, database: attestation.target?.database, schema: attestation.target?.schema,
      proofSource: attestation.source?.kind, sourceImmutableSha256: attestation.source?.immutableSourceSha256,
      sourceProducedAt: attestation.source?.producedAt,
      attestationBlobId: runContext.attestationBlobId,
      attestationFileSha256: runContext.attestationFileSha256,
      attestationCanonicalPayloadSha256: runContext.attestationCanonicalPayloadSha256,
      signatureKeyId: runContext.signatureKeyId,
      recoveryKind: attestation.recovery?.kind, recoveryId: attestation.recovery?.id,
      recoverySourceBranchId: attestation.recovery?.sourceBranchId,
      observedAt: new Date().toISOString(), expiresAt: attestation.validity?.expiresAt,
      loginIdentifier: validated.loginIdentifier,
      grantContract: grantContract.name, grantContractSha256: grantContractDigest(grantContract),
      catalogDigest: validated.catalogDigest, grantDigest: validated.grantDigest,
      aggregateRowCounts: validated.aggregateRowCounts,
      applied: rows.map((entry) => ({ tag: entry.tag, timestamp: Number(entry.timestamp), hash: entry.hash })),
      pending: pendingFiles.map((entry) => ({ tag: entry.tag, hash: entry.hash })),
    });
    const checked = verifyMigrationEvidence(evidence);
    return checked.ok ? evidence : fail(checked.code);
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
  const byTag = new Map(plan.files.map((file) => [file.tag, file]));
  const evidenceByTag = new Map(plan.files.map((file) => [file.tag, file]));
  let lockedAppliedRows = [];
  await query(adapter, "BEGIN;");
  try {
    await query(adapter, lockSql());
    const reread = await query(adapter, HISTORY_SQL);
    const rereadRows = migrationRows(reread?.rows, authority?.historyVariant, history, files);
    // An empty re-read is also a TOCTOU change: trusting it would allow a
    // caller's stale `applied` list to authorize a suffix on a fresh/changed
    // database.  Always rebuild and compare the observed plan under the lock.
    const rereadPlan = buildMigrationPlan({ applied: rereadRows, declared, files, authority, observedVariant, hashes, history });
    if (!rereadPlan.ok || rereadPlan.applied.join(",") !== plan.applied.join(",")) throw new Error("MIGRATION_TOCTOU");
    lockedAppliedRows = rereadRows;
    for (const tag of plan.pending) {
      const file = byTag.get(tag);
      if (!file) throw new Error("MIGRATION_TAG_UNKNOWN");
      try {
        await query(adapter, runnableSql(file.sql));
      } catch (error) {
        throw taggedMigrationFailure(tag, "EXECUTION_FAILED", error);
      }
      try {
        await query(adapter, "INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2);", [file.hash, file.timestamp]);
      } catch (error) {
        throw taggedMigrationFailure(tag, "HISTORY_WRITE_FAILED", error);
      }
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
  const observedByTag = new Map(lockedAppliedRows.map((entry) => [entry.tag, entry]));
  return createMigrationEvidence({
    operation: "apply",
    status: "APPLIED",
    historyVariant: plan.historyVariant,
    expectedCount: plan.applied.length + records.length,
    applied: [
      ...plan.applied.map((tag) => {
        const observed = observedByTag.get(tag);
        const canonical = evidenceByTag.get(tag);
        return { tag, timestamp: Number(observed?.timestamp ?? canonical?.timestamp), hash: observed?.hash ?? canonical?.hash ?? "" };
      }),
      ...records,
    ],
  });
}

/** Verify a recognized floor with no pending work.  This function never writes. */
export async function verifyMigrations({ adapter, applied = [], declared = [], files = loadMigrationFiles(), expectedFloor, authority, observedVariant, hashes, history, expectedCount } = {}) {
  let rows = normalizedApplied(applied);
  if (rows.length === 0 && adapter?.query && !declared.length) {
    const result = await query(adapter, HISTORY_SQL);
    rows = migrationRows(result?.rows, authority?.historyVariant, history, files);
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

function readPreflightConfig(name) {
  const path = join(SCRIPT_DIR, "..", "config", name);
  return { bytes: readFileSync(path, "utf8"), value: JSON.parse(readFileSync(path, "utf8")) };
}

export function productionPreflightFiles(files) {
  const manifest = JSON.parse(readFileSync(join(SCRIPT_DIR, "..", "docs", "history", "database-migrations", "manifest.json"), "utf8"));
  const journal = JSON.parse(readFileSync(join(MIGRATIONS_ROOT, "meta", "_journal.json"), "utf8"));
  const timestamps = new Map((journal.entries ?? []).map((entry) => [entry.tag, Number(entry.when)]));
  const repairs = new Map((manifest.drizzle?.repairs ?? []).map((entry) => [entry.path.replace(/\.sql$/, ""), entry]));
  return files.map((file) => {
    const repair = repairs.get(file.tag);
    const acceptedHashes = repair
      ? [repair.original?.lfSha256, repair.original?.crlfSha256].filter(Boolean)
      : [file.hash];
    return {
      ...file,
      hash: repair?.original?.lfSha256 ?? file.hash,
      timestamp: timestamps.get(file.tag) ?? file.timestamp,
      acceptedHashes,
      strictAcceptedHashes: true,
    };
  });
}

function isProductionPreflight(options) {
  return options.operation === "verify"
    && options.environment === "production"
    && options.historyVariant === "original-production"
    && options.expectedFloor === "0017";
}

function createFailureEmitter({ productionPreflight, writeEvidence, runContext }) {
  return (code, extra = {}) => {
    if (!productionPreflight) return;
    try {
      writeEvidence(createPreflightFailureEvidence({ code, ...runContext(), ...extra }));
    } catch {
      // The workflow's initialized failure artifact remains authoritative.
    }
  };
}

function rejectCli({ code, message, emitFailure, writeError, extra }) {
  emitFailure(code, extra);
  writeError(message);
  process.exitCode = 1;
  return { ok: false, code };
}

function validateCliEndpoint({ options, databaseUrl }) {
  if (options.environment !== "production") return { ok: true, endpoint: undefined };
  try {
    return { ok: true, endpoint: parseNeonUrl(databaseUrl, "migration") };
  } catch {
    return fail("PREFLIGHT_DATABASE_URL_INVALID");
  }
}

function readPreflightInputs({ preflightAttestation, preflightTrust, preflightFileBytes }) {
  try {
    const attestationConfig = preflightAttestation === undefined ? readPreflightConfig("neon-production-preflight-attestation.json") : null;
    const trustConfig = preflightTrust === undefined ? readPreflightConfig("neon-production-preflight-trust.json") : null;
    const attestation = preflightAttestation ?? attestationConfig.value;
    const trust = preflightTrust ?? trustConfig.value;
    const fileBytes = preflightFileBytes ?? attestationConfig?.bytes;
    if (fileBytes === undefined) return fail("PREFLIGHT_ATTESTATION_CONFIG_INVALID");
    return { ok: true, attestation, trust, fileBytes };
  } catch {
    return fail("PREFLIGHT_ATTESTATION_CONFIG_INVALID");
  }
}

function resolvePreflightAttestation({ productionPreflight, preflightAttestation, preflightTrust, preflightFileBytes, preflightFileBlobId, runContext }) {
  if (!productionPreflight) return { ok: true, attestation: preflightAttestation, runContext };
  const inputs = readPreflightInputs({ preflightAttestation, preflightTrust, preflightFileBytes });
  if (!inputs.ok) return inputs;
  const proof = verifyProductionPreflightAttestation({
    attestation: inputs.attestation,
    trust: inputs.trust,
    fileBytes: inputs.fileBytes,
    fileBlobId: preflightFileBlobId,
    runSha: runContext.runSha,
    repository: runContext.repository,
  });
  if (!proof.ok) return { ...proof, extra: { attestationFileSha256: rawSha256(inputs.fileBytes) } };
  return { ok: true, attestation: inputs.attestation, proof, runContext: { ...runContext, ...proof } };
}

async function executeMigrationOperation({ options, pool, files, authority, productionPreflight, attestation, endpoint, runContext }) {
  if (options.operation === "bootstrap") {
    const declared = options.declared.length ? options.declared : files.map((file) => file.tag);
    return bootstrapMigrations({ adapter: pool, files, declared, authority });
  }
  if (options.operation === "apply") return applyMigrations({ adapter: pool, files, declared: options.declared, authority });
  if (productionPreflight) return verifyProductionPreflight({ adapter: pool, files, expectedFloor: options.expectedFloor, authority, attestation, endpointId: endpoint.endpointId, runContext });
  return verifyMigrations({ adapter: pool, files, declared: [], expectedFloor: options.expectedFloor, authority });
}

export async function runMigrationCli({
  args = process.argv.slice(2),
  databaseUrl = process.env.MIGRATION_DATABASE_URL,
  poolFactory = createDatabasePool,
  writeError = (message) => console.error(message),
  writeOutput = (message) => console.log(message),
  preflightAttestation,
  preflightTrust,
  preflightFileBytes,
  preflightFileBlobId = process.env.PREFLIGHT_ATTESTATION_BLOB_ID,
  writeEvidence = (packet) => writeFileSync(join(process.cwd(), "neon-production-preflight-evidence.json"), `${JSON.stringify(packet, null, 2)}\n`, { encoding: "utf8", mode: 0o600 }),
  runContext = {
    runSha: process.env.GITHUB_SHA,
    repository: process.env.GITHUB_REPOSITORY,
    runId: process.env.GITHUB_RUN_ID,
  },
} = {}) {
  const options = parseArgs(args);
  if (!options?.operation || !options.historyVariant || !options.environment) {
    writeError("usage: bun run migrate:database -- <bootstrap|apply|verify> --environment <environment> --history-variant <variant> [--expected-pending <tags>] [--expected-floor <tag>]");
    process.exitCode = 1;
    return;
  }
  const productionPreflight = isProductionPreflight(options);
  const currentRunContext = () => runContext;
  const emitFailure = createFailureEmitter({ productionPreflight, writeEvidence, runContext: currentRunContext });
  const url = databaseUrl;
  if (!url) {
    rejectCli({ code: "PREFLIGHT_DATABASE_URL_REQUIRED", message: "MIGRATION_DATABASE_URL is required", emitFailure, writeError });
    return;
  }
  const endpointResult = validateCliEndpoint({ options, databaseUrl: url });
  if (!endpointResult.ok) {
    rejectCli({ code: endpointResult.code, message: `migration ${options.operation} rejected: ${endpointResult.code}`, emitFailure, writeError });
    return;
  }
  const attestationResult = resolvePreflightAttestation({
    productionPreflight, preflightAttestation, preflightTrust, preflightFileBytes,
    preflightFileBlobId, runContext,
  });
  if (!attestationResult.ok) {
    rejectCli({ code: attestationResult.code, message: `migration verify rejected: ${attestationResult.code}`, emitFailure, writeError, extra: attestationResult.extra });
    return;
  }
  runContext = attestationResult.runContext;
  preflightAttestation = attestationResult.attestation;
  const attestationProof = attestationResult.proof;
  let pool;
  try {
    pool = await poolFactory({ databaseUrl: url, environment: options.environment });
    const loadedFiles = loadMigrationFiles();
    const files = productionPreflight ? productionPreflightFiles(loadedFiles) : loadedFiles;
    const authority = { environment: options.environment, historyVariant: options.historyVariant };
    const result = await executeMigrationOperation({ options, pool, files, authority, productionPreflight, attestation: preflightAttestation, endpoint: endpointResult.endpoint, runContext });
    if (!result.ok) {
      rejectCli({ code: result.code, message: `migration ${options.operation} rejected: ${result.code}`, emitFailure, writeError, extra: attestationProof });
      return;
    }
    const checked = verifyMigrationEvidence(result);
    if (!checked.ok) {
      rejectCli({ code: checked.code, message: `migration ${options.operation} rejected: ${checked.code}`, emitFailure, writeError, extra: attestationProof });
      return;
    }
    if (productionPreflight) writeEvidence(checked);
    writeOutput(JSON.stringify(checked));
  } catch {
    rejectCli({ code: "MIGRATION_FAILED", message: `migration ${options.operation} failed: MIGRATION_FAILED`, emitFailure, writeError, extra: attestationProof });
  } finally {
    await pool?.end?.();
  }
}

if (process.argv[1] && process.argv[1].endsWith("migrate-database.mjs")) await runMigrationCli();
