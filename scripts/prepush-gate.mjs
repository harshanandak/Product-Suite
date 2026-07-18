#!/usr/bin/env node
// Pre-push gate: run only the validation suites a push actually affects.
//
// Philosophy: the pre-push hook is for FAST local feedback (lint + typecheck +
// unit tests). It does NOT build apps — every app is built and tested by its own
// CI workflow on pull_request, which is the real merge gate, so building locally
// on every push only duplicates CI's slowest step. A build-only break is caught
// by CI before merge, not here.
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
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
const SUITES = {
  // Apps map to their no-build "verify" script (lint + typecheck + test). The
  // BUILD step is deliberately NOT run here — every app is built by its own CI
  // workflow on pull_request (the merge gate), so building locally on push is
  // pure duplication and the slowest step. meeting-api has no build (Python), so
  // its ci:* is already build-free.
  "apps/platform-web": ["verify:platform-web"],
  "apps/platform-api": ["verify:platform-api"],
  "apps/meeting-web": ["verify:meeting-web"],
  "apps/roadmap-web": ["verify:roadmap-web", "test:roadmap-canvas-boundary"],
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

const WORKSPACE_DIRS = Object.keys(SUITES);

const DOCS = "docs-only";
const FULL = "full-suite";
const SCOPED = "scoped";

function git(args) {
  // PATH lookup is intended: this is a local git hook running in a dev shell.
  return execFileSync("git", args, { encoding: "utf8" }).trim(); // NOSONAR(S4036)
}

function changedFiles() {
  if (process.env.PREPUSH_GATE_TEST_FILES !== undefined) {
    return process.env.PREPUSH_GATE_TEST_FILES.split(",").filter(Boolean);
  }
  // Diff the current branch against its push target. Notes:
  //  - Two-dot (`..`) gives the NET delta the push applies to the remote ref, so
  //    it surfaces paths reverted/dropped by a rebase or force-push; three-dot
  //    diffs from the merge-base and would silently hide them (under-scoping).
  //  - `--no-renames` reports a cross-workspace move as delete(src)+add(dst), so
  //    BOTH the losing and the gaining workspace get re-validated.
  //  - This only observes the CURRENT branch's push target. An explicit multi-ref
  //    push (`git push --all`, `git push a b`) is not classified per-extra-ref;
  //    reading git's pre-push stdin to cover that is deliberately avoided, since a
  //    blocking stdin read in a hook risks hanging every push.
  //  - No upstream yet (first push of a branch) → null → full suite.
  try {
    const upstream = git(["rev-parse", "--abbrev-ref", "@{push}"]);
    const out = git(["diff", "--no-renames", "--name-only", `${upstream}..HEAD`]);
    return out === "" ? [] : out.split("\n");
  } catch {
    return null;
  }
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
function suitesFor(affected) {
  const suites = [...ALWAYS];
  for (const dir of WORKSPACE_DIRS) {
    if (!affected.has(dir)) continue;
    for (const s of SUITES[dir]) if (!suites.includes(s)) suites.push(s);
  }
  return suites;
}

function classify(files) {
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
  return { kind: SCOPED, suites: suitesFor(affected), owners: [...owners] };
}

// Run the selected suites SEQUENTIALLY, with live (inherited) output. Running
// them concurrently was tried and reverted: each suite (vitest/tsc) already
// spawns its own workers, so running several at once oversubscribes the machine
// and surfaced a flaky test failure under load. A flaky gate that aborts a good
// push is worse than one that is a bit slower, and parallelism only helped the
// rare full/fan-out path (the common single-app push is one dominant suite
// either way). `scripts` never contains an app build — those run in CI.
function runScripts(scripts) {
  for (const s of scripts) {
    // Static argument arrays only; shell:true resolves bun's .cmd shim on Windows
    // and nothing user-controlled is interpolated.
    const r = spawnSync("bun", ["run", s], { stdio: "inherit", shell: true }); // NOSONAR(S4036)
    const status = r.status ?? 1;
    if (status !== 0) process.exit(status);
  }
  process.exit(0);
}

const result = classify(changedFiles());

// Dry-run mode for tests: report the classification without running anything.
if (process.env.PREPUSH_GATE_DRY === "1") {
  if (result.kind === SCOPED) {
    console.log("classification: scoped");
    console.log(`suites: ${result.suites.join(", ")}`);
  } else {
    console.log(`classification: ${result.kind}`);
  }
  process.exit(0);
}

if (result.kind === DOCS) {
  console.log("prepush-gate: docs-only push — running fast checks only.");
  runScripts(["check:source-test"]);
} else if (result.kind === SCOPED) {
  console.log(
    `prepush-gate: scoped push [${result.owners.join(", ")}] — running: ${result.suites.join(", ")}`,
  );
  runScripts(result.suites);
} else {
  const suites = suitesFor(new Set(WORKSPACE_DIRS));
  console.log(
    `prepush-gate: ${result.reason} — running the full suite (${suites.length} suites, no app builds).`,
  );
  runScripts(suites);
}
