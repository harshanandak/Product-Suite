import { describe, expect, test } from "bun:test";
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
const { isProtectedBranch } = require(SCRIPT);

describe("scripts/branch-protection.js shim", () => {
  test("branch decisions allow feature branches and block protected branches", () => {
    expect(isProtectedBranch("feat/some-feature")).toBe(false);
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("master")).toBe(true);
  });

  test("branch decisions accept an injected protected-branch set", () => {
    expect(isProtectedBranch("release", new Set(["release"]))).toBe(true);
    expect(isProtectedBranch("main", new Set(["release"]))).toBe(false);
  });
});
