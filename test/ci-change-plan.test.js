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

  test("Forge config uses the docs-only CI plan", () => {
    const plan = planFromInputs({
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      files: [".forge/config.yaml"],
      fileContents: {},
    });
    expect(plan.classification).toBe("docs-only");
    expect(plan.cheapScripts).toEqual(["check:source-test"]);
    expect(plan.dbEvidenceRequired).toBe(false);
  });

  test("Forge config riding along preserves the workspace CI plan", () => {
    const input = {
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      fileContents: {},
    };
    const file = "apps/platform-web/src/x.tsx";
    expect(planFromInputs({ ...input, files: [".forge/config.yaml", file] })).toEqual(
      planFromInputs({ ...input, files: [file] }),
    );
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

  test("keeps archived Roadmap API guidance on the fail-closed plan", () => {
    const file = "apps/roadmap-web/src/app/api/CLAUDE.md";
    const baseSha = "a".repeat(40);
    const headSha = "b".repeat(40);
    const verified = planFromInputs({
      baseSha,
      headSha,
      files: [file],
      fileContents: { [file]: "@AGENTS.md\n" },
    });
    expect(verified.inputValid).toBe(true);
    expect(verified.classification).toBe("full-suite");
    expect(verified.dbEvidenceRequired).toBe(true);

    const unverified = planFromInputs({ baseSha, headSha, files: [file], fileContents: {} });
    expect(unverified.classification).toBe("full-suite");
    expect(unverified.dbEvidenceRequired).toBe(true);
  });
});
