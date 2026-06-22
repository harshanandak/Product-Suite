#!/usr/bin/env node
// Pre-push gate: run only the validation suites a push actually affects.
//
// Classification (each step only ever NARROWS, never hides work it cannot prove
// is irrelevant):
//   docs-only      → fast checks only (source/test coupling).
//   cross-cutting  → the FULL suite (root manifest, tooling, CI, infra, deploy
//                    config, or any file we cannot attribute to a workspace).
//   scoped         → the suites for the changed workspaces + every workspace that
//                    (transitively) depends on them, computed from the
//                    `workspace:*` dependency graph, plus the always-on cheap
//                    checks. This is what lets a platform-web-only change skip
//                    rebuilding the entire monorepo (e.g. roadmap-web's Next build).
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
  /^scripts\//, // build/validation tooling
  /^test\//, // repo-level tests
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
  "apps/platform-web": ["ci:platform-web"],
  "apps/meeting-web": ["ci:meeting-web"],
  "apps/roadmap-web": ["ci:roadmap-web", "test:roadmap-canvas-boundary"],
  "apps/meeting-api": ["ci:meeting-api"],
  "packages/contracts": ["test:contracts"],
  // packages/sdk HAS its own tests (src/*.test.ts) but no root suite is wired
  // into test:prepush / CI yet, so there is nothing to run here. Tracked separately.
  "packages/sdk": [],
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
    const deps = {
      ...(pkg.dependencies || {}),
      ...(pkg.devDependencies || {}),
      ...(pkg.peerDependencies || {}),
    };
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range === "string" && range.startsWith("workspace:")) {
        const depDir = nameToDir.get(name);
        if (depDir) dependents.get(depDir).add(dir);
      }
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

function classify(files) {
  if (files === null) {
    return { kind: FULL, reason: "no upstream to diff against" };
  }
  if (files.length === 0) {
    return { kind: FULL, reason: "empty change set" };
  }
  if (files.every((f) => DOCS_ONLY.some((re) => re.test(f)))) {
    return { kind: DOCS, reason: "docs/design only" };
  }
  if (files.some((f) => GLOBAL_FULL.some((re) => re.test(f)))) {
    return { kind: FULL, reason: "cross-cutting/infra change" };
  }
  // Attribute every non-docs file to a workspace; an unattributable file is a
  // root-level unknown → fall back to full.
  const owners = new Set();
  for (const f of files) {
    if (DOCS_ONLY.some((re) => re.test(f))) continue; // docs riding along
    const dir = ownerDir(f);
    if (!dir) return { kind: FULL, reason: `unscoped file: ${f}` };
    owners.add(dir);
  }
  const affected = withDependents(owners, buildDependents());
  const suites = [];
  const add = (s) => {
    if (!suites.includes(s)) suites.push(s);
  };
  for (const s of ALWAYS) add(s);
  for (const dir of WORKSPACE_DIRS) {
    if (affected.has(dir)) for (const s of SUITES[dir]) add(s);
  }
  return { kind: SCOPED, suites, owners: [...owners] };
}

function runScripts(scripts) {
  // Static argument arrays only; shell:true resolves bun's .cmd shim on Windows
  // and nothing user-controlled is interpolated.
  for (const s of scripts) {
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
    `prepush-gate: scoped push [${result.owners.join(", ")}] — running: ${result.suites.join(", ")}`
  );
  runScripts(result.suites);
} else {
  console.log(`prepush-gate: ${result.reason} — running the full suite.`);
  const full = spawnSync("bun", ["run", "test:prepush"], { stdio: "inherit", shell: true }); // NOSONAR(S4036)
  process.exit(full.status ?? 1);
}
