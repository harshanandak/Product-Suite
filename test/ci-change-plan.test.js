import { describe, expect, test } from "bun:test";
import { planFromInputs, resolveGitExecutable } from "../scripts/ci-change-plan.mjs";

describe("CI change-plan adapter", () => {
  test("uses only fixed Git executable locations", () => {
    expect(resolveGitExecutable({
      platform: "linux",
      fileExists: (candidate) => candidate === "/usr/bin/git",
    })).toBe("/usr/bin/git");
    expect(resolveGitExecutable({ platform: "unsupported", fileExists: () => true })).toBeNull();
  });

  test("rejects an invalid range with a full DB-required plan", () => {
    const plan = planFromInputs({
      baseSha: "not-a-sha",
      headSha: "a".repeat(40),
      files: ["docs/only.md"],
    });
    expect(plan.inputValid).toBe(false);
    expect(plan.classification).toBe("full-suite");
    expect(plan.dbEvidenceRequired).toBe(true);
    expect(plan.exactSha).toBe("a".repeat(40));
  });

  test("rejects all-zero GitHub SHAs with a full DB-required plan", () => {
    for (const input of [
      { baseSha: "0".repeat(40), headSha: "a".repeat(40) },
      { baseSha: "a".repeat(40), headSha: "0".repeat(40) },
    ]) {
      const plan = planFromInputs({ ...input, files: ["docs/only.md"] });
      expect(plan.inputValid).toBe(false);
      expect(plan.classification).toBe("full-suite");
      expect(plan.dbEvidenceRequired).toBe(true);
    }
  });
});
