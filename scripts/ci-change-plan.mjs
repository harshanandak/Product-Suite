#!/usr/bin/env node
// Workflow-facing adapter for the pure changed-surface CI plan.  Git and env
// access live here; scripts/prepush-classify.mjs remains deterministic and
// importable by the local pre-push and repo-tooling tests.
import { appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { buildCiPlan, isValidSha } from "./prepush-classify.mjs";

function changedFiles(baseSha, headSha) {
  try {
    const output = execFileSync(
      "git",
      ["diff", "--no-renames", "--name-only", `${baseSha}...${headSha}`],
      { encoding: "utf8" },
    );
    return output.split(/\r?\n/).map((file) => file.trim()).filter(Boolean);
  } catch {
    return null;
  }
}

function normalizeFiles(files) {
  if (Array.isArray(files)) return files;
  if (typeof files !== "string") return null;
  return files.split(/[\r\n,]+/).map((file) => file.trim()).filter(Boolean);
}

export function planFromInputs({ baseSha, headSha, files } = {}) {
  const validBase = isValidSha(baseSha);
  const validHead = isValidSha(headSha);
  const suppliedFiles = files === undefined ? (validBase && validHead ? changedFiles(baseSha, headSha) : null) : normalizeFiles(files);
  const validRange = validBase && validHead && Array.isArray(suppliedFiles);
  const plan = buildCiPlan(suppliedFiles, validRange ? headSha : null);
  if (!validRange) {
    plan.exactSha = null;
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

if (import.meta.main) main();
