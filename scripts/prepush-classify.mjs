// Pre-push gate classification — the PURE core of `scripts/prepush-gate.mjs`.
//
// Everything here is a function of its arguments plus the repo's package
// manifests: no git, no env, no process spawning, no exit codes. That is the
// point of the split. The gate's own self-test asserts this logic on dozens of
// file-list fixtures, and when the logic could only be reached by executing the
// CLI, each assertion paid a full runtime cold start (~1-2s on Windows). One
// test making four such calls exceeded bun's default 5000ms per-test timeout
// whenever the machine was busy — including inside a real `git push`, where the
// gate runs this suite as one of 18 sequential suites. The gate could then
// abort a perfectly good push because its own test ran slowly.
//
// So the classifier is importable and tested in-process (microseconds, no
// ambient state), and `prepush-gate.mjs` keeps only the impure shell: reading
// the git diff, the env toggles, printing, and running the suites.
//
// Classification (each step only ever NARROWS, never hides work it cannot prove
// is irrelevant):
//   docs-only      → fast checks only (source/test coupling).
//   cross-cutting  → the FULL suite (root manifest, tooling, CI, infra, deploy
//                    config, or any file we cannot attribute to a workspace).
//   scoped         → the suites for the changed workspaces + every workspace that
//                    (transitively) depends on them, computed from the
//                    `workspace:*` dependency graph, plus the always-on cheap
//                    checks. This is what lets a platform-web-only change run only
//                    platform-web's verify suite instead of the whole monorepo.
//   unknown range  → the FULL suite (no upstream to diff against, empty set).
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Documentation/design paths — never trigger a build/test suite.
const DOCS_ONLY = [
  /^docs\//,
  /^DESIGN\.md$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^AGENTS\.md$/,
  /^\.sonarcloud\.properties$/,
  /^\.claude\//,
];

// Cross-cutting / infra paths that force the FULL suite — a change here can
// affect any workspace, so narrowing would be unsafe.
const GLOBAL_FULL = [
  /^package\.json$/, // root manifest: scripts, shared deps, overrides
  /^bunfig\.toml$/,
  /^tsconfig[^/]*\.json$/, // root TS config
  /^lefthook\.ya?ml$/,
  /^eslint\.config\.[cm]?[jt]s$/,
  /^\.github\//,
  /^infra\//, // DB migrations / infra
  /(^|\/)vercel\.json$/, // deploy config (not exercised by the ci suites)
  /(^|\/)wrangler\.(toml|jsonc?)$/,
  // A lockfile re-resolve (bun add/update, a transitive bump) can change the
  // resolved dependency tree of ANY workspace — even ones whose package.json did
  // not change — so a bun.lock change cannot be safely narrowed to one workspace.
  /^bun\.lock$/,
];

// Workspace dir -> the suite script(s) that validate it. The keys are the full
// set of dirs a changed file can be attributed to (incl. the Python meeting-api,
// which is not a bun workspace but still has a suite).
export const SUITES = {
  // Apps map to their no-build "verify" script (lint + typecheck + test). The
  // BUILD step is deliberately NOT run here — every app is built by its own CI
  // workflow on pull_request (the merge gate), so building locally on push is
  // pure duplication and the slowest step. meeting-api has no build (Python), so
  // its ci:* is already build-free.
  "apps/platform-web": ["verify:platform-web"],
  "apps/platform-api": ["verify:platform-api"],
  "apps/meeting-web": ["verify:meeting-web"],
  // Matches CI, which has no roadmap-web lint/typecheck job. See #137.
  "apps/roadmap-web": ["test:roadmap-canvas-boundary"],
  "apps/meeting-api": ["ci:meeting-api"],
  "packages/contracts": ["test:contracts"],
  "packages/db": ["verify:db"],
  "packages/sdk": ["test:sdk"],
  "packages/ui": ["test:ui"],
  "packages/ui-chat": ["test:ui-chat"],
  "packages/ui-canvas": ["test:ui-canvas"],
  "packages/ui-meeting": ["test:ui-meeting"],
  "packages/ui-planning": ["test:ui-planning"],
  "packages/ui-charting": ["test:ui-charting"],
  "services/agent-core": ["test:agent-core"],
  "services/hocuspocus": ["test:hocuspocus"],
};

// Cheap cross-cutting checks run for ANY code push (cannot be narrowed away).
const ALWAYS = ["check:source-test", "test:repo-tooling"];

// Non-workspace path prefixes that are repo tooling, already exercised by the
// always-on `test:repo-tooling` check — a change here needs the tooling tests,
// NOT every app's suite. (Verified: no workspace build/test script imports from
// `scripts/`, so narrowing these away cannot under-test an app.)
const TOOLING_PREFIXES = ["scripts/", "test/"];

export const WORKSPACE_DIRS = Object.keys(SUITES);

export const DOCS = "docs-only";
export const FULL = "full-suite";
export const SCOPED = "scoped";

export const FAST_NOTE = "mode: fast (lint+typecheck only, tests deferred to CI)";
export const CI_PLAN_SCHEMA_VERSION = "ci-change-plan.v1";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const ROADMAP_API_CLAUDE_PATTERN =
  /^apps\/roadmap-web\/src\/app\/api(?:\/[^/]+)*\/claude\.md$/i;

// CI-impacting paths are intentionally owned by this module rather than by a
// second set of workflow regexes.  The normal pre-push classifier remains
// backwards-compatible; the CI plan adds the stricter DB-authority boundary.
const CI_DB_REQUIRED = [
  /(^|\/)package\.json$/i,
  /^apps\/platform-api(?:\/|$)/,
  /^packages\/db(?:\/|$)/,
  /^apps\/meeting-api\/backend\/(?:tenant_context|db|config|server|settings|migrate)\.py$/i,
  /^apps\/meeting-api\/backend\/(?:repositories|routes|alembic)(?:\/|$)/i,
  /^apps\/roadmap-web\/src\/(?:middleware\.ts|lib\/supabase(?:\/|$))/i,
  /^apps\/roadmap-web\/src\/lib\/ai(?:\/|$)/i,
  /^apps\/roadmap-web\/supabase(?:\/|$)/i,
  /^apps\/roadmap-web\/scripts\/upgrade-user-to-pro\.ts$/i,
  /^apps\/roadmap-web\/src\/app\/api(?:\/|$)/i,
  /^apps\/roadmap-web\/src\/app\/(?:\(dashboard\)|\(auth\))(?:\/|$)/i,
  /^apps\/meeting-web\/src\/lib\/api\.js$/i,
  /^apps\/meeting-web\/src\/hooks\/use(?:BuddyAgent|MeetingState|RealtimeTranscript)\.js$/,
  /^apps\/platform-web\/src\/(?:AppRoot\.tsx|fixtures-mode\.ts)$/i,
  /^apps\/platform-web\/src\/data(?:\/|$)/i,
  /^packages\/contracts\/src(?:\/|$)/i,
  /^docs\/history\/database-migrations\/manifest\.json$/i,
  /^infra\//,
  /(^|\/)migrations?(?:\/|$)/i,
  /^security(?:\/|$)/i,
  /(^|\/)(?:auth|authorization|security|secrets?)(?:\/|[._-]|$)/i,
  /^\.github\//,
  /^\.sonarcloud\.properties$/,
  // Delivery classifiers and security-routing helpers can change the impact
  // decision itself, so the whole family is DB-required even when the file is
  // otherwise repo tooling.
  /^scripts\/delivery(?:\/|$)/i,
  // Fail closed on authority-bearing path segments and filename keywords. The
  // separators include `_`, `.`, and `-` so tenant_context.py/auth.d.ts are
  // covered without treating unrelated words such as oauth as auth.
  /(?:^|[/_.-])(?:tenant|tenants|identity|identities|access|permission|permissions|authorization|auth|security|secrets?)(?=$|[/_.-])/i,
  // Camel-case authority modules do not have a path separator after `auth`.
  /[Aa]uth[A-Z]/,
  // Security authority can be embedded in compound names rather than an
  // `auth` segment. Keep these matchers explicit so design tokens and
  // non-auth application sessions do not acquire DB proof.
  /(?:^|[/_.-])(?:oauth|oidc)(?=$|[/_.-])/i,
  /(?:^|[/_.-])by[-_]tokens?(?=$|[/_.-])/i,
  /(?:^|[/_.-])workos[-_]sessions?(?=$|[/_.-])/i,
  /^scripts\/.*(?:authority|security|secret|migration|neon|db-contract|preflight).*$/i,
  /^scripts\/(?:prepush-|ci-).*/i,
  /^scripts\/check-(?:source-test(?:-coupling)?|historical-db-artifacts|migration-parity|database-authority|worker-secrets)(?:\.mjs)?$/i,
  /^scripts\/migrate-database\.mjs$/i,
  /^scripts\/(?:provision-database-roles|database-pool)\.mjs$/i,
];

export function isValidSha(value) {
  return typeof value === "string" && SHA_PATTERN.test(value.trim());
}

function normalizedFiles(files) {
  if (!Array.isArray(files)) return files;
  return files.map((file) =>
    typeof file === "string" ? file.trim().replaceAll("\\", "/").replace(/^\.\//, "") : String(file),
  );
}

export function ciDbEvidenceRequired(files, result = classify(files)) {
  if (result.kind === FULL || result.kind === SCOPED && files === null) return true;
  if (!Array.isArray(files) || files.length === 0) return true;
  if (result.kind === DOCS) {
    return files.some((file) =>
      /^docs\/history\/database-migrations\/manifest\.json$/i.test(file)
      || /^\.sonarcloud\.properties$/.test(file),
    );
  }
  return files.some(
    (file) =>
      !ROADMAP_API_CLAUDE_PATTERN.test(file) &&
      CI_DB_REQUIRED.some((pattern) => pattern.test(file)),
  );
}

function ciClassification(files, result) {
  if (ciDbEvidenceRequired(files, result) && result.kind !== FULL) return FULL;
  return result.kind;
}

/**
 * Build the deterministic plan consumed by the CI workflow.  Existing
 * classify()/describeClassification() callers intentionally remain unchanged.
 * The second argument accepts either a SHA string or an options object so the
 * pure API is convenient for both tests and the CLI adapter.
 */
export function buildCiPlan(filesOrOptions, exactSha) {
  let options;
  if (Array.isArray(filesOrOptions) || filesOrOptions === null) {
    options = { files: filesOrOptions, exactSha };
  } else {
    options = filesOrOptions ?? {};
  }
  const files = normalizedFiles(options.files ?? null);
  const requestedSha = options.exactSha ?? options.headSha ?? options.head;
  const validSha = isValidSha(requestedSha);
  const result = classify(files);
  const dbEvidenceRequired = !validSha || ciDbEvidenceRequired(files, result);
  const classification = !validSha ? FULL : ciClassification(files, result);
  let reason = result.reason ?? "scoped changed workspace";
  if (!validSha) reason = "invalid exact head SHA";
  else if (classification === FULL && result.kind !== FULL) reason = "authority/security/migration/CI change";

  let cheapScripts;
  if (classification === DOCS) {
    cheapScripts = ["check:source-test"];
  } else {
    const affectedWorkspaces = classification === FULL ? new Set(WORKSPACE_DIRS) : affectedDirsFor(result);
    cheapScripts = suitesFor(affectedWorkspaces);
    if (dbEvidenceRequired) {
      cheapScripts = cheapScripts.map((script) =>
        script === "test:roadmap-canvas-boundary" ? "verify:roadmap-web" : script,
      );
    }
  }

  return {
    schemaVersion: CI_PLAN_SCHEMA_VERSION,
    exactSha: validSha ? requestedSha.trim().toLowerCase() : null,
    inputValid: validSha,
    classification,
    reason,
    cheapScripts,
    dbEvidenceRequired,
    dbEvidenceReason: dbEvidenceRequired ? "authority/security/migration or ambiguous change" : "non-authority change",
  };
}

function readJSON(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Internal (workspace:*) dependency names declared by a package manifest.
// Spreading an undefined deps field is a no-op, so no `|| {}` guards are needed.
function workspaceDepNames(pkg) {
  const deps = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies };
  return Object.entries(deps)
    .filter(([, range]) => typeof range === "string" && range.startsWith("workspace:"))
    .map(([name]) => name);
}

// Reverse dependency graph: dir -> set of dirs that depend on it. Internal
// dependencies are declared with a `workspace:` version range, so the graph is
// derived from the manifests at runtime (no hand-maintained list to drift).
function buildDependents() {
  const nameToDir = new Map();
  const pkgByDir = new Map();
  for (const dir of WORKSPACE_DIRS) {
    const pkg = readJSON(path.join(REPO_ROOT, dir, "package.json"));
    if (!pkg) continue; // the Python meeting-api has no package.json
    if (pkg.name) nameToDir.set(pkg.name, dir);
    pkgByDir.set(dir, pkg);
  }
  const dependents = new Map(WORKSPACE_DIRS.map((d) => [d, new Set()]));
  for (const [dir, pkg] of pkgByDir) {
    for (const name of workspaceDepNames(pkg)) {
      const depDir = nameToDir.get(name);
      if (depDir) dependents.get(depDir).add(dir);
    }
  }
  return dependents;
}

// changed dirs + every dir that transitively depends on them.
function withDependents(dirs, dependents) {
  const affected = new Set(dirs);
  const stack = [...dirs];
  while (stack.length > 0) {
    const current = stack.pop();
    for (const dependent of dependents.get(current) ?? []) {
      if (!affected.has(dependent)) {
        affected.add(dependent);
        stack.push(dependent);
      }
    }
  }
  return affected;
}

// Longest workspace-dir prefix that owns a file, or null (root / unowned).
function ownerDir(file) {
  let best = null;
  for (const dir of WORKSPACE_DIRS) {
    if ((file === dir || file.startsWith(`${dir}/`)) && (!best || dir.length > best.length)) {
      best = dir;
    }
  }
  return best;
}

// Attribute every non-docs file to an owning workspace. Returns the owner set,
// or null if any file cannot be attributed (a root-level unknown → full suite).
function collectOwners(files) {
  const owners = new Set();
  for (const f of files) {
    if (DOCS_ONLY.some((re) => re.test(f))) continue; // docs riding along
    // Repo tooling (scripts/, test/) is covered by the always-on test:repo-tooling
    // check — skip it as an owner rather than treating it as an unscoped file.
    if (TOOLING_PREFIXES.some((prefix) => f.startsWith(prefix))) continue;
    const dir = ownerDir(f);
    if (!dir) return null;
    owners.add(dir);
  }
  return owners;
}

// The deduped, ordered suite list for a set of affected workspace dirs, prefixed
// with the always-on cheap checks.
export function suitesFor(affected) {
  const suites = [...ALWAYS];
  for (const dir of WORKSPACE_DIRS) {
    if (!affected.has(dir)) continue;
    for (const s of SUITES[dir]) if (!suites.includes(s)) suites.push(s);
  }
  return suites;
}

export function classify(files) {
  if (files === null) return { kind: FULL, reason: "no upstream to diff against" };
  if (files.length === 0) return { kind: FULL, reason: "empty change set" };
  if (files.every((f) => DOCS_ONLY.some((re) => re.test(f)))) {
    return { kind: DOCS, reason: "docs/design only" };
  }
  if (files.some((f) => GLOBAL_FULL.some((re) => re.test(f)))) {
    return { kind: FULL, reason: "cross-cutting/infra change" };
  }
  const owners = collectOwners(files);
  if (owners === null) return { kind: FULL, reason: "unscoped file" };
  const affected = withDependents(owners, buildDependents());
  return { kind: SCOPED, suites: suitesFor(affected), owners: [...owners], affected: [...affected] };
}

// Which gate steps a workspace's MAPPED suite actually runs. This is read from the
// effective `verify:*`/`test:*` scripts (not the raw package.json), because a
// workspace can declare a `lint` script that its bundled verify deliberately omits
// The effective gate is the honest signal for "is lint part of this workspace's
// local safety net". Detected by looking for `--cwd <dir> <step>` in the resolved
// root script strings.
function suiteSteps(dir, rootScripts) {
  const blob = (SUITES[dir] ?? []).map((s) => rootScripts[s] ?? s).join(" && ");
  const runs = (step) => blob.includes(`--cwd ${dir} ${step}`);
  return { lint: runs("lint"), typecheck: runs("typecheck"), test: runs("test") };
}

// FAST mode (mirrors `forge push --quick`): lint + typecheck locally, with the
// CI-covered test step deferred. Workspaces without lint keep their full suite
// because tests are their only local safety net. Returns ordered { label, argv }
// descriptors (argv passed after `bun`). Always-on cheap checks come first, exactly
// as the full path prefixes them; branch protection (a separate push-hook step) is
// untouched.
export function fastChecksFor(affected) {
  const rootScripts = readJSON(path.join(REPO_ROOT, "package.json"))?.scripts ?? {};
  const checks = [];
  const seen = new Set();
  const add = (label, argv) => {
    if (seen.has(label)) return;
    seen.add(label);
    checks.push({ label, argv });
  };
  for (const name of ALWAYS) add(name, ["run", name]);
  for (const dir of WORKSPACE_DIRS) {
    if (!affected.has(dir)) continue;
    const steps = suiteSteps(dir, rootScripts);
    if (steps.lint) {
      // lint-gated workspace: lint (+ typecheck if gated), defer test to CI.
      add(`${dir}:lint`, ["run", "--cwd", dir, "lint"]);
      if (steps.typecheck) add(`${dir}:typecheck`, ["run", "--cwd", dir, "typecheck"]);
    } else {
      // no lint step → tests are the primary local gate: keep the full suite.
      for (const s of SUITES[dir]) add(s, ["run", s]);
    }
  }
  return checks;
}

// The affected workspace-dir set a result implies: the computed set for a scoped
// push, every workspace for a full push. (Docs-only never reaches here.)
export function affectedDirsFor(result) {
  return result.kind === SCOPED ? new Set(result.affected) : new Set(WORKSPACE_DIRS);
}

// The dry-run report for a classification: exactly what the gate prints under
// PREPUSH_GATE_DRY=1. Kept here, next to the logic it describes, so the self-test
// can assert the operator-visible report without executing the CLI.
export function describeClassification(result, { fast = false } = {}) {
  // Docs-only stays on the fast path regardless of fast mode — nothing to narrow.
  if (result.kind === DOCS) return `classification: ${result.kind}`;
  if (fast) {
    const checks = fastChecksFor(affectedDirsFor(result));
    return [
      `classification: ${result.kind}`,
      FAST_NOTE,
      `fast checks: ${checks.map((c) => c.label).join(", ")}`,
    ].join("\n");
  }
  if (result.kind === SCOPED) {
    return ["classification: scoped", `suites: ${result.suites.join(", ")}`].join("\n");
  }
  return `classification: ${result.kind}`;
}
