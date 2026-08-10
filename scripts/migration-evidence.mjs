#!/usr/bin/env node

/**
 * Privacy-safe migration evidence helpers.  Evidence is an allow-list, not a
 * log scrubber: values that are not useful to reconstruct the decision are
 * discarded before they can reach stdout or the Forge record.
 */
const ALLOWED_KEYS = new Set([
  "ok",
  "schemaVersion",
  "operation",
  "status",
  "code",
  "reasonCodes",
  "historyVariant",
  "expectedFloor",
  "expectedCount",
  "repository",
  "runId",
  "runSha",
  "projectId",
  "branchId",
  "endpointId",
  "database",
  "schema",
  "proofSource",
  "sourceImmutableSha256",
  "sourceProducedAt",
  "attestationBlobId",
  "attestationFileSha256",
  "attestationCanonicalPayloadSha256",
  "signatureKeyId",
  "loginIdentifier",
  "grantContract",
  "grantContractSha256",
  "recoveryKind",
  "recoveryId",
  "recoverySourceBranchId",
  "catalogDigest",
  "grantDigest",
  "aggregateRowCounts",
  "observedAt",
  "expiresAt",
  "tag",
  "timestamp",
  "hash",
  "metric",
  "count",
  "pending",
  "applied",
]);

const SECRET_KEY = /(url|password|secret|token|credential|username|sql|query|payload|content|error|message|claim|prompt|embedding)/i;
const MIGRATION_TAG = /^\d{4}(?:_[a-z0-9_]+)?$/i;
const MIGRATION_HASH = /^[a-f0-9]{64}$/i;
const SHA = /^[a-f0-9]{40}$/i;
const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9_.:/-]{0,255}$/i;
const FORBIDDEN_VALUE = /(postgres(?:ql)?|https?:\/\/|password\s*=|BEGIN\b|ALTER\s+TABLE|CREATE\s+TABLE|INSERT\s+INTO|UPDATE\s+[^a-z]|DELETE\s+FROM|DROP\s+)/i;

function migrationFloorMatches(actualTag, expectedFloor) {
  const actualPrefix = /^(\d+)/.exec(String(actualTag))?.[1];
  const expectedPrefix = /^(\d+)/.exec(String(expectedFloor))?.[1];
  return actualPrefix !== undefined && expectedPrefix !== undefined && Number(actualPrefix) === Number(expectedPrefix);
}

function isSafeScalar(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function safeValue(key, value) {
  if (SECRET_KEY.test(key) || !ALLOWED_KEYS.has(key)) return undefined;
  if (Array.isArray(value)) {
    if (key === "reasonCodes") return value.every((entry) => typeof entry === "string" && SAFE_IDENTIFIER.test(entry)) ? [...value] : undefined;
    return undefined;
  }
  if (!isSafeScalar(value)) return undefined;
  // Migration names and digests are opaque, product-owned identifiers.  They
  // may legitimately contain words such as "create" or "delete"; applying
  // the SQL/prose filter to them would silently drop reconstructable history.
  if (typeof value === "string" && FORBIDDEN_VALUE.test(value)) return undefined;
  return value;
}

function redactRecord(entry, fields) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return null;
  const result = {};
  for (const field of fields) {
    const safe = safeValue(field, entry[field]);
    if (safe !== undefined) result[field] = safe;
  }
  return result;
}

/** Return only the privacy-safe, reconstructable evidence fields. */
export function redactEvidence(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "applied") {
      const entries = Array.isArray(value) ? value.map((entry) => redactRecord(entry, ["tag", "timestamp", "hash"])).filter((entry) => entry?.tag && entry?.hash && entry?.timestamp !== undefined) : [];
      result[key] = entries;
      continue;
    }
    if (key === "pending") {
      const entries = Array.isArray(value) ? value.map((entry) => typeof entry === "string" ? { tag: entry } : redactRecord(entry, ["tag", "hash"])).filter((entry) => entry?.tag) : [];
      result[key] = entries;
      continue;
    }
    if (key === "aggregateRowCounts") {
      const entries = Array.isArray(value) ? value.map((entry) => redactRecord(entry, ["metric", "count"])).filter((entry) => entry?.metric && Number.isSafeInteger(entry?.count) && entry.count >= 0) : [];
      result[key] = entries;
      continue;
    }
    const safe = safeValue(key, value);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

export function createMigrationEvidence(input = {}) {
  const evidence = { ok: true, ...redactEvidence(input) };
  if (Array.isArray(evidence.applied)) evidence.count = evidence.applied.length;
  return Object.freeze(evidence);
}

/** Evidence for role provisioning is not migration history. */
export function createRoleProvisioningEvidence(input = {}) {
  const evidence = { ok: true, ...redactEvidence(input), operation: "provision-roles", status: "READY" };
  return Object.freeze(evidence);
}

/**
 * Validate that an evidence packet contains enough immutable facts to replay
 * the gate.  This deliberately does not accept a URL, SQL text, or payload as
 * evidence, even when the caller claims it was redacted.
 */
export function verifyMigrationEvidence(evidence = {}) {
  const safe = redactEvidence(evidence);
  const issues = [];
  const unknownKeys = Object.keys(evidence).filter((key) => !ALLOWED_KEYS.has(key));
  if (unknownKeys.length > 0) issues.push("unknown evidence field");
  if (JSON.stringify(evidence, (_key, value) => typeof value === "string" && FORBIDDEN_VALUE.test(value) ? "__FORBIDDEN__" : value).includes("__FORBIDDEN__")) issues.push("secret or executable value forbidden");
  if (!["bootstrap", "apply", "verify"].includes(safe.operation)) issues.push("operation missing or invalid");
  if (!["APPLIED", "NOOP", "BOOTSTRAPPED", "PREFLIGHT_READY", "FAIL", "INCOMPLETE"].includes(safe.status)) issues.push("status missing or invalid");
  if (!["original-production", "repaired-bootstrap"].includes(safe.historyVariant)) issues.push("history variant missing or invalid");
  if (!Array.isArray(safe.applied)) issues.push("applied migration records missing");
  for (const entry of safe.applied ?? []) {
    if (typeof entry.tag !== "string" || !MIGRATION_TAG.test(entry.tag) || typeof entry.hash !== "string" || !MIGRATION_HASH.test(entry.hash) || typeof entry.timestamp !== "number") issues.push("applied migration record is incomplete");
  }
  if (safe.expectedCount !== undefined && safe.expectedCount !== safe.applied?.length) issues.push("migration count mismatch");
  if (safe.count !== undefined && safe.count !== safe.applied?.length) issues.push("evidence count mismatch");
  if (safe.expectedFloor !== undefined && !migrationFloorMatches(safe.applied?.at(-1)?.tag, safe.expectedFloor)) issues.push("evidence floor mismatch");
  if (safe.status === "NOOP" && Array.isArray(safe.pending) && safe.pending.length > 0) issues.push("NOOP evidence has pending migrations");
  if (safe.status === "PREFLIGHT_READY") {
    if (safe.schemaVersion !== "neon-production-preflight-evidence.v1") issues.push("preflight schema version invalid");
    if (safe.historyVariant !== "original-production" || safe.expectedFloor !== "0017" || safe.expectedCount !== 18) issues.push("preflight history contract invalid");
    if (safe.applied?.length !== 18 || safe.pending?.map((entry) => entry.tag).join(",") !== "0018,0019") issues.push("preflight suffix invalid");
    for (const entry of safe.pending ?? []) if (!MIGRATION_TAG.test(entry.tag) || !MIGRATION_HASH.test(entry.hash ?? "")) issues.push("pending migration record is incomplete");
    if (!SAFE_IDENTIFIER.test(safe.loginIdentifier ?? "") || safe.grantContract !== "product-suite-neon-preflight-reader-v1") issues.push("preflight role contract invalid");
    for (const field of ["grantContractSha256", "catalogDigest", "grantDigest"]) if (!MIGRATION_HASH.test(safe[field] ?? "")) issues.push(`${field} invalid`);
    if (safe.runSha !== undefined && !SHA.test(safe.runSha)) issues.push("run SHA invalid");
  }
  return issues.length === 0 ? { ok: true, ...safe } : { ok: false, code: "EVIDENCE_INVALID", issues };
}

export function printEvidence(evidence) {
  const checked = verifyMigrationEvidence(evidence);
  if (!checked.ok) throw new Error("migration evidence is not reconstructable");
  console.log(JSON.stringify(checked));
  return checked;
}

if (process.argv[1] && new URL(`file://${process.argv[1].replaceAll("\\", "/")}`).pathname.endsWith("migration-evidence.mjs")) {
  const operation = process.argv[2] ?? "verify";
  const input = process.env.MIGRATION_EVIDENCE_JSON;
  if (!input) {
    console.error("MIGRATION_EVIDENCE_JSON is required");
    process.exitCode = 1;
  } else {
    try {
      printEvidence({ operation, ...JSON.parse(input) });
    } catch {
      console.error("migration evidence rejected");
      process.exitCode = 1;
    }
  }
}
