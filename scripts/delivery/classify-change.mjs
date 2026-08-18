import { createHash } from "node:crypto";

const SCHEMA_VERSION = "delivery-classification.v1";
const CLASSIFIER_VERSION = "1.0.0";
const SHA_PATTERN = /^[a-f0-9]{40}$/i;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const ROOT_DEPENDENCY_FILES = new Set(["package.json", "bun.lock"]);
const ROADMAP_API_DOCUMENTATION_PATTERN = /^apps\/roadmap-web\/src\/app\/api(?:\/[^/]+)*\/(?:agents|claude)\.md$/i;

const T0_ALLOWLIST = [
  /^README\.md$/,
  /^docs\/(?!deployment\/)[^/]+(?:\/[^/]+)*\.md$/,
  ROADMAP_API_DOCUMENTATION_PATTERN,
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
const DEPENDENCY_WORKSPACES = new Set([
  "apps/meeting-web",
  "apps/roadmap-web",
  "apps/platform-web",
  "apps/platform-api",
  "packages/db",
  "packages/contracts",
  "packages/sdk",
  "packages/ui",
  "packages/ui-chat",
  "packages/ui-canvas",
  "packages/ui-meeting",
  "packages/ui-planning",
  "packages/ui-charting",
  "services/agent-core",
  "services/hocuspocus",
]);
const T1_WORKSPACES = new Set(["apps/meeting-web", "apps/roadmap-web", "apps/platform-web"]);
const T2_WORKSPACES = new Set([
  "apps/meeting-api",
  "packages/contracts",
  "packages/sdk",
  "packages/ui",
  "packages/ui-chat",
  "packages/ui-canvas",
  "packages/ui-meeting",
  "packages/ui-planning",
  "packages/ui-charting",
  "services/agent-core",
  "services/hocuspocus",
]);
const CLASSIFIABLE_WORKSPACES = new Set([...DEPENDENCY_WORKSPACES, "apps/meeting-api"]);
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/;
const AUTHORITY_CONFIG_PATTERN = /(?:^|\/)(?:\.env(?:\.[^/]*)?|\.dev\.vars(?:\.[^/]*)?|\.npmrc|\.pnpmfile\.[^/]+|\.yarnrc(?:\.[^/]+)?|bunfig\.toml|(?:eslint|next|playwright(?:\.harness)?|postcss|tailwind|vite|vitest)\.config\.[^/]+|(?:js|ts)config(?:\.[^/]*)?\.json|config\.(?:json|toml|ya?ml|py|[cm]?js|ts)|Dockerfile(?:\.[^/]*)?|docker-compose(?:\.[^/]*)?\.ya?ml|(?:fly|netlify|railway|render)\.(?:json|toml|ya?ml)|vercel\.jsonc?|wrangler\.(?:jsonc?|toml)|runtime[-_.]?config(?:\.[^/]*)?)$/i;
const SENSITIVE_PACKAGE_PATTERNS = [
  /^@neondatabase(?:\/|$)/,
  /^@better-auth(?:\/|$)/,
  /^better-auth$/,
  /^@auth(?:\/|$)/,
  /^drizzle(?:-|$)/,
  /^@drizzle-team(?:\/|$)/,
  /^kysely(?:-|$)/,
  /^@prisma(?:\/|$)/,
  /^prisma$/,
  /^@(?:types\/)?pg(?:-|$)/,
  /^pg(?:-|$)/,
  /^postgres(?:-|$)/,
  /^@vercel\/postgres$/,
  /^@supabase\/(?:auth|postgres)(?:-|\/|$)/,
];

const compareCodeUnits = (left, right) => {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
};

const hasInvalidPathSyntax = (path) =>
  path.length === 0 || path.startsWith("/") || path.includes("\\") || CONTROL_CHARACTER_PATTERN.test(path);

const isValidPath = (path) => {
  if (typeof path !== "string" || hasInvalidPathSyntax(path)) return false;
  return path.split("/").every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const isDependencyFile = (path) =>
  ROOT_DEPENDENCY_FILES.has(path) ||
  path.endsWith("/package.json") ||
  path.endsWith("/bun.lock");

const dependencyWorkspaceForPath = (path) => {
  if (ROOT_DEPENDENCY_FILES.has(path)) return null;
  const match = /^(apps|packages|services)\/([^/]+)\/(?:package\.json|bun\.lock)$/.exec(path);
  if (!match) return undefined;
  const workspace = `${match[1]}/${match[2]}`;
  return DEPENDENCY_WORKSPACES.has(workspace) ? workspace : undefined;
};

const isRootAuthorityPath = (lower) => [
  lower === "agents.md",
  lower.startsWith(".forge/"),
  lower.startsWith(".github/workflows/"),
  lower.startsWith("scripts/delivery/"),
  lower.startsWith("apps/platform-api/"),
  lower.startsWith("apps/roadmap-web/src/app/api/"),
  lower.startsWith("packages/db/"),
  lower === "docs/deployment.md",
  lower.startsWith("docs/deployment/"),
].some(Boolean);

const isSensitiveNamePath = (lower) => [
  /(^|\/)(auth|authentication|authorization|identity|tenant|security)([./_-]|\/|$)/,
  /(^|\/)(migrations?|schema|neon|postgres|release|deploy)([./_-]|\/|$)/,
].some((pattern) => pattern.test(lower));

const isSensitiveOrAuthorityPath = (path) => {
  if (ROADMAP_API_DOCUMENTATION_PATTERN.test(path)) return false;
  const lower = path.toLowerCase();
  return isRootAuthorityPath(lower) || AUTHORITY_CONFIG_PATTERN.test(lower) || isSensitiveNamePath(lower);
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

  const workspace = workspaceForPath(path);
  if (!workspace || !CLASSIFIABLE_WORKSPACES.has(workspace)) {
    return { tier: "T3", reason: "unknown_path" };
  }

  if (T1_WORKSPACES.has(workspace)) {
    return { tier: "T1", reason: "bounded_leaf_workspace" };
  }

  if (T2_WORKSPACES.has(workspace)) {
    return { tier: "T2", reason: "shared_or_api_behavior" };
  }

  return { tier: "T3", reason: "unknown_path" };
};

const digestFiles = (files) =>
  createHash("sha256")
    .update(files.length > 0 ? JSON.stringify([...files].sort(compareCodeUnits)) : "<invalid>")
    .digest("hex");

const isValidPackageName = (packageName) =>
  typeof packageName === "string" &&
  packageName.length <= 214 &&
  PACKAGE_NAME_PATTERN.test(packageName);

const hasUniqueValues = (values) => new Set(values).size === values.length;

const isValidWorkspaceList = (workspaces) =>
  Array.isArray(workspaces) &&
  workspaces.length > 0 &&
  workspaces.every((workspace) => DEPENDENCY_WORKSPACES.has(workspace)) &&
  hasUniqueValues(workspaces);

const isValidPackageList = (packages) =>
  Array.isArray(packages) &&
  packages.length > 0 &&
  packages.every(isValidPackageName) &&
  hasUniqueValues(packages);

const isSensitiveDependencyPackage = (packageName) =>
  SENSITIVE_PACKAGE_PATTERNS.some((pattern) => pattern.test(packageName));

const dependencyStatusReason = (evidence, baseSha, headSha) => {
  if (evidence === undefined) return "dependency_proof_missing";
  if (evidence?.status !== "proven" || evidence.databaseRuntimeChanged !== false) {
    return evidence?.status === "proven" && evidence.databaseRuntimeChanged === true
      ? "dependency_changes_db_runtime"
      : "dependency_proof_invalid";
  }
  if (evidence.baseSha !== baseSha || evidence.headSha !== headSha) {
    return "dependency_proof_mismatch";
  }
  if (evidence.packageManagerLifecycleChanged === true) return "dependency_changes_lifecycle";
  return null;
};

const dependencyShapeReason = (evidence) => {
  const validShape =
    evidence.frozenLockConsistent === true &&
    evidence.packageManagerLifecycleChanged === false &&
    isValidWorkspaceList(evidence.affectedWorkspaces) &&
    isValidPackageList(evidence.changedPackages);
  return validShape ? null : "dependency_proof_invalid";
};

const dependencyCatalogReason = (catalog, baseSha, headSha) => {
  const validCatalog =
    catalog?.schemaVersion === "delivery-dependency-catalog.v1" &&
    isValidWorkspaceList(catalog.workspaceRoots) &&
    isValidPackageList(catalog.packageNames);
  if (!validCatalog) return "dependency_catalog_invalid";
  return catalog.baseSha === baseSha && catalog.headSha === headSha
    ? null
    : "dependency_catalog_mismatch";
};

const dependencySubsetReason = (evidence, catalog) => {
  const catalogWorkspaces = new Set(catalog.workspaceRoots);
  const catalogPackages = new Set(catalog.packageNames);
  if (evidence.affectedWorkspaces.some((workspace) => !catalogWorkspaces.has(workspace))) {
    return "dependency_workspace_unresolved";
  }
  if (evidence.changedPackages.some((packageName) => !catalogPackages.has(packageName))) {
    return "dependency_package_unresolved";
  }
  return null;
};

const hasDependencyContradiction = (evidence, catalog) =>
  [...evidence.changedPackages, ...catalog.packageNames].some(isSensitiveDependencyPackage);

const highestWorkspaceDecision = (workspaces) =>
  workspaces
    .map((workspace) => classifyPath(`${workspace}/__dependency__`))
    .reduce(
      (highest, decision) => TIER_RANK[decision.tier] > TIER_RANK[highest.tier] ? decision : highest,
      { tier: "T0", reason: "dependency_closure_proven_safe" },
    );

const dependencyDecision = (evidence, baseSha, headSha, dependencyWorkspaces) => {
  const statusReason = dependencyStatusReason(evidence, baseSha, headSha);
  if (statusReason) return { tier: "T3", reason: statusReason };

  const shapeReason = dependencyShapeReason(evidence);
  if (shapeReason) return { tier: "T3", reason: shapeReason };
  if (dependencyWorkspaces.some((workspace) => !evidence.affectedWorkspaces.includes(workspace))) {
    return { tier: "T3", reason: "dependency_manifest_workspace_unresolved" };
  }

  const catalog = evidence.dependencyCatalog;
  const catalogReason = dependencyCatalogReason(catalog, baseSha, headSha);
  if (catalogReason) return { tier: "T3", reason: catalogReason };

  const subsetReason = dependencySubsetReason(evidence, catalog);
  if (subsetReason) return { tier: "T3", reason: subsetReason };
  if (hasDependencyContradiction(evidence, catalog)) {
    return { tier: "T3", reason: "dependency_proof_contradiction" };
  }

  const highest = highestWorkspaceDecision(evidence.affectedWorkspaces);
  if (highest.tier === "T3") return { tier: "T3", reason: "dependency_proof_invalid" };
  if (highest.tier === "T1" && evidence.affectedWorkspaces.length > 1) {
    return { tier: "T2", reason: "dependency_closure_proven_safe" };
  }
  return { tier: highest.tier, reason: "dependency_closure_proven_safe" };
};

const classifyChangedFile = (path) => {
  if (!isDependencyFile(path) || isSensitiveOrAuthorityPath(path)) {
    return { decision: classifyPath(path) };
  }

  const dependencyWorkspace = dependencyWorkspaceForPath(path);
  if (dependencyWorkspace === undefined) {
    return { decision: { tier: "T3", reason: "unknown_dependency_path" } };
  }
  return { dependencyWorkspace };
};

const inputEvidenceReasons = (input, filesValid) => [
  !Number.isInteger(input.pr) || input.pr <= 0 ? "pr_invalid" : null,
  !SHA_PATTERN.test(input.baseSha ?? "") || !SHA_PATTERN.test(input.headSha ?? "")
    ? "exact_sha_invalid"
    : null,
  input.sourceEvidence?.status !== "ok" ? "source_evidence_invalid" : null,
  !filesValid ? "changed_files_invalid" : null,
].filter(Boolean);

export const classifyChange = (input = {}) => {
  const changeInput = input && typeof input === "object" ? input : {};
  const rawFiles = Array.isArray(changeInput.changedFiles) ? changeInput.changedFiles : [];
  const filesValid = rawFiles.length > 0 && rawFiles.every(isValidPath);
  const files = filesValid ? [...new Set(rawFiles)].sort(compareCodeUnits) : [];
  const reasons = [];
  const decisions = [];
  const dependencyWorkspaces = new Set();

  reasons.push(...inputEvidenceReasons(changeInput, filesValid));

  for (const path of files) {
    const classified = classifyChangedFile(path);
    if (classified.decision) decisions.push(classified.decision);
    if (classified.dependencyWorkspace) dependencyWorkspaces.add(classified.dependencyWorkspace);
  }

  const dependencyFilesChanged = files.some(isDependencyFile);
  if (dependencyFilesChanged) {
    decisions.push(dependencyDecision(
      changeInput.dependencyEvidence,
      changeInput.baseSha,
      changeInput.headSha,
      [...dependencyWorkspaces],
    ));
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
    pr: changeInput.pr ?? null,
    baseSha: changeInput.baseSha ?? null,
    headSha: changeInput.headSha ?? null,
    changedFileDigest: digestFiles(files),
    tier,
    reasons: [...new Set(reasons.length > 0 ? reasons : ["unclassified_input"])],
    dependencyEvidence: dependencyFilesChanged
      ? (changeInput.dependencyEvidence ?? { status: "missing" })
      : { status: "not_applicable" },
    expectedChecks,
    settleMinutes: policy.settleMinutes,
  };
};
