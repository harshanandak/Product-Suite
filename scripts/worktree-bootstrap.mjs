#!/usr/bin/env bun

import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  rmSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED_BINARIES = [
  ["node_modules", ".bin", "lefthook"],
  ["apps", "platform-api", "node_modules", ".bin", "eslint"],
  ["apps", "platform-api", "node_modules", ".bin", "tsc"],
  ["apps", "platform-api", "node_modules", ".bin", "vitest"],
  ["apps", "platform-web", "node_modules", ".bin", "eslint"],
  ["apps", "platform-web", "node_modules", ".bin", "tsc"],
  ["apps", "platform-web", "node_modules", ".bin", "vitest"],
];

function commandFailure(command, args, result) {
  if (result.error) return `${command} could not start: ${result.error.message}`;
  if (result.signal) return `${command} ${args.join(" ")} was killed by ${result.signal}`;
  return `${command} ${args.join(" ")} exited with code ${result.status}`;
}

function runChecked(command, args, options, spawn = spawnSync) {
  const result = spawn(command, args, options);
  if (result?.error || result?.signal || result?.status !== 0) {
    throw new Error(commandFailure(command, args, result ?? { status: "unknown" }));
  }
  return result;
}

function isInside(parent, child) {
  const pathFromParent = relative(parent, child);
  return pathFromParent !== ""
    && pathFromParent !== ".."
    && !pathFromParent.startsWith(`..${sep}`)
    && !isAbsolute(pathFromParent);
}

function assertSafeWorktree(worktreePath, repoRoot) {
  const worktreesDir = resolve(repoRoot, ".worktrees");
  if (!existsSync(worktreesDir) || !existsSync(worktreePath)) {
    throw new Error(`Worktree path does not exist: ${worktreePath}`);
  }

  const realWorktreesDir = realpathSync(worktreesDir);
  const realWorktreePath = realpathSync(worktreePath);
  if (!isInside(realWorktreesDir, realWorktreePath)) {
    throw new Error(`Worktree must be inside ${realWorktreesDir}`);
  }
  if (!existsSync(join(realWorktreePath, ".git"))) {
    throw new Error(`Target is not a registered Git worktree: ${realWorktreePath}`);
  }
  return realWorktreePath;
}

function workspacePaths(worktreePath) {
  const manifest = JSON.parse(readFileSync(join(worktreePath, "package.json"), "utf8"));
  const workspaces = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : manifest.workspaces?.packages;
  if (!Array.isArray(workspaces)) {
    throw new Error("package.json must declare an array of workspaces");
  }
  if (workspaces.some((workspace) => /[*?[\]{}]/u.test(workspace))) {
    throw new Error("Worktree bootstrap requires explicit workspace paths, not globs");
  }
  return workspaces.map((workspace) => resolve(worktreePath, workspace));
}

function lstatExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function removeDependencyTrees(worktreePath) {
  const dependencyTrees = [
    join(worktreePath, "node_modules"),
    ...workspacePaths(worktreePath).map((workspace) => join(workspace, "node_modules")),
  ];
  for (const dependencyTree of dependencyTrees) {
    if (!isInside(worktreePath, dependencyTree)) {
      throw new Error(`Refusing to remove dependency path outside worktree: ${dependencyTree}`);
    }
    if (existsSync(dependencyTree) || lstatExists(dependencyTree)) {
      rmSync(dependencyTree, { recursive: true, force: true });
    }
  }
}

function findBinary(worktreePath, segments) {
  const base = join(worktreePath, ...segments);
  const candidates = process.platform === "win32"
    ? [`${base}.exe`, `${base}.cmd`, base]
    : [base];
  return candidates.find((candidate) => existsSync(candidate));
}

function verifyBinaries(worktreePath) {
  const missing = REQUIRED_BINARIES
    .filter((segments) => !findBinary(worktreePath, segments))
    .map((segments) => segments.join("/"));
  if (missing.length > 0) {
    throw new Error(`Worktree install is incomplete; missing binaries: ${missing.join(", ")}`);
  }
  return REQUIRED_BINARIES.length;
}

export function resolveWorktreePath(repoRoot, slug) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u.test(slug) || slug.includes("..")) {
    throw new Error(`Invalid worktree slug: ${slug}`);
  }
  return resolve(repoRoot, ".worktrees", slug);
}

export function bootstrapWorktree(worktreePath, repoRoot, options = {}) {
  const safeWorktreePath = assertSafeWorktree(resolve(worktreePath), resolve(repoRoot));
  removeDependencyTrees(safeWorktreePath);
  const runSpawn = options.spawnSync ?? spawnSync;
  runChecked(
    "bun",
    ["install", "--frozen-lockfile", "--backend", "copyfile"],
    { cwd: safeWorktreePath, stdio: options.stdio ?? "inherit" },
    runSpawn,
  );
  return {
    worktreePath: safeWorktreePath,
    verifiedBinaries: verifyBinaries(safeWorktreePath),
  };
}

function repoRootFrom(cwd) {
  const commonGitDir = execFileSync(
    "git",
    ["-C", cwd, "rev-parse", "--path-format=absolute", "--git-common-dir"],
    {
    encoding: "utf8",
    },
  ).trim();
  return dirname(commonGitDir);
}

function flagValue(args, flag, fallback) {
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag) {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      return value;
    }
    if (args[index].startsWith(`${flag}=`)) {
      const value = args[index].slice(flag.length + 1);
      if (!value) throw new Error(`${flag} requires a value`);
      return value;
    }
  }
  return fallback;
}

function branchExists(repoRoot, branch, spawn) {
  const result = spawn(
    "git",
    ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`],
    { cwd: repoRoot, stdio: "pipe" },
  );
  if (result?.error || result?.signal || ![0, 1].includes(result?.status)) {
    throw new Error(commandFailure("git", ["show-ref", "--verify", branch], result));
  }
  return result.status === 0;
}

export function createWorktree(slug, forgeArgs = [], options = {}) {
  const repoRoot = options.repoRoot ?? repoRootFrom(options.cwd ?? process.cwd());
  const worktreePath = resolveWorktreePath(repoRoot, slug);
  const runSpawn = options.spawnSync ?? spawnSync;
  const commandOptions = { cwd: repoRoot, stdio: options.stdio ?? "inherit" };
  const branch = flagValue(forgeArgs, "--branch", `codex/${slug}`);
  const base = flagValue(forgeArgs, "--base", "origin/HEAD");
  if (existsSync(worktreePath)) {
    throw new Error(`Worktree already exists; use worktree:bootstrap instead: ${worktreePath}`);
  }

  runChecked("git", ["check-ref-format", "--branch", branch], commandOptions, runSpawn);
  runChecked("git", ["rev-parse", "--verify", `${base}^{commit}`], commandOptions, runSpawn);
  const addArgs = branchExists(repoRoot, branch, runSpawn)
    ? ["worktree", "add", worktreePath, branch]
    : ["worktree", "add", worktreePath, "-b", branch, base];
  runChecked("git", addArgs, commandOptions, runSpawn);

  const registrationArgs = [...forgeArgs];
  if (flagValue(forgeArgs, "--branch", null) === null) {
    registrationArgs.push("--branch", branch);
  }
  if (flagValue(forgeArgs, "--base", null) === null) {
    registrationArgs.push("--base", base);
  }
  runChecked(
    "forge",
    ["worktree", "create", slug, ...registrationArgs],
    commandOptions,
    runSpawn,
  );
  return bootstrapWorktree(worktreePath, repoRoot, options);
}

function printUsage() {
  console.error("Usage: bun run worktree:create -- <slug> [forge worktree create flags]");
  console.error("   or: bun run worktree:bootstrap -- <absolute-worktree-path>");
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const [mode, first, ...rest] = process.argv.slice(2);
  try {
    if (mode === "create" && first) {
      const result = createWorktree(first, rest);
      console.log(`Worktree ready: ${result.worktreePath} (${result.verifiedBinaries} binaries verified)`);
    } else if (mode === "bootstrap" && first) {
      const repoRoot = repoRootFrom(process.cwd());
      const result = bootstrapWorktree(first, repoRoot);
      console.log(`Worktree ready: ${result.worktreePath} (${result.verifiedBinaries} binaries verified)`);
    } else {
      printUsage();
      process.exitCode = 2;
    }
  } catch (error) {
    console.error(`Worktree bootstrap failed: ${error.message}`);
    process.exitCode = 1;
  }
}
