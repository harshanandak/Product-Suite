#!/usr/bin/env node
// Pre-push gate: run only the validation suites a push actually affects.
//
// Philosophy: the pre-push hook is for FAST local feedback (lint + typecheck +
// unit tests). It does NOT build apps — every app is built and tested by its own
// CI workflow on pull_request, which is the real merge gate, so building locally
// on every push only duplicates CI's slowest step. A build-only break is caught
// by CI before merge, not here.
//
// This file is the impure SHELL: read the git diff, honour the env toggles, print
// the plan, run the suites. The classification itself lives in
// `scripts/prepush-classify.mjs` — a pure module the self-test drives in-process,
// so proving the routing rules costs no process spawns. See that file's header.
//
// Env toggles:
//   PREPUSH_GATE_FAST=1  → fast mode (mirrors `forge push --quick`): for each
//     AFFECTED workspace whose gate INCLUDES lint, retain typecheck if gated and
//     DEFER that workspace's test step to CI. Aggregate lint still runs once
//     first. A workspace with NO lint step — its tests are the ONLY local safety
//     net (every test-only package/service) —
//     STILL runs its full suite incl. test, so fast mode can
//     never green-light a broken API/DB/logic change locally. The always-on cheap
//     checks and the docs-only fast path are unchanged, and branch protection (a
//     separate push-hook step) still applies. Unset (default) = full verify incl.
//     tests for every workspace, exactly as before.
//   PREPUSH_GATE_DRY=1        → print the classification, run nothing (tests).
//   PREPUSH_GATE_TEST_FILES   → comma-separated changed-file override (tests).
import { execFileSync, spawnSync } from "node:child_process";
import {
  affectedDirsFor,
  classify,
  DOCS,
  fastChecksFor,
  SCOPED,
  suitesFor,
  WORKSPACE_DIRS,
} from "./prepush-classify.mjs";

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

const ROOT_LINT = { label: "lint", argv: ["run", "lint"] };
const LOCAL_VERIFY_STEPS = {
  "verify:platform-web": ["apps/platform-web", ["typecheck", "test"]],
  "verify:platform-api": ["apps/platform-api", ["typecheck", "test"]],
  "verify:meeting-web": ["apps/meeting-web", ["test"]],
  "verify:db": ["packages/db", ["typecheck", "test"]],
};

function checksForScripts(scripts) {
  return scripts.flatMap((script) => {
    const local = LOCAL_VERIFY_STEPS[script];
    if (!local) return [{ label: script, argv: ["run", script] }];
    const [cwd, steps] = local;
    return steps.map((step) => ({
      label: `${cwd}:${step}`,
      argv: ["run", "--cwd", cwd, step],
    }));
  });
}

// Run command descriptors ({ label, argv }) sequentially with live output.
function runChecks(checks) {
  for (const { argv } of checks) {
    // Static argument arrays only; shell:true resolves bun's .cmd shim on Windows
    // and nothing user-controlled is interpolated.
    const r = spawnSync("bun", argv, { stdio: "inherit", shell: true }); // NOSONAR(S4036)
    const status = r.status ?? 1;
    if (status !== 0) process.exit(status);
  }
  process.exit(0);
}

// Opt-in fast mode: aggregate lint + affected typechecks, while test-only suites
// remain local. Default (unset) = full verify.
const FAST = process.env.PREPUSH_GATE_FAST === "1";

const result = classify(changedFiles());

let checks;
if (result.kind === DOCS) {
  checks = checksForScripts(["check:source-test"]);
} else if (FAST) {
  checks = fastChecksFor(affectedDirsFor(result));
} else if (result.kind === SCOPED) {
  checks = checksForScripts(result.suites);
} else {
  checks = checksForScripts(suitesFor(new Set(WORKSPACE_DIRS)));
}
checks.unshift(ROOT_LINT);

// Dry-run mode for tests: report the classification without running anything.
if (process.env.PREPUSH_GATE_DRY === "1") {
  const lines = [`classification: ${result.kind}`];
  if (FAST && result.kind !== DOCS) {
    lines.push("mode: fast (aggregate lint + affected typechecks; test-only suites retained)");
  }
  lines.push(`checks: ${checks.map(({ label }) => label).join(", ")}`);
  console.log(lines.join("\n"));
  process.exit(0);
}

if (result.kind === DOCS) {
  console.log("prepush-gate: docs-only push — running fast checks only.");
} else if (FAST) {
  const scope = result.kind === SCOPED ? `scoped [${result.owners.join(", ")}]` : result.reason;
  console.log(
    `prepush-gate: ${scope} — FAST mode: aggregate lint + affected typechecks (${checks.length} checks); test-only suites retained.`,
  );
} else if (result.kind === SCOPED) {
  console.log(
    `prepush-gate: scoped push [${result.owners.join(", ")}] — running: ${checks.map(({ label }) => label).join(", ")}`,
  );
} else {
  console.log(
    `prepush-gate: ${result.reason} — running the full suite (${checks.length} checks, no app builds).`,
  );
}

runChecks(checks);
