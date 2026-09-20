import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..", "..");

test("deployment rebinding verification does not require retired Roadmap Playwright CI", () => {
  const verifier = readFileSync(
    join(rootDir, "scripts", "deployment", "verify-monorepo-rebinding.mjs"),
    "utf8",
  );

  expect(verifier).not.toContain(".github/workflows/roadmap-web-playwright.yml");
});

test("deployment rebinding excludes the archived Roadmap runtime", () => {
  const verifier = readFileSync(
    join(rootDir, "scripts", "deployment", "verify-monorepo-rebinding.mjs"),
    "utf8",
  );
  const registry = JSON.parse(readFileSync(
    join(rootDir, "docs", "deployment", "service-registry.json"),
    "utf8",
  ));
  const roadmap = registry.services.find((service) => service.id === "roadmap-web");

  expect(verifier).not.toContain("apps/roadmap-web/package.json");
  expect(verifier).not.toContain(".github/workflows/roadmap-web-ci.yml");
  expect(roadmap.supported).toBe(false);
  expect(roadmap.targetRootDirectory).toBeNull();
  expect(roadmap.currentBuildCommand).toBeNull();
  expect(existsSync(join(rootDir, "apps", "roadmap-web", "ARCHIVED.md"))).toBe(true);
});
