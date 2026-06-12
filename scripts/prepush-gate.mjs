#!/usr/bin/env node
// Pre-push gate: skip the heavy validation suite when a push contains only
// documentation/design changes. Anything else (or any uncertainty about the
// push range) runs the full suite — the gate can only ever skip work it has
// positively classified as docs-only.
import { execFileSync, spawnSync } from "node:child_process";

const DOCS_ONLY = [
  /^docs\//,
  /^DESIGN\.md$/,
  /^README\.md$/,
  /^CHANGELOG\.md$/,
  /^AGENTS\.md$/,
  /^\.sonarcloud\.properties$/,
  /^\.claude\//,
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

function changedFiles() {
  if (process.env.PREPUSH_GATE_TEST_FILES !== undefined) {
    return process.env.PREPUSH_GATE_TEST_FILES.split(",").filter(Boolean);
  }
  // Compare against the branch's push target. If there is no upstream yet
  // (first push of a branch), classification is impossible — return null to
  // force the full suite.
  try {
    const upstream = git(["rev-parse", "--abbrev-ref", "@{push}"]);
    const out = git(["diff", "--name-only", `${upstream}...HEAD`]);
    return out === "" ? [] : out.split("\n");
  } catch {
    return null;
  }
}

const files = changedFiles();
const docsOnly =
  Array.isArray(files) &&
  files.length > 0 &&
  files.every((f) => DOCS_ONLY.some((re) => re.test(f)));

// Dry-run mode for tests: report the classification without running anything.
if (process.env.PREPUSH_GATE_DRY === "1") {
  console.log(docsOnly ? "classification: docs-only" : "classification: full-suite");
  process.exit(0);
}

// Static argument arrays only; shell:true is required on Windows to resolve
// bun's .cmd shim, and nothing user-controlled is interpolated.
if (docsOnly) {
  console.log(
    `prepush-gate: docs-only push (${files.length} file${files.length === 1 ? "" : "s"}) — skipping app suites, running fast checks only.`
  );
  const fast = spawnSync("bun", ["run", "check:source-test"], {
    stdio: "inherit",
    shell: true,
  });
  process.exit(fast.status ?? 1);
}

if (files === null) {
  console.log("prepush-gate: no upstream to diff against — running the full suite.");
} else {
  console.log("prepush-gate: non-docs changes detected — running the full suite.");
}
const full = spawnSync("bun", ["run", "test:prepush"], {
  stdio: "inherit",
  shell: true,
});
process.exit(full.status ?? 1);
