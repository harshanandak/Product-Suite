import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "vitest";

describe("BlockSuite 0.19.5 spaceDoc persistence", () => {
  test("keeps the public Bun restore rejection reproducible", () => {
    const probe = fileURLToPath(new URL("./persistence-rejection.bun.js", import.meta.url));
    const repositoryRoot = fileURLToPath(new URL("../../../..", import.meta.url));
    const result = spawnSync("bun", ["test", probe], {
      cwd: repositoryRoot,
      encoding: "utf8",
      timeout: 30_000,
      killSignal: "SIGKILL",
    });
    const output = `${result.stdout}${result.stderr}`;

    if (process.platform !== "win32") {
      expect(result.status).toBe(0);
      expect(output).toContain("1 pass");
      expect(output).not.toContain("BlockSuiteError");
      return;
    }

    expect(result.status).toBe(1);
    expect(output).toContain("BlockSuiteError: block children is not found when creating model");
    expect(output).toContain("code: 4");
    expect(output).toContain("Received  + 1");
    expect(output).toContain("+ []");
  }, 35_000);
});
