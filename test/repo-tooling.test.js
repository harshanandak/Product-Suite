import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "package.json"), "utf8"),
);

describe("repo tooling", () => {
  test("root CI scripts validate both web workspaces", () => {
    expect(packageJson.scripts["ci:meeting-web"]).toContain("apps/meeting-web");
    expect(packageJson.scripts["ci:roadmap-web"]).toContain("apps/roadmap-web");
  });
});
