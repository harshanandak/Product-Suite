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
//     AFFECTED workspace whose gate INCLUDES lint, run only lint (+ typecheck if
//     gated) and DEFER the test step to CI. A workspace with NO lint step — its
//     tests are the ONLY local safety net (platform-api, db, every test-only
//     package/service) — STILL runs its full suite incl. test, so fast mode can
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
  describeClassification,
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

// Run FAST-mode command descriptors ({ label, argv }) SEQUENTIALLY, live output.
// Same fail-fast, same Windows .cmd-shim handling as runScripts; only the argv
// shape differs (per-workspace `run --cwd <dir> <script>` vs a root script name).
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

// Opt-in fast mode: lint + typecheck locally, tests deferred to CI (mirrors the
// documented `forge push --quick` contract). Default (unset) = full verify.
const FAST = process.env.PREPUSH_GATE_FAST === "1";

const result = classify(changedFiles());

// Dry-run mode for tests: report the classification without running anything.
if (process.env.PREPUSH_GATE_DRY === "1") {
  console.log(describeClassification(result, { fast: FAST }));
  process.exit(0);
}

if (result.kind === DOCS) {
  // Docs-only stays on the fast path regardless of FAST — nothing to narrow.
  console.log("prepush-gate: docs-only push — running fast checks only.");
  runScripts(["check:source-test"]);
} else if (FAST) {
  const checks = fastChecksFor(affectedDirsFor(result));
  const scope = result.kind === SCOPED ? `scoped [${result.owners.join(", ")}]` : result.reason;
  console.log(
    `prepush-gate: ${scope} — FAST mode: lint+typecheck only (${checks.length} checks); tests deferred to CI.`,
  );
  runChecks(checks);
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
