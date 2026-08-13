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
const FORBIDDEN_VALUE_PATTERNS = [
  /postgres(?:ql)?/i,
  /https?:\/\//i,
  /password\s*=/i,
  /\bBEGIN\b/i,
  /\bALTER\s+TABLE\b/i,
  /\bCREATE\s+TABLE\b/i,
  /\bINSERT\s+INTO\b/i,
  /\bUPDATE\s+\S+\s+SET\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bDROP\s+\S+/i,
];

function containsForbiddenValue(value) {
  return typeof value === "string" && FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

function migrationFloorMatches(actualTag, expectedFloor) {
  const actualPrefix = /^(\d+)/.exec(String(actualTag))?.[1];
  const expectedPrefix = /^(\d+)/.exec(String(expectedFloor))?.[1];
  return actualPrefix !== undefined && expectedPrefix !== undefined && Number(actualPrefix) === Number(expectedPrefix);
}

function isSafeScalar(value) {
  return value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function safeValue(key, value) {
  if (!ALLOWED_KEYS.has(key) || (SECRET_KEY.test(key) && key !== "attestationCanonicalPayloadSha256")) return undefined;
  if (Array.isArray(value)) {
    if (key === "reasonCodes") return value.every((entry) => typeof entry === "string" && SAFE_IDENTIFIER.test(entry)) ? [...value] : undefined;
    return undefined;
  }
  if (!isSafeScalar(value)) return undefined;
  // Migration names and digests are opaque, product-owned identifiers.  They
  // may legitimately contain words such as "create" or "delete"; applying
  // the SQL/prose filter to them would silently drop reconstructable history.
  if (containsForbiddenValue(value)) return undefined;
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
    const safe = redactEvidenceValue(key, value);
    if (safe !== undefined) result[key] = safe;
  }
  return result;
}

function redactEvidenceValue(key, value) {
  if (key === "applied") return redactApplied(value);
  if (key === "pending") return redactPending(value);
  if (key === "aggregateRowCounts") return redactRowCounts(value);
  return safeValue(key, value);
}

function redactApplied(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => redactRecord(entry, ["tag", "timestamp", "hash"]))
    .filter((entry) => entry?.tag && entry?.hash && entry?.timestamp !== undefined);
}

function redactPending(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => typeof entry === "string" ? { tag: entry } : redactRecord(entry, ["tag", "hash"]))
    .filter((entry) => entry?.tag);
}

function redactRowCounts(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => redactRecord(entry, ["metric", "count"]))
    .filter((entry) => entry?.metric && Number.isSafeInteger(entry?.count) && entry.count >= 0);
}

export function createMigrationEvidence(input = {}) {
  const ok = !["FAIL", "INCOMPLETE"].includes(input.status);
  const evidence = { ok, ...redactEvidence({ ...input, ok }) };
  if (Array.isArray(evidence.applied)) evidence.count = evidence.applied.length;
  return Object.freeze(evidence);
}

export function createPreflightFailureEvidence(input = {}) {
  const code = typeof input.code === "string" && /^[A-Z0-9_]+$/.test(input.code)
    ? input.code
    : "PREFLIGHT_FAILED";
  return createMigrationEvidence({
    schemaVersion: "neon-production-preflight-evidence.v1",
    operation: "verify",
    status: "FAIL",
    code,
    reasonCodes: [code],
    historyVariant: "original-production",
    applied: [],
    repository: input.repository,
    runId: input.runId,
    runSha: input.runSha,
    attestationBlobId: input.attestationBlobId,
    attestationFileSha256: input.attestationFileSha256,
  });
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
  if (JSON.stringify(evidence, (_key, value) => containsForbiddenValue(value) ? "__FORBIDDEN__" : value).includes("__FORBIDDEN__")) issues.push("secret or executable value forbidden");
  if (!["bootstrap", "apply", "verify"].includes(safe.operation)) issues.push("operation missing or invalid");
  if (!["APPLIED", "NOOP", "BOOTSTRAPPED", "PREFLIGHT_READY", "FAIL", "INCOMPLETE"].includes(safe.status)) issues.push("status missing or invalid");
  if (typeof safe.ok !== "boolean") issues.push("evidence ok flag missing");
  else if (["FAIL", "INCOMPLETE"].includes(safe.status) ? safe.ok : !safe.ok) issues.push("evidence status and ok flag mismatch");
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
    if (safe.applied?.length !== 18 || safe.pending?.map((entry) => entry.tag).join(",") !== "0018,0019,0020") issues.push("preflight suffix invalid");
    for (const entry of safe.pending ?? []) if (!MIGRATION_TAG.test(entry.tag) || !MIGRATION_HASH.test(entry.hash ?? "")) issues.push("pending migration record is incomplete");
    if (!SAFE_IDENTIFIER.test(safe.loginIdentifier ?? "") || safe.grantContract !== "product-suite-neon-preflight-reader-v1") issues.push("preflight role contract invalid");
    for (const field of ["grantContractSha256", "catalogDigest", "grantDigest"]) if (!MIGRATION_HASH.test(safe[field] ?? "")) issues.push(`${field} invalid`);
    for (const field of ["attestationFileSha256", "attestationCanonicalPayloadSha256", "sourceImmutableSha256"]) if (!MIGRATION_HASH.test(safe[field] ?? "")) issues.push(`${field} invalid`);
    if (!SHA.test(safe.runSha ?? "") || !SHA.test(safe.attestationBlobId ?? "")) issues.push("run or blob SHA invalid");
    for (const field of ["projectId", "branchId", "endpointId", "database", "schema", "signatureKeyId", "recoveryKind", "recoveryId", "recoverySourceBranchId"]) if (!SAFE_IDENTIFIER.test(safe[field] ?? "")) issues.push(`${field} invalid`);
    if (!/^[a-z0-9_.-]+\/[a-z0-9_.-]+$/i.test(safe.repository ?? "") || safe.runId === undefined) issues.push("run identity invalid");
    if (!['neon-control-plane-export', 'independently-signed-export'].includes(safe.proofSource) || !Number.isFinite(Date.parse(safe.sourceProducedAt)) || !Number.isFinite(Date.parse(safe.observedAt)) || !Number.isFinite(Date.parse(safe.expiresAt))) issues.push("attestation provenance invalid");
    if (safe.reasonCodes?.join(",") !== "PREFLIGHT_READY") issues.push("preflight reason invalid");
    if (safe.aggregateRowCounts?.length !== 1 || safe.aggregateRowCounts[0]?.metric !== "drizzle_migration_rows" || safe.aggregateRowCounts[0]?.count !== 18) issues.push("preflight row-count evidence invalid");
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
