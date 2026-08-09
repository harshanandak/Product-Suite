import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..", "..");

test("deployment rebinding verification does not require retired Roadmap Playwright CI", () => {
  const verifier = readFileSync(
    join(rootDir, "scripts", "deployment", "verify-monorepo-rebinding.mjs"),
    "utf8",
  );

  expect(verifier).not.toContain(".github/workflows/roadmap-web-playwright.yml");
});
