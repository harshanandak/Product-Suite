import { afterAll, describe, expect, test } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  buildCiPlan,
  CI_PLAN_SCHEMA_VERSION,
} from "../scripts/prepush-classify.mjs";
import { planFromInputs } from "../scripts/ci-change-plan.mjs";

// This file covers the gate's impure CLI shell: that it reads its env toggles and
// reports the classification it computed. The routing RULES themselves are pure and
// asserted in-process by test/prepush-classify.test.js — deliberately not here,
// because every test below spawns a fresh runtime (~1-2s cold start on Windows).
// Keeping that cost to ONE spawn per test is what stops this suite from blowing
// bun's default 5000ms per-test timeout while the gate runs it during a real push.
const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "prepush-gate.mjs"
);

// Wall-clock headroom for the single process spawn each test performs. This bounds
// runtime startup under a loaded machine — it is not a logic assertion, and every
// expectation below still has to hold.
const SPAWN_TIMEOUT_MS = 30_000;

// Every env key the gate script reads. The harness must OWN all of them for
// every spawn: this suite is part of the always-on `test:repo-tooling` check, so
// it runs inside a real `PREPUSH_GATE_FAST=1 git push`. If an ambient value
// leaked into the spawned child, the default-mode assertions below would read
// fast-mode output and abort the push (issue #118).
const GATE_ENV_KEYS = ["PREPUSH_GATE_FAST", "PREPUSH_GATE_DRY", "PREPUSH_GATE_TEST_FILES"];
const GIT_LOCAL_ENV_KEYS = [
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  "GIT_OBJECT_DIRECTORY",
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_IMPLICIT_WORK_TREE",
  "GIT_GRAFT_FILE",
  "GIT_INDEX_FILE",
  "GIT_NO_REPLACE_OBJECTS",
  "GIT_REPLACE_REF_BASE",
  "GIT_PREFIX",
  "GIT_SHALLOW_FILE",
  "GIT_COMMON_DIR",
];
const CHILD_ENV_KEYS = new Set([...GATE_ENV_KEYS, ...GIT_LOCAL_ENV_KEYS]);

// Build the child env explicitly: inherit everything EXCEPT the gate keys, then
// apply only the overrides this call asks for. A key absent from `overrides` is
// genuinely deleted, not merely omitted — relying on the parent not to set it is
// exactly the bug in #118. Case-insensitive removal because Windows env names
// are case-insensitive (a `prepush_gate_fast` would otherwise survive).
function gateEnv(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (CHILD_ENV_KEYS.has(key.toUpperCase())) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    env[key] = value;
  }
  return env;
}

// Run the real gate CLI in dry-run mode and return what it printed.
function classify(files, extraEnv = {}) {
  return execFileSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: gateEnv({
      PREPUSH_GATE_TEST_FILES: files.join(","),
      PREPUSH_GATE_DRY: "1",
      ...extraEnv,
    }),
  }).trim();
}

// Same dry-run classification, but with the fast-mode toggle set explicitly.
function classifyFast(files) {
  return classify(files, { PREPUSH_GATE_FAST: "1" });
}

// Execute the real gate against a fake bun binary. This proves ordering and
// fail-fast behavior without recursively running the repository's full suites.
function executeGate(files, { fast = false, dry = false, failOn, cwd, input, args = [] } = {}) {
  const sandbox = mkdtempSync(path.join(tmpdir(), "prepush-gate-"));
  const log = path.join(sandbox, "calls.jsonl");
  const posixShim = path.join(sandbox, "bun");
  const windowsShim = path.join(sandbox, "bun.cmd");
  writeFileSync(posixShim, [
    "#!/usr/bin/env sh",
    'printf "%s\\n" "$*" >> "$FAKE_BUN_LOG"',
    '[ "$FAKE_BUN_FAIL" = "$*" ] && exit 23',
    "exit 0",
  ].join("\n"));
  chmodSync(posixShim, 0o755);
  writeFileSync(windowsShim, [
    '@echo %*>>"%FAKE_BUN_LOG%"',
    '@if "%FAKE_BUN_FAIL%"=="%*" exit /b 23',
    "@exit /b 0",
  ].join("\r\n"));

  try {
    const env = gateEnv({
      PREPUSH_GATE_TEST_FILES: files?.join(","),
      PREPUSH_GATE_DRY: dry ? "1" : undefined,
      PREPUSH_GATE_FAST: fast ? "1" : undefined,
      FAKE_BUN_LOG: log,
      FAKE_BUN_FAIL: failOn?.join(" "),
    });
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${sandbox}${path.delimiter}${env[pathKey] ?? ""}`;
    const result = spawnSync(process.execPath, [scriptPath, ...args], { cwd, input, encoding: "utf8", env });
    const calls = existsSync(log)
      ? readFileSync(log, "utf8").trim().split(/\r?\n/).filter(Boolean).map((line) => line.split(/\s+/))
      : [];
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function git(cwd, args, { trim = true } = {}) {
  const output = execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    env: gateEnv(),
    stdio: ["ignore", "pipe", "pipe"],
  });
  return trim ? output.trim() : output;
}

function writeRepoFile(repo, file, content) {
  const target = path.join(repo, ...file.split("/"));
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function commitFile(repo, file, content, message) {
  writeRepoFile(repo, file, content);
  git(repo, ["add", "--", file]);
  git(repo, ["commit", "-m", message]);
  return git(repo, ["rev-parse", "HEAD"]);
}

const gitSeeds = new Map();

function gitSeed(objectFormat) {
  const key = objectFormat ?? "sha1";
  if (gitSeeds.has(key)) return gitSeeds.get(key);
  const repo = mkdtempSync(path.join(tmpdir(), `prepush-seed-${key}-`));
  git(repo, ["init", "-b", "main", ...(objectFormat ? [`--object-format=${objectFormat}`] : [])]);
  git(repo, ["config", "user.name", "Prepush Test"]);
  git(repo, ["config", "user.email", "prepush@example.invalid"]);
  git(repo, ["remote", "add", "origin", path.join(repo, "missing-origin.git")]);
  writeRepoFile(repo, "README.md", "base\n");
  writeRepoFile(repo, "packages/db/package.json", "{}\n");
  writeRepoFile(repo, "packages/ui/src/old.ts", "old\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "base"]);
  const base = git(repo, ["rev-parse", "HEAD"]);
  git(repo, ["update-ref", "refs/remotes/origin/main", base]);
  const seed = { repo, base };
  gitSeeds.set(key, seed);
  return seed;
}

function createGitFixture({ objectFormat } = {}) {
  const seed = gitSeed(objectFormat);
  const repo = mkdtempSync(path.join(tmpdir(), "prepush-git-"));
  rmSync(repo, { recursive: true, force: true });
  cpSync(seed.repo, repo, { recursive: true });
  return { repo, base: seed.base };
}

afterAll(() => {
  for (const { repo } of gitSeeds.values()) rmSync(repo, { recursive: true, force: true });
});

function checkoutTrackedBranch(repo, name, start, upstream = "main") {
  git(repo, ["checkout", "-b", name, start]);
  git(repo, ["config", `branch.${name}.remote`, "origin"]);
  git(repo, ["config", `branch.${name}.merge`, `refs/heads/${upstream}`]);
}

function updateLine(repo, remoteRef, remoteOid, localRef) {
  const oid = git(repo, ["rev-parse", "HEAD"]);
  const branch = git(repo, ["branch", "--show-current"]);
  return `${localRef ?? `refs/heads/${branch}`} ${oid} ${remoteRef} ${remoteOid ?? "0".repeat(oid.length)}\n`;
}

function lefthookExecutable(platform = process.platform) {
  const executable = path.join(import.meta.dir, "..", "node_modules", ".bin", "lefthook");
  return platform === "win32" ? `${executable}.exe` : executable;
}

function executeLefthook(repo, input) {
  const sandbox = mkdtempSync(path.join(tmpdir(), "prepush-lefthook-"));
  const log = path.join(sandbox, "calls.txt");
  const posixShim = path.join(sandbox, "bun");
  const windowsShim = path.join(sandbox, "bun.cmd");
  writeFileSync(posixShim, ["#!/usr/bin/env sh", 'printf "%s\\n" "$*" >> "$FAKE_BUN_LOG"', "exit 0"].join("\n"));
  chmodSync(posixShim, 0o755);
  writeFileSync(windowsShim, ['@echo %*>>"%FAKE_BUN_LOG%"', "@exit /b 0"].join("\r\n"));
  try {
    const env = gateEnv({ FAKE_BUN_LOG: log });
    const pathKey = Object.keys(env).find((key) => key.toUpperCase() === "PATH") ?? "PATH";
    env[pathKey] = `${sandbox}${path.delimiter}${env[pathKey] ?? ""}`;
    const executable = lefthookExecutable();
    const result = spawnSync(executable, ["run", "pre-push", "--force", "--no-tty"], {
      cwd: repo,
      input,
      encoding: "utf8",
      env,
      timeout: SPAWN_TIMEOUT_MS,
    });
    if (result.error) throw new Error(`installed Lefthook could not start: ${result.error.message}`);
    if (!Number.isInteger(result.status)) {
      throw new Error(`installed Lefthook did not return an integer status${result.signal ? ` (${result.signal})` : ""}`);
    }
    const calls = existsSync(log) ? readFileSync(log, "utf8").trim().split(/\r?\n/).filter(Boolean) : [];
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

function installLefthook(repo) {
  const command = `node ${JSON.stringify(scriptPath)} --pre-push`.replaceAll("\\\\", "/");
  writeFileSync(path.join(repo, "lefthook.yml"), [
    "pre-push:",
    "  jobs:",
    "    - name: pre-push gate",
    `      run: ${command}`,
    "      use_stdin: true",
    "",
  ].join("\n"));
}

// Run `fn` with `vars` temporarily present in this process's env, then restore
// the previous values (including deleting keys that were previously unset).
function withAmbientEnv(vars, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("prepush-gate CLI wiring", () => {
  test(
    "the CLI reads PREPUSH_GATE_TEST_FILES and reports the scoped plan",
    () => {
      // End-to-end proof that the shell wires env -> classifier -> printed report.
      const out = classify(["apps/platform-web/src/x.tsx"]);
      expect(out).toContain("classification: scoped");
      expect(out).toContain("checks: lint, check:source-test, test:repo-tooling");
      expect(out).toContain("apps/platform-web:typecheck");
      expect(out).toContain("apps/platform-web:test");
      expect(out).not.toContain("verify:platform-web");
      expect(out).not.toContain("mode: fast");
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "PREPUSH_GATE_FAST=1 switches the CLI to the fast-mode report",
    () => {
      const out = classifyFast(["apps/platform-web/src/x.tsx"]);
      expect(out).toContain("mode: fast");
      expect(out).toContain("checks: lint, check:source-test, test:repo-tooling");
      expect(out).not.toContain("apps/platform-web:lint");
      expect(out).toContain("apps/platform-web:typecheck");
      expect(out).not.toContain("verify:platform-web");
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "docs and full dry-runs report their complete local plans",
    () => {
      const docs = classify(["docs/work/example/plan.md"]);
      expect(docs).toContain("classification: docs-only");
      expect(docs).toContain("checks: lint, check:source-test");

      const full = classify(["package.json"]);
      expect(full).toContain("classification: full-suite");
      expect(full).toContain("apps/platform-api:test");
      expect(full).not.toContain("verify:platform-api");
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "local verify expansion matches canonical scripts minus aggregate lint",
    () => {
      const packageJson = readFileSync(path.join(import.meta.dir, "..", "package.json"), "utf8");
      const scripts = JSON.parse(packageJson).scripts;
      const labelsFor = (name) => scripts[name].split(" && ").map((command) => {
        const match = command.match(/^bun run --cwd (\S+) (\S+)$/);
        if (!match) throw new Error(`unsupported canonical verify step: ${command}`);
        return `${match[1]}:${match[2]}`;
      }).filter((label) => !label.endsWith(":lint"));
      const dryLabels = (files) => classify(files)
        .split("\n")
        .find((line) => line.startsWith("checks: "))
        .slice("checks: ".length)
        .split(", ");
      const always = ["lint", "check:source-test", "test:repo-tooling"];

      expect(dryLabels(["apps/platform-web/src/x.tsx"])).toEqual([
        ...always,
        ...labelsFor("verify:platform-web"),
      ]);
      expect(dryLabels(["apps/platform-api/src/x.ts"])).toEqual([
        ...always,
        ...labelsFor("verify:platform-api"),
      ]);
      expect(dryLabels(["apps/meeting-web/src/x.ts"])).toEqual([
        ...always,
        ...labelsFor("verify:meeting-web"),
      ]);
      expect(dryLabels(["packages/db/src/x.ts"])).toEqual([
        ...always,
        ...labelsFor("verify:platform-api"),
        ...labelsFor("verify:db"),
      ]);
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("prepush-gate command execution", () => {
  test("direct docs invocation runs aggregate lint once before source-test", () => {
    const result = executeGate(["docs/work/example/plan.md"]);
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([
      ["run", "lint"],
      ["run", "check:source-test"],
    ]);
  }, SPAWN_TIMEOUT_MS);

  test("aggregate lint failure prevents every later check", () => {
    const result = executeGate(["apps/platform-web/src/x.tsx"], { failOn: ["run", "lint"] });
    expect(result.status).toBe(23);
    expect(result.calls).toEqual([["run", "lint"]]);
  }, SPAWN_TIMEOUT_MS);

  test("fast invocation executes a test-only suite after aggregate lint", () => {
    const result = executeGate(["packages/ui-planning/src/example.ts"], { fast: true });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([
      ["run", "lint"],
      ["run", "check:source-test"],
      ["run", "test:repo-tooling"],
      ["run", "test:ui-planning"],
    ]);
  }, SPAWN_TIMEOUT_MS);

  test("dry-run reports the real plan without executing it", () => {
    const result = executeGate(["apps/platform-web/src/x.tsx"], { dry: true });
    expect(result.status).toBe(0);
    expect(result.calls).toEqual([]);
    expect(result.stdout).toContain("checks: lint, check:source-test, test:repo-tooling");
    expect(result.stdout).toContain("apps/platform-web:typecheck");
    expect(result.stdout).toContain("apps/platform-web:test");
    expect(result.stdout).not.toContain("verify:platform-web");
  }, SPAWN_TIMEOUT_MS);

});

describe("prepush-gate Git ranges", () => {
  test("isolates fixtures from the invoking hook's Git repository", () => {
    const hookRepo = mkdtempSync(path.join(tmpdir(), "prepush-hook-context-"));
    let fixtureRepo;
    try {
      git(hookRepo, ["init", "-b", "hook-branch"]);
      git(hookRepo, ["config", "user.name", "Outer Hook"]);
      git(hookRepo, ["config", "user.email", "outer-hook@example.invalid"]);
      commitFile(hookRepo, "README.md", "outer\n", "outer");
      const hookGitDir = path.join(hookRepo, ".git");
      const originalBare = git(hookRepo, ["config", "--get", "core.bare"]);
      const originalConfig = git(hookRepo, ["config", "--local", "--list", "--null"]);
      const originalHead = git(hookRepo, ["rev-parse", "HEAD"]);
      const originalStatus = git(hookRepo, ["status", "--porcelain=v1", "-z"], { trim: false });
      withAmbientEnv({ GIT_DIR: hookGitDir, GIT_WORK_TREE: undefined }, () => {
        const fixture = createGitFixture();
        fixtureRepo = fixture.repo;
        checkoutTrackedBranch(fixture.repo, "feature", fixture.base);
        commitFile(fixture.repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
        const result = executeGate(undefined, {
          cwd: fixture.repo,
          input: updateLine(fixture.repo, "refs/heads/feature", fixture.base),
          args: ["--pre-push"],
          dry: true,
        });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("classification: scoped");
      });
      expect(git(hookRepo, ["config", "--get", "core.bare"])).toBe(originalBare);
      expect(git(hookRepo, ["config", "--local", "--list", "--null"])).toBe(originalConfig);
      expect(git(hookRepo, ["rev-parse", "HEAD"])).toBe(originalHead);
      expect(git(hookRepo, ["status", "--porcelain=v1", "-z"], { trim: false })).toBe(originalStatus);
    } finally {
      if (fixtureRepo) rmSync(fixtureRepo, { recursive: true, force: true });
      rmSync(hookRepo, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  const rangeCases = [
    {
      name: "narrows an ordinary first push from its verified fork point",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "feature", base);
        commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
        return updateLine(repo, "refs/heads/feature");
      },
      status: 0,
      includes: ["apps/platform-web:test"],
      excludes: ["verify:meeting-web"],
    },
    {
      name: "narrows a first push after its upstream advances",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "feature", base);
        const featureOid = commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
        git(repo, ["checkout", "main"]);
        const advanced = commitFile(repo, "docs/upstream.md", "advanced\n", "advance upstream");
        git(repo, ["update-ref", "refs/remotes/origin/main", advanced]);
        git(repo, ["checkout", "feature"]);
        expect(git(repo, ["rev-parse", "HEAD"])).toBe(featureOid);
        return updateLine(repo, "refs/heads/feature");
      },
      status: 0,
      includes: ["apps/platform-web:test"],
    },
    {
      name: "narrows a stacked first push from its configured upstream",
      arrange(repo, base) {
        git(repo, ["checkout", "-b", "stack", base]);
        const stackOid = commitFile(repo, "packages/ui/src/stack.ts", "stack\n", "stack base");
        git(repo, ["update-ref", "refs/remotes/origin/stack", stackOid]);
        checkoutTrackedBranch(repo, "stacked-feature", stackOid, "stack");
        commitFile(repo, "apps/platform-web/src/stacked.tsx", "stacked\n", "stacked feature");
        return updateLine(repo, "refs/heads/stacked-feature");
      },
      status: 0,
      includes: ["apps/platform-web:test"],
      excludes: ["test:ui"],
    },
    {
      name: "narrows a SHA-256 first push from its verified fork point",
      fixtureOptions: { objectFormat: "sha256" },
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "feature", base);
        commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
        return updateLine(repo, "refs/heads/feature");
      },
      status: 0,
      includes: ["classification: scoped", "apps/platform-web:test"],
    },
    {
      name: "falls back to full when a first push has no upstream fork-point evidence",
      arrange(repo, base) {
        git(repo, ["checkout", "-b", "no-upstream", base]);
        commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
        return updateLine(repo, "refs/heads/no-upstream");
      },
      status: 0,
      includes: ["full-suite"],
    },
    {
      name: "falls back to full when a first push targets its configured upstream",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "same", base, "same");
        commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
        return updateLine(repo, "refs/heads/same");
      },
      status: 0,
      includes: ["full-suite"],
    },
    {
      name: "uses the actual remote OID instead of the configured upstream",
      arrange(repo, base) {
        git(repo, ["checkout", "-b", "remote-destination", base]);
        const remoteOid = commitFile(repo, "packages/db/src/remote.ts", "remote\n", "remote destination");
        git(repo, ["checkout", "main"]);
        checkoutTrackedBranch(repo, "alternate", base);
        commitFile(repo, "apps/platform-web/src/only.tsx", "only\n", "alternate feature");
        return updateLine(repo, "refs/heads/alternate", remoteOid);
      },
      status: 0,
      includes: ["apps/platform-web:test", "packages/db:test", "apps/platform-api:test"],
    },
    {
      name: "keeps both owners for a cross-workspace move",
      arrange(repo, base) {
        git(repo, ["checkout", "-b", "move", base]);
        mkdirSync(path.join(repo, "packages", "db", "src"), { recursive: true });
        git(repo, ["mv", "packages/ui/src/old.ts", "packages/db/src/moved.ts"]);
        git(repo, ["commit", "-m", "move across owners"]);
        return updateLine(repo, "refs/heads/move", base);
      },
      status: 0,
      includes: ["test:ui", "packages/db:test", "apps/platform-api:test"],
    },
    {
      name: "keeps the former owner for a deletion",
      arrange(repo, base) {
        git(repo, ["checkout", "-b", "delete", base]);
        git(repo, ["rm", "packages/ui/src/old.ts"]);
        git(repo, ["commit", "-m", "delete owned file"]);
        return updateLine(repo, "refs/heads/delete", base);
      },
      status: 0,
      includes: ["test:ui"],
    },
    {
      name: "keeps shared DB consumer coverage",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "feature", base);
        commitFile(repo, "packages/db/src/change.ts", "db\n", "db change");
        return updateLine(repo, "refs/heads/feature", base);
      },
      includes: ["packages/db:test", "apps/platform-api:test"],
      excludes: ["verify:meeting-web"],
    },
    {
      name: "falls back to full for a missing remote object",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "feature", base);
        commitFile(repo, "packages/db/src/change.ts", "db\n", "db change");
        return updateLine(repo, "refs/heads/feature", "f".repeat(40));
      },
      status: 0,
      includes: ["full-suite"],
    },
    {
      name: "falls back to full for a dirty workspace manifest",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "feature", base);
        commitFile(repo, "packages/db/src/change.ts", "db\n", "db change");
        writeRepoFile(repo, "packages/db/package.json", "{\"dirty\":true}\n");
        expect(git(
          repo,
          ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
          { trim: false },
        )).toBe(" M packages/db/package.json\0");
        return updateLine(repo, "refs/heads/feature", base);
      },
      includes: ["full-suite"],
    },
    {
      name: "falls back to full for a committed workspace manifest",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "manifest", base);
        commitFile(repo, "packages/db/package.json", "{\"name\":\"fixture\"}\n", "manifest");
        return updateLine(repo, "refs/heads/manifest", base);
      },
      includes: ["full-suite"],
    },
    {
      name: "falls back to full for an unknown path",
      arrange(repo, base) {
        checkoutTrackedBranch(repo, "unknown", base);
        commitFile(repo, "unknown-root-file.txt", "unknown\n", "unknown");
        return updateLine(repo, "refs/heads/unknown", base);
      },
      includes: ["full-suite"],
    },
  ];
  for (const { name, fixtureOptions, arrange, status, includes = [], excludes = [] } of rangeCases) {
    test(name, () => {
      const { repo, base } = createGitFixture(fixtureOptions);
      try {
        const result = executeGate(undefined, {
          cwd: repo,
          input: arrange(repo, base),
          args: ["--pre-push"],
          dry: true,
        });
        if (status !== undefined) expect(result.status).toBe(status);
        for (const expected of includes) expect(result.stdout).toContain(expected);
        for (const unexpected of excludes) expect(result.stdout).not.toContain(unexpected);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    }, SPAWN_TIMEOUT_MS);
  }

  const unsupportedInputs = [
    ["protected destinations", (repo) => updateLine(repo, "refs/heads/main")],
    ["multi-ref updates", (repo) => {
      const feature = updateLine(repo, "refs/heads/feature");
      return `${feature}${feature}`;
    }],
    ["tag updates", (repo) => updateLine(repo, "refs/tags/v1")],
    ["deletions", (_repo, base) => `(delete) ${"0".repeat(base.length)} refs/heads/feature ${base}\n`],
    ["non-HEAD updates", (_repo, base) => `refs/heads/feature ${base} refs/heads/feature ${base}\n`],
    ["malformed records", () => "malformed\n"],
    ["missing input", () => ""],
  ];
  for (const [name, inputFor] of unsupportedInputs) {
    test(`rejects ${name} before validation`, () => {
      const { repo, base } = createGitFixture();
      try {
        checkoutTrackedBranch(repo, "feature", base);
        commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
        const result = executeGate(undefined, {
          cwd: repo,
          input: inputFor(repo, base),
          args: ["--pre-push"],
        });
        expect(result.status).not.toBe(0);
        expect(result.calls).toEqual([]);
      } finally {
        rmSync(repo, { recursive: true, force: true });
      }
    }, SPAWN_TIMEOUT_MS);
  }

  test("standalone invocation without hook input stays full", () => {
    const { repo, base } = createGitFixture();
    try {
      checkoutTrackedBranch(repo, "feature", base);
      commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
      const result = executeGate(undefined, { cwd: repo, dry: true });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain("full-suite");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  test("resolves installed Lefthook without relying on shell PATH", () => {
    const executable = path.join(import.meta.dir, "..", "node_modules", ".bin", "lefthook");
    expect(lefthookExecutable("linux")).toBe(executable);
    expect(lefthookExecutable("darwin")).toBe(executable);
    expect(lefthookExecutable("win32")).toBe(`${executable}.exe`);
    expect(existsSync(lefthookExecutable())).toBe(true);
  });

  test("installed Lefthook rejects protected destinations before Bun", () => {
    const { repo, base } = createGitFixture();
    try {
      checkoutTrackedBranch(repo, "feature", base);
      commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
      installLefthook(repo);
      const protectedResult = executeLefthook(repo, updateLine(repo, "refs/heads/main"));
      expect(Number.isInteger(protectedResult.status)).toBe(true);
      expect(protectedResult.status).not.toBe(0);
      expect(protectedResult.calls).toEqual([]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);

  test("installed Lefthook forwards one stream without hanging", () => {
    const { repo, base } = createGitFixture();
    try {
      checkoutTrackedBranch(repo, "feature", base);
      commitFile(repo, "apps/platform-web/src/feature.tsx", "feature\n", "feature");
      installLefthook(repo);
      const featureResult = executeLefthook(repo, updateLine(repo, "refs/heads/feature"));
      expect(featureResult.status).toBe(0);
      expect(featureResult.calls.join(" ")).toContain("apps/platform-web test");
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }, SPAWN_TIMEOUT_MS);
});

describe("change-aware CI plan", () => {
  const SHA = "a".repeat(40);
  const BASE = "b".repeat(40);

  test("archived Roadmap changes keep DB authority fail-closed without runtime commands", () => {
    const plan = buildCiPlan(["apps/roadmap-web/src/app/api/dependencies/route.ts"], SHA);
    expect(plan.classification).toBe("full-suite");
    expect(plan.dbEvidenceRequired).toBe(true);
    expect(plan.cheapScripts).not.toContain("verify:roadmap-web");
    expect(plan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");
  });

  test("scoped workspace changes include ordered cheap gates and no DB evidence", () => {
    const plan = buildCiPlan(["apps/platform-web/src/x.tsx"], SHA);
    expect(plan).toMatchObject({
      schemaVersion: CI_PLAN_SCHEMA_VERSION,
      exactSha: SHA,
      classification: "scoped",
      dbEvidenceRequired: false,
    });
    expect(plan.cheapScripts).toEqual([
      "check:source-test",
      "test:repo-tooling",
      "verify:platform-web",
    ]);
  });

  test("docs-only changes permit explicit N/A and only run integrity", () => {
    const plan = buildCiPlan(["docs/work/example/plan.md"], SHA);
    expect(plan.classification).toBe("docs-only");
    expect(plan.cheapScripts).toEqual(["check:source-test"]);
    expect(plan.dbEvidenceRequired).toBe(false);
    expect(plan.dbEvidenceReason).toBe("non-authority change");
  });

  test("archived Roadmap API pointer guidance has no runtime command", () => {
    for (const file of [
      "apps/roadmap-web/src/app/api/CLAUDE.md",
      "apps/roadmap-web/src/app/api/dependencies/CLAUDE.md",
    ]) {
      const plan = buildCiPlan({
        files: [file],
        exactSha: SHA,
        fileContents: { [file]: "@AGENTS.md\n" },
      });
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
      expect(plan.cheapScripts, file).not.toContain("test:roadmap-canvas-boundary");
      expect(plan.cheapScripts, file).not.toContain("verify:roadmap-web");
    }
  });

  test("Roadmap API CLAUDE changes without verified pointer content fail closed", () => {
    const file = "apps/roadmap-web/src/app/api/CLAUDE.md";
    for (const fileContents of [undefined, {}, { [file]: "# changed guidance\n" }]) {
      const plan = buildCiPlan({ files: [file], exactSha: SHA, fileContents });
      expect(plan.dbEvidenceRequired, JSON.stringify(fileContents)).toBe(true);
      expect(plan.classification, JSON.stringify(fileContents)).toBe("full-suite");
    }
  });

  test("Roadmap API AGENTS guidance and behavior remain fail-closed", () => {
    for (const file of [
      "apps/roadmap-web/src/app/api/AGENTS.md",
      "apps/roadmap-web/src/app/api/dependencies/AGENTS.md",
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
      expect(plan.cheapScripts, file).not.toContain("verify:roadmap-web");
      expect(plan.cheapScripts, file).not.toContain("test:roadmap-canvas-boundary");
    }
  });

  test("Roadmap API pointer documentation cannot mask behavior changes", () => {
    const plan = buildCiPlan([
      "apps/roadmap-web/src/app/api/dependencies/CLAUDE.md",
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
    ], SHA);
    expect(plan.dbEvidenceRequired).toBe(true);
    expect(plan.classification).toBe("full-suite");
    expect(plan.cheapScripts).not.toContain("verify:roadmap-web");
    expect(plan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");
  });

  test("authority, API, DB, migration, security, and workflow changes require DB proof", () => {
    for (const files of [
      ["apps/platform-api/src/agent/tools.ts"],
      ["packages/db/src/schema.ts"],
      ["infra/neon/migrations/001.sql"],
      ["scripts/check-worker-secrets.mjs"],
      ["scripts/prepush-gate.mjs"],
      ["apps/platform-web/src/auth/session.ts"],
      [".github/workflows/db-contract.yml"],
    ]) {
      const plan = buildCiPlan(files, SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("authority/security ownership rules fail closed across explicit and keyword surfaces", () => {
    const authorityPaths = [
      "apps/meeting-api/backend/tenant_context.py",
      "apps/meeting-api/backend/auth.py",
      "scripts/delivery/classify-change.mjs",
      "scripts/delivery/security-routing.mjs",
      "scripts/check-source-test-coupling.mjs",
      "scripts/check-historical-db-artifacts.mjs",
      "packages/contracts/src/auth/index.d.ts",
      "packages/contracts/src/conversation.js",
      "packages/contracts/src/meeting.js",
      "packages/contracts/src/work-items.js",
      "packages/contracts/src/authorization/policy.ts",
      "packages/contracts/src/permissions/index.d.ts",
      "packages/contracts/src/identity/user.ts",
      "apps/platform-web/src/tenant/route.ts",
      "apps/platform-web/src/identity/session.ts",
      "apps/platform-web/src/access/guard.ts",
      "apps/platform-web/src/permission/check.ts",
      "apps/platform-web/src/security/csp.ts",
      "apps/meeting-web/src/lib/authContracts.js",
      "apps/meeting-web/src/lib/hostedAuthFlow.js",
      "apps/meeting-web/src/lib/runtimeConfig.js",
      "apps/meeting-web/src/lib/runtimeCONFIG.js",
      "apps/platform-web/src/shell/ShellLayout.tsx",
      "apps/platform-web/src/shell/sHELLLayout.tsx",
    ];
    for (const file of authorityPaths) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
    }
  });

  test("executable migration authority and existing OAuth, token, and session surfaces fail closed", () => {
    const authorityPaths = [
      "docs/history/database-migrations/manifest.json",
      "scripts/provision-database-roles.mjs",
      "scripts/database-pool.mjs",
      "apps/roadmap-web/src/lib/integrations/oauth-providers.ts",
      "apps/roadmap-web/src/app/api/integrations/oauth/callback/[provider]/route.ts",
      "apps/roadmap-web/src/app/api/review-links/by-token/[token]/route.ts",
      "apps/meeting-api/backend/db.py",
      "apps/meeting-api/backend/config.py",
      "apps/meeting-api/backend/server.py",
      "apps/meeting-api/backend/settings.py",
      "apps/meeting-api/backend/repositories/history.py",
      "apps/meeting-api/backend/routes/history.py",
      "apps/meeting-api/backend/routes/tools.py",
      "apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py",
      "apps/meeting-api/backend/migrate.py",
      "apps/meeting-api/backend/alembic/versions/0005_remove_workos_session_id.py",
      "apps/roadmap-web/src/middleware.ts",
      "apps/roadmap-web/src/lib/supabase/middleware.ts",
      "apps/roadmap-web/src/lib/supabase/server.ts",
      "apps/roadmap-web/src/lib/supabase/database.types.ts",
      "apps/roadmap-web/supabase/config.toml",
      "apps/roadmap-web/src/app/api/team/members/[id]/route.ts",
      "apps/roadmap-web/src/app/api/team/phase-assignments/route.ts",
      "apps/roadmap-web/src/app/api/invitations/send/route.ts",
      "apps/roadmap-web/src/app/api/departments/[id]/route.ts",
      "apps/roadmap-web/src/app/api/workspaces/[id]/mode/route.ts",
      "apps/roadmap-web/src/app/api/debug/member-status/route.ts",
      "apps/roadmap-web/src/app/api/admin/setup-users-table/route.ts",
      "apps/roadmap-web/src/app/api/user/profile/route.ts",
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
      "apps/roadmap-web/src/app/api/work-items/route.ts",
      "apps/meeting-web/src/lib/api.js",
      "apps/meeting-web/src/hooks/useBuddyAgent.js",
      "apps/meeting-web/src/hooks/useMeetingState.js",
      "apps/meeting-web/src/hooks/useRealtimeTranscript.js",
      "apps/platform-web/src/data/work-items/RepositoryProvider.tsx",
      "apps/platform-web/src/data/meeting-actions/MeetingActionsRepositoryProvider.tsx",
      "apps/platform-web/src/data/proposals/ProposalRepositoryProvider.tsx",
      "apps/platform-web/src/data/memories/MemoriesProvider.tsx",
      "apps/platform-web/src/data/meeting-actions/network-repository.ts",
      "apps/platform-web/src/data/proposals/network-repository.ts",
      "apps/platform-web/src/data/agent/transport.ts",
      "apps/platform-web/src/data/memories/adapter.ts",
      "apps/roadmap-web/src/app/(dashboard)/layout.tsx",
      "apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/page.tsx",
      "apps/roadmap-web/src/app/(auth)/accept-invite/page.tsx",
      "apps/roadmap-web/src/app/(auth)/layout.tsx",
      "apps/roadmap-web/src/app/(auth)/auth/callback/route.ts",
      "apps/roadmap-web/src/lib/ai/agent-executor.ts",
      "apps/roadmap-web/src/lib/ai/context-builder.ts",
      "apps/roadmap-web/src/lib/ai/compression/l2-summarizer.ts",
      "apps/roadmap-web/src/lib/ai/embeddings/document-processor.ts",
      "apps/roadmap-web/scripts/upgrade-user-to-pro.ts",
    ];

    for (const file of authorityPaths) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
    }

    const roadmapAuthorityPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/integrations/oauth/callback/[provider]/route.ts",
    ], SHA);
    expect(roadmapAuthorityPlan.cheapScripts).not.toContain("verify:roadmap-web");
    expect(roadmapAuthorityPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");

    const roadmapMembershipPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/team/members/[id]/route.ts",
    ], SHA);
    expect(roadmapMembershipPlan.cheapScripts).not.toContain("verify:roadmap-web");
    expect(roadmapMembershipPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");

    const roadmapIdentityPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/user/profile/route.ts",
    ], SHA);
    expect(roadmapIdentityPlan.cheapScripts).not.toContain("verify:roadmap-web");
    expect(roadmapIdentityPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");

    const roadmapApiPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
    ], SHA);
    expect(roadmapApiPlan.cheapScripts).not.toContain("verify:roadmap-web");
    expect(roadmapApiPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");
  });

  test("the contracts authority entrypoints require DB proof", () => {
    for (const file of ["packages/contracts/src/index.js", "packages/contracts/src/index.d.ts"]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("platform-web authentication roots require DB proof", () => {
    for (const file of ["apps/platform-web/src/AppRoot.tsx", "apps/platform-web/src/fixtures-mode.ts"]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("root and workspace manifests require the full canonical DB path", () => {
    for (const file of [
      "package.json",
      "apps/platform-web/package.json",
      "packages/contracts/package.json",
      "packages/ui-meeting/package.json",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("unrelated surfaces remain scoped and do not acquire DB proof", () => {
    for (const file of [
      "apps/platform-web/src/components/board.tsx",
      "apps/meeting-api/backend/health.py",
      "packages/ui/src/button.tsx",
      "packages/ui/src/styles/tokens.css",
      "apps/meeting-web/src/lib/runtimeConfig.js.bak",
      "apps/meeting-web/src/lib/runtimeConfig.jsx",
      "apps/meeting-web/src/lib/runtimeConfig.js/extra",
      "apps/platform-web/src/shell/ShellLayout.ts",
      "apps/platform-web/src/shell/ShellLayout.tsx.bak",
      "apps/platform-web/src/shell/ShellLayout.tsx/extra",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(false);
      expect(plan.classification, file).toBe("scoped");
    }

  });

  test("unrelated documentation remains docs-only even when it discusses design tokens", () => {
    const plan = buildCiPlan(["docs/design/tokens.css"], SHA);
    expect(plan.dbEvidenceRequired).toBe(false);
    expect(plan.classification).toBe("docs-only");
  });

  test("ordinary authority documentation stays docs-only while executable DB history remains protected", () => {
    for (const file of [
      "docs/plans/2026-05-16-pr5-auth-contracts-and-adapters-design.md",
      "docs/security/authorization-model.md",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(false);
      expect(plan.classification, file).toBe("docs-only");
    }

    const manifestPlan = buildCiPlan(["docs/history/database-migrations/manifest.json"], SHA);
    expect(manifestPlan.dbEvidenceRequired).toBe(true);
    expect(manifestPlan.classification).toBe("full-suite");
  });

  test("ambiguous ranges and unowned paths fail closed to full DB validation", () => {
    for (const input of [null, [], ["unknown-root-file.txt"], ["apps/platform-web/src/x.tsx", "README"]]) {
      const plan = buildCiPlan(input, SHA);
      expect(plan.classification).toBe("full-suite");
      expect(plan.dbEvidenceRequired).toBe(true);
    }
  });

  test("invalid exact SHA remains an explicit invalid full plan", () => {
    const plan = buildCiPlan(["apps/platform-web/src/x.tsx"], "not-a-sha");
    expect(plan.classification).toBe("full-suite");
    expect(plan.dbEvidenceRequired).toBe(true);
    expect(plan.exactSha).toBeNull();
    expect(plan.inputValid).toBe(false);
  });

  test("CLI adapter validates refs and produces deterministic output", () => {
    const plan = planFromInputs({
      baseSha: BASE,
      headSha: SHA,
      files: ["apps/platform-web/src/x.tsx"],
    });
    expect(plan).toEqual(planFromInputs({
      baseSha: BASE,
      headSha: SHA,
      files: ["apps/platform-web/src/x.tsx"],
    }));
    expect(plan.exactSha).toBe(SHA);
    expect(plan.inputValid).toBe(true);
  });

  test("malformed base or missing file range produces full fail-closed plan", () => {
    for (const input of [
      { baseSha: "bad", headSha: SHA, files: ["docs/a.md"] },
      { baseSha: BASE, headSha: SHA, files: null },
    ]) {
      const plan = planFromInputs(input);
      expect(plan.classification).toBe("full-suite");
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.inputValid).toBe(false);
      expect(plan.exactSha).toBe(SHA);
    }
  });
});

describe("prepush-gate harness env isolation (regression for #118)", () => {
  // `test:repo-tooling` is an always-on gate check, so this file executes during a
  // real `PREPUSH_GATE_FAST=1 git push`. Before the fix the spawned gate inherited
  // that ambient flag, the default-mode expectations read fast-mode output, and the
  // push aborted — PREPUSH_GATE_FAST could never be used. These tests simulate the
  // ambient environment directly so the leak cannot come back.
  test(
    "an ambient PREPUSH_GATE_FAST=1 does not leak into default-mode spawns",
    () => {
      withAmbientEnv({ PREPUSH_GATE_FAST: "1" }, () => {
        const out = classify(["apps/platform-web/src/x.tsx"]);
        expect(out).not.toContain("mode: fast");
        expect(out).toContain("apps/platform-web:typecheck");
        expect(out).toContain("apps/platform-web:test");
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "fast-mode cases still opt in explicitly even with no ambient flag set",
    () => {
      withAmbientEnv({ PREPUSH_GATE_FAST: "" }, () => {
        const out = classifyFast(["apps/platform-web/src/x.tsx"]);
        expect(out).toContain("mode: fast");
        expect(out).not.toContain("apps/platform-web:lint");
        expect(out).toContain("apps/platform-web:typecheck");
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "ambient PREPUSH_GATE_DRY / PREPUSH_GATE_TEST_FILES cannot override the harness",
    () => {
      // Ambient DRY=0 must not make the gate actually execute checks, and an ambient
      // file list must not replace the one the test passed in (package.json would
      // otherwise force full-suite).
      withAmbientEnv({ PREPUSH_GATE_DRY: "0", PREPUSH_GATE_TEST_FILES: "package.json" }, () => {
        const out = classify(["apps/platform-web/src/x.tsx"]);
        expect(out).toContain("scoped");
        expect(out).toContain("apps/platform-web:typecheck");
        expect(out).toContain("apps/platform-web:test");
        expect(out).not.toContain("full-suite");
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  test("gateEnv removes gate keys in any casing and keeps the rest of the env", () => {
    // Injects the gate keys in lower/mixed case so the assertion actually depends
    // on the case-insensitive filtering: on Windows these ARE the same variables,
    // and on Linux they are distinct ones that a case-sensitive filter would leak
    // straight into the child. Drop the `.toUpperCase()` in gateEnv and this fails.
    // The sentinel proves unrelated ambient env survives — a length check cannot.
    withAmbientEnv(
      {
        prepush_gate_fast: "1",
        Prepush_Gate_Dry: "0",
        PREPUSH_GATE_TEST_FILES: "package.json",
        PREPUSH_GATE_SENTINEL_KEPT: "yes",
      },
      () => {
        const env = gateEnv({ PREPUSH_GATE_DRY: "1" });

        // Compare against GATE_ENV_KEYS, not a `PREPUSH_GATE_` prefix: only those
        // three keys are owned by the harness, and the sentinel below shares the
        // prefix precisely to prove the filter is key-scoped rather than prefix-scoped.
        const leaked = Object.keys(env).filter(
          (key) => GATE_ENV_KEYS.includes(key.toUpperCase()) && key !== "PREPUSH_GATE_DRY",
        );
        expect(leaked).toEqual([]);

        expect(env.PREPUSH_GATE_DRY).toBe("1");
        expect(env.PREPUSH_GATE_SENTINEL_KEPT).toBe("yes");
        // non-gate env is still inherited, so the child can find node/bun and its deps
        expect(env.PATH ?? env.Path).toBeDefined();
      },
    );
  });
});
