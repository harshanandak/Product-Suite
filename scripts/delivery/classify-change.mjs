import { createHash } from "node:crypto";

const SCHEMA_VERSION = "delivery-classification.v1";
const CLASSIFIER_VERSION = "1.0.0";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const DEPENDENCY_FILES = new Set(["package.json", "bun.lock"]);

const T0_ALLOWLIST = [
  /^README\.md$/,
  /^docs\/(?!deployment\/)[^/]+(?:\/[^/]+)*\.md$/,
  /^\.editorconfig$/,
  /^\.markdownlint(?:-cli2)?(?:\.jsonc?|\.ya?ml)?$/,
  /^cspell\.json$/,
];

const TIER_POLICY = {
  T0: {
    expectedChecks: ["targeted", "dependency-security", "affected-build"],
    settleMinutes: 0,
  },
  T1: {
    expectedChecks: ["targeted", "dependency-security", "affected-build"],
    settleMinutes: 2,
  },
  T2: {
    expectedChecks: [
      "targeted",
      "dependency-security",
      "affected-build",
      "impacted-integration",
    ],
    settleMinutes: 5,
  },
  T3: {
    expectedChecks: [
      "targeted",
      "dependency-security",
      "affected-build",
      "impacted-integration",
      "security",
      "migration-integrity",
      "db-contract",
    ],
    settleMinutes: 10,
  },
};

const TIER_RANK = { T0: 0, T1: 1, T2: 2, T3: 3 };
const DB_RUNTIME_PACKAGES = new Set([
  "@neondatabase/serverless",
  "drizzle-orm",
  "kysely",
  "pg",
  "postgres",
]);

const isValidPath = (path) =>
  typeof path === "string" &&
  path.length > 0 &&
  !path.startsWith("/") &&
  !path.includes("\\") &&
  !path.split("/").includes("..");

const isDependencyFile = (path) =>
  DEPENDENCY_FILES.has(path) || path.endsWith("/package.json");

const isSensitiveOrAuthorityPath = (path) => {
  const lower = path.toLowerCase();

  return (
    lower === "agents.md" ||
    lower.startsWith(".forge/") ||
    lower.startsWith(".github/workflows/") ||
    lower.startsWith("scripts/delivery/") ||
    lower.startsWith("apps/platform-api/") ||
    lower.startsWith("packages/db/") ||
    lower.startsWith("docs/deployment/") ||
    /(^|\/)(auth|authentication|authorization|identity|tenant|security)([./_-]|\/|$)/.test(lower) ||
    /(^|\/)(migrations?|schema|neon|postgres|release|deploy)([./_-]|\/|$)/.test(lower)
  );
};

const workspaceForPath = (path) => {
  const parts = path.split("/");
  return parts.length >= 2 && ["apps", "packages", "services"].includes(parts[0])
    ? `${parts[0]}/${parts[1]}`
    : null;
};

const classifyPath = (path) => {
  if (isSensitiveOrAuthorityPath(path)) {
    return { tier: "T3", reason: "sensitive_or_authority_path" };
  }

  if (T0_ALLOWLIST.some((pattern) => pattern.test(path))) {
    return { tier: "T0", reason: "t0_allowlist" };
  }

  if (/^apps\/(meeting-web|roadmap-web|platform-web)\//.test(path)) {
    return { tier: "T1", reason: "bounded_leaf_workspace" };
  }

  if (
    /^packages\/(contracts|sdk|ui(?:-[^/]+)?)\//.test(path) ||
    /^services\/(agent-core|hocuspocus)\//.test(path) ||
    /^apps\/[^/]+-api\//.test(path)
  ) {
    return { tier: "T2", reason: "shared_or_api_behavior" };
  }

  return { tier: "T3", reason: "unknown_path" };
};

const digestFiles = (files) =>
  createHash("sha256")
    .update(files.length > 0 ? [...files].sort().join("\n") : "<invalid>")
    .digest("hex");

const dependencyDecision = (evidence, baseSha, headSha) => {
  if (evidence === undefined) {
    return { tier: "T3", reason: "dependency_proof_missing" };
  }

  if (evidence?.status !== "proven" || evidence.databaseRuntimeChanged !== false) {
    if (evidence?.status === "proven" && evidence.databaseRuntimeChanged === true) {
      return { tier: "T3", reason: "dependency_changes_db_runtime" };
    }
    return { tier: "T3", reason: "dependency_proof_invalid" };
  }

  if (evidence.baseSha !== baseSha || evidence.headSha !== headSha) {
    return { tier: "T3", reason: "dependency_proof_mismatch" };
  }

  if (evidence.packageManagerLifecycleChanged === true) {
    return { tier: "T3", reason: "dependency_changes_lifecycle" };
  }

  if (
    evidence.frozenLockConsistent !== true ||
    evidence.packageManagerLifecycleChanged !== false ||
    !Array.isArray(evidence.affectedWorkspaces) ||
    evidence.affectedWorkspaces.length === 0 ||
    evidence.affectedWorkspaces.some((workspace) => !isValidPath(`${workspace}/file`)) ||
    !Array.isArray(evidence.changedPackages) ||
    evidence.changedPackages.length === 0 ||
    evidence.changedPackages.some((packageName) => typeof packageName !== "string")
  ) {
    return { tier: "T3", reason: "dependency_proof_invalid" };
  }

  if (evidence.changedPackages.some((packageName) => DB_RUNTIME_PACKAGES.has(packageName))) {
    return { tier: "T3", reason: "dependency_proof_contradiction" };
  }

  const workspaceDecisions = evidence.affectedWorkspaces.map((workspace) =>
    classifyPath(`${workspace}/__dependency__`),
  );
  const highest = workspaceDecisions.reduce(
    (result, decision) => TIER_RANK[decision.tier] > TIER_RANK[result.tier] ? decision : result,
    { tier: "T0", reason: "dependency_closure_proven_safe" },
  );

  if (highest.tier === "T3") {
    return { tier: "T3", reason: "dependency_proof_invalid" };
  }

  if (highest.tier === "T1" && new Set(evidence.affectedWorkspaces).size > 1) {
    return { tier: "T2", reason: "dependency_closure_proven_safe" };
  }

  return { tier: highest.tier, reason: "dependency_closure_proven_safe" };
};

export const classifyChange = (input = {}) => {
  const rawFiles = Array.isArray(input.changedFiles) ? input.changedFiles : [];
  const filesValid = rawFiles.length > 0 && rawFiles.every(isValidPath);
  const files = filesValid ? [...new Set(rawFiles)].sort() : [];
  const reasons = [];
  const decisions = [];

  if (!Number.isInteger(input.pr) || input.pr <= 0) reasons.push("pr_invalid");
  if (!SHA_PATTERN.test(input.baseSha ?? "") || !SHA_PATTERN.test(input.headSha ?? "")) {
    reasons.push("exact_sha_invalid");
  }
  if (input.sourceEvidence?.status !== "ok") reasons.push("source_evidence_invalid");
  if (!filesValid) reasons.push("changed_files_invalid");

  for (const path of files.filter((file) => !isDependencyFile(file))) {
    decisions.push(classifyPath(path));
  }

  const dependencyFilesChanged = files.some(isDependencyFile);
  if (dependencyFilesChanged) {
    decisions.push(dependencyDecision(input.dependencyEvidence, input.baseSha, input.headSha));
  }

  const leafWorkspaces = new Set(
    files
      .filter((file) => !isDependencyFile(file))
      .map(workspaceForPath)
      .filter(Boolean),
  );
  if (
    leafWorkspaces.size > 1 &&
    decisions.length > 0 &&
    decisions.every((decision) => TIER_RANK[decision.tier] <= TIER_RANK.T1)
  ) {
    decisions.push({ tier: "T2", reason: "cross_workspace_behavior" });
  }

  for (const decision of decisions) reasons.push(decision.reason);

  const evidenceInvalid = reasons.some((reason) =>
    [
      "pr_invalid",
      "exact_sha_invalid",
      "source_evidence_invalid",
      "changed_files_invalid",
    ].includes(reason),
  );
  const tier = evidenceInvalid || decisions.length === 0
    ? "T3"
    : decisions.reduce(
      (highest, decision) => TIER_RANK[decision.tier] > TIER_RANK[highest] ? decision.tier : highest,
      "T0",
    );
  const policy = TIER_POLICY[tier];
  const expectedChecks = [...policy.expectedChecks];
  if (dependencyFilesChanged && !expectedChecks.includes("migration-integrity")) {
    expectedChecks.push("migration-integrity");
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    classifierVersion: CLASSIFIER_VERSION,
    pr: input.pr ?? null,
    baseSha: input.baseSha ?? null,
    headSha: input.headSha ?? null,
    changedFileDigest: digestFiles(files),
    tier,
    reasons: [...new Set(reasons.length > 0 ? reasons : ["unclassified_input"])],
    dependencyEvidence: dependencyFilesChanged
      ? (input.dependencyEvidence ?? { status: "missing" })
      : { status: "not_applicable" },
    expectedChecks,
    settleMinutes: policy.settleMinutes,
  };
};
