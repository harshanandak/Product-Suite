import { describe, expect, spyOn, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

// The forge CLI's push command shells out to `node scripts/branch-protection.js`
// as its pre-push branch-protection pre-check. Product-Suite retired that legacy
// script in favor of scripts/prepush-gate.mjs (wired via lefthook), which made
// every `forge push` in this repo abort with MODULE_NOT_FOUND. This shim restores
// the contract the CLI expects: block direct pushes to protected branches, allow
// everything else.

const SCRIPT = path.join(import.meta.dir, "..", "scripts", "branch-protection.js");
const require = createRequire(import.meta.url);
const { main } = require(SCRIPT);

function exitCodeFor(branch) {
  const error = spyOn(console, "error").mockImplementation(() => {});
  try {
    return main({ argv: [], currentBranch: branch });
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
});
