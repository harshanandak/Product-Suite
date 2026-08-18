#!/usr/bin/env node
// Workflow-facing adapter for the pure changed-surface CI plan.  Git and env
// access live here; scripts/prepush-classify.mjs remains deterministic and
// importable by the local pre-push and repo-tooling tests.
import { appendFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import {
  buildCiPlan,
  isValidSha,
  ROADMAP_API_CLAUDE_PATTERN,
} from "./prepush-classify.mjs";

const GIT_EXECUTABLES = Object.freeze({
  win32: Object.freeze([
    String.raw`C:\Program Files\Git\cmd\git.exe`,
    String.raw`C:\Program Files\Git\bin\git.exe`,
  ]),
  linux: Object.freeze(["/usr/bin/git"]),
  darwin: Object.freeze(["/usr/bin/git", "/opt/homebrew/bin/git", "/usr/local/bin/git"]),
});

export function resolveGitExecutable({ platform = process.platform, fileExists = existsSync } = {}) {
  return GIT_EXECUTABLES[platform]?.find((candidate) => fileExists(candidate)) ?? null;
}

function changedFiles(baseSha, headSha) {
  const gitExecutable = resolveGitExecutable();
  if (!gitExecutable) return null;
  try {
    const output = execFileSync(
      gitExecutable,
      ["diff", "--no-renames", "--name-only", `${baseSha}...${headSha}`],
      { encoding: "utf8" },
    );
    return output.split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function changedFileContents(headSha, files) {
  const gitExecutable = resolveGitExecutable();
  if (!gitExecutable) return undefined;
  const contents = {};
  for (const file of files.filter((candidate) => ROADMAP_API_CLAUDE_PATTERN.test(candidate))) {
    try {
      contents[file] = execFileSync(
        gitExecutable,
        ["show", `${headSha}:${file}`],
        { encoding: "utf8" },
      );
    } catch {
      // Missing/deleted blobs intentionally stay absent and fail closed.
    }
  }
  return contents;
}

function normalizeFiles(files) {
  if (Array.isArray(files)) return files;
  if (typeof files !== "string") return null;
  return files.split(/[\r\n,]+/).map((file) => file.trim()).filter(Boolean);
}

export function planFromInputs({ baseSha, headSha, files, fileContents } = {}) {
  const validBase = isValidSha(baseSha) && !/^0{40}$/.test(baseSha);
  const validHead = isValidSha(headSha) && !/^0{40}$/.test(headSha);
  let suppliedFiles;
  if (files !== undefined) suppliedFiles = normalizeFiles(files);
  else if (validBase && validHead) suppliedFiles = changedFiles(baseSha, headSha);
  else suppliedFiles = null;
  const validRange = validBase && validHead && Array.isArray(suppliedFiles);
  // A malformed base or unavailable diff still has a trustworthy head supplied
  // by GitHub. Preserve it so full cheap gates can run against that exact commit;
  // only a malformed head prevents checkout and remains a hard failure.
  const resolvedFileContents = fileContents ?? (
    validHead && Array.isArray(suppliedFiles)
      ? changedFileContents(headSha, suppliedFiles)
      : undefined
  );
  const plan = buildCiPlan({
    files: suppliedFiles,
    exactSha: validHead ? headSha : null,
    fileContents: resolvedFileContents,
  });
  if (!validRange) {
    plan.exactSha = validHead ? headSha.trim().toLowerCase() : null;
    plan.inputValid = false;
    plan.classification = "full-suite";
    plan.reason = !validBase || !validHead ? "invalid base/head SHA" : "unable to resolve changed-file range";
    plan.dbEvidenceRequired = true;
    plan.dbEvidenceReason = "authority/security/migration or ambiguous change";
    // Recompute the full ordered cheap list without importing more workflow code.
    plan.cheapScripts = buildCiPlan(null, "a".repeat(40)).cheapScripts;
  }
  return plan;
}

function writeGitHubOutputs(plan) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  const lines = [
    `schemaVersion=${plan.schemaVersion}`,
    `exactSha=${plan.exactSha ?? ""}`,
    `inputValid=${plan.inputValid}`,
    `classification=${plan.classification}`,
    `reason=${plan.reason}`,
    `cheapScripts=${plan.cheapScripts.join(",")}`,
    `cheapScriptsJson=${JSON.stringify(plan.cheapScripts)}`,
    `dbEvidenceRequired=${plan.dbEvidenceRequired}`,
    `planJson<<CI_PLAN_EOF`,
    JSON.stringify(plan),
    "CI_PLAN_EOF",
  ];
  appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const plan = planFromInputs({
    baseSha: process.env.CI_CHANGE_PLAN_BASE_SHA ?? process.env.BASE_SHA,
    headSha: process.env.CI_CHANGE_PLAN_HEAD_SHA ?? process.env.HEAD_SHA,
    files: process.env.CI_CHANGE_PLAN_FILES,
  });
  console.log(JSON.stringify(plan));
  writeGitHubOutputs(plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
