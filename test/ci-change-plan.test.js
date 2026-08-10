import { describe, expect, test } from "bun:test";
import { planFromInputs } from "../scripts/ci-change-plan.mjs";

describe("CI change-plan adapter", () => {
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
});
