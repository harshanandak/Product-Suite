import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

// The forge CLI's push command shells out to `node scripts/branch-protection.js`
// as its pre-push branch-protection pre-check. Product-Suite retired that legacy
// script in favor of scripts/prepush-gate.mjs (wired via lefthook), which made
// every `forge push` in this repo abort with MODULE_NOT_FOUND. This shim restores
// the contract the CLI and direct git pre-push hook expect: block direct pushes
// to protected branches, allow everything else.

const SCRIPT = path.join(import.meta.dir, "..", "scripts", "branch-protection.js");
const LEFTHOOK_CONFIG = path.join(import.meta.dir, "..", "lefthook.yml");
const require = createRequire(import.meta.url);
const { main } = require(SCRIPT);

function exitCodeFor(branch, prePushInput) {
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    return main({ argv: [], currentBranch: branch, prePushInput });
  } finally {
    error.mockRestore();
  }
}

describe("scripts/branch-protection.js shim", () => {
  test("allows feature branches and blocks protected branches", () => {
    expect(exitCodeFor("feat/some-feature")).toBe(0);
    expect(exitCodeFor("main")).toBe(1);
    expect(exitCodeFor("master")).toBe(1);
  });

  test("runs as the executable contract used by forge push", () => {
    expect(() => execFileSync(process.execPath, [SCRIPT], {
      env: { ...process.env, LEFTHOOK_GIT_BRANCH: "feat/some-feature" },
      stdio: "pipe",
    })).not.toThrow();
  });

  test("runs before validation in the direct git pre-push hook", () => {
    const config = readFileSync(LEFTHOOK_CONFIG, "utf8");
    expect(config).toContain("run: node scripts/branch-protection.js");
    expect(config).toMatch(/run: node scripts\/branch-protection\.js\r?\n\s+use_stdin: true/);
    expect(config.indexOf("branch-protection.js")).toBeLessThan(config.indexOf("prepush-gate.mjs"));
  });

  test("protects remote destinations instead of the checked-out branch", () => {
    const oid = "1".repeat(40);
    const oldOid = "0".repeat(40);
    const protectedPush = `HEAD ${oid} refs/heads/main ${oldOid}\n`;
    expect(exitCodeFor("feat/source", protectedPush)).toBe(1);
    expect(exitCodeFor("feat/source", `HEAD ${oid} refs/heads/master ${oldOid}\n`)).toBe(1);
    expect(exitCodeFor("main", `HEAD ${oid} refs/heads/feature ${oldOid}\n`)).toBe(0);
    expect(exitCodeFor("feat/source", "HEAD not-an-oid refs/heads/feature also-not-an-oid\n")).toBe(1);
    expect(() => execFileSync(process.execPath, [SCRIPT], {
      env: { ...process.env, LEFTHOOK_GIT_BRANCH: "feat/source" },
      input: protectedPush,
      stdio: ["pipe", "pipe", "pipe"],
    })).toThrow();
  });
});
