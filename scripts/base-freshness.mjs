#!/usr/bin/env node
// Exact-head/base-ancestry verifier used by the always-on PR freshness check.
// The pure verdict is exported so the race where main advances after an older
// check can be tested without network access or wall-clock assumptions.
import { execFileSync, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const REF_PATTERN = /^[A-Za-z0-9._/-]+$/;

export function evaluateBaseFreshness({ expectedHead, actualHead, currentBase, isAncestor } = {}) {
  if (![expectedHead, actualHead, currentBase].every((value) => typeof value === "string" && SHA_PATTERN.test(value))) {
    return { ok: false, code: "BASE_FRESHNESS_INPUT_INVALID" };
  }
  if (expectedHead.toLowerCase() !== actualHead.toLowerCase()) {
    return { ok: false, code: "HEAD_MISMATCH" };
  }
  if (isAncestor !== true) return { ok: false, code: "BASE_STALE" };
  return { ok: true, code: "BASE_CURRENT" };
}

function main() {
  const expectedHead = process.env.EXPECTED_HEAD ?? "";
  const baseRef = process.env.BASE_REF ?? "";
  if (!REF_PATTERN.test(baseRef) || baseRef.includes("..")) {
    console.error("BASE_FRESHNESS_REF_INVALID");
    process.exit(1);
  }

  let actualHead;
  let currentBase;
  try {
    actualHead = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    currentBase = execFileSync("git", ["rev-parse", `refs/remotes/origin/${baseRef}`], { encoding: "utf8" }).trim();
  } catch {
    console.error("BASE_FRESHNESS_REF_UNAVAILABLE");
    process.exit(1);
  }

  const ancestry = spawnSync("git", ["merge-base", "--is-ancestor", currentBase, actualHead]);
  const result = evaluateBaseFreshness({
    expectedHead,
    actualHead,
    currentBase,
    isAncestor: ancestry.status === 0,
  });
  console.log(JSON.stringify({ ...result, expectedHead, actualHead, currentBase }));
  if (!result.ok) process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
