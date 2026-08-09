#!/usr/bin/env node

/**
 * Privacy-safe migration evidence helpers.  Evidence is an allow-list, not a
 * log scrubber: values that are not useful to reconstruct the decision are
 * discarded before they can reach stdout or the Forge record.
 */
const ALLOWED_KEYS = new Set([
  "ok",
  "operation",
  "status",
  "historyVariant",
  "expectedFloor",
  "expectedCount",
  "projectId",
  "branchId",
  "deploymentId",
  "tag",
  "timestamp",
  "hash",
  "count",
  "pending",
]);

const SECRET_KEY = /(url|password|secret|token|credential|username|user|sql|query|row|payload|content|error|message|claim|prompt|embedding)/i;

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
    if (key === "pending") return value.every((entry) => typeof entry === "string") ? [...value] : undefined;
    if (key === "applied" || key === "migrations") return value.map((entry) => safeValue("migration", entry)).filter(Boolean);
    return undefined;
  }
  if (!isSafeScalar(value)) return undefined;
  // Migration names and digests are opaque, product-owned identifiers.  They
  // may legitimately contain words such as "create" or "delete"; applying
  // the SQL/prose filter to them would silently drop reconstructable history.
  if (key !== "tag" && key !== "hash" && typeof value === "string" && /(postgres(?:ql)?|https?:\/\/|@|BEGIN|ALTER|CREATE|INSERT|UPDATE|DELETE|DROP)/i.test(value)) return undefined;
  return value;
}

/** Return only the privacy-safe, reconstructable evidence fields. */
export function redactEvidence(input = {}) {
  const result = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "applied" || key === "migrations") {
      const entries = Array.isArray(value) ? value.map((entry) => redactEvidence(entry)).filter((entry) => entry.tag && entry.hash && entry.timestamp !== undefined) : [];
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
  if (!["bootstrap", "apply", "verify"].includes(safe.operation)) issues.push("operation missing or invalid");
  if (!["APPLIED", "NOOP", "BOOTSTRAPPED"].includes(safe.status)) issues.push("status missing or invalid");
  if (!["original-production", "repaired-bootstrap"].includes(safe.historyVariant)) issues.push("history variant missing or invalid");
  if (!Array.isArray(safe.applied)) issues.push("applied migration records missing");
  for (const entry of safe.applied ?? []) {
    if (typeof entry.tag !== "string" || typeof entry.hash !== "string" || !/^[a-f0-9]{64}$/i.test(entry.hash) || typeof entry.timestamp !== "number") issues.push("applied migration record is incomplete");
  }
  if (safe.expectedCount !== undefined && safe.expectedCount !== safe.applied?.length) issues.push("migration count mismatch");
  if (safe.count !== undefined && safe.count !== safe.applied?.length) issues.push("evidence count mismatch");
  if (safe.expectedFloor !== undefined && !migrationFloorMatches(safe.applied?.at(-1)?.tag, safe.expectedFloor)) issues.push("evidence floor mismatch");
  if (safe.status === "NOOP" && Array.isArray(safe.pending) && safe.pending.length > 0) issues.push("NOOP evidence has pending migrations");
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
