import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "prepush-gate.mjs"
);

function classify(files) {
  return execFileSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PREPUSH_GATE_TEST_FILES: files.join(","),
      PREPUSH_GATE_DRY: "1",
    },
  }).trim();
}

describe("prepush-gate classification", () => {
  test("docs-only pushes are classified docs-only", () => {
    expect(
      classify(["docs/plans/some-plan.md", "DESIGN.md", ".sonarcloud.properties"])
    ).toContain("docs-only");
  });

  test("design artifacts and claude config count as docs", () => {
    expect(
      classify(["docs/design/user-flow-wireframes.html", ".claude/launch.json", "README.md"])
    ).toContain("docs-only");
  });

  test("any source file forces the full suite", () => {
    expect(classify(["docs/a.md", "apps/roadmap-web/src/x.ts"])).toContain("full-suite");
  });

  test("script and config changes force the full suite", () => {
    expect(classify(["scripts/prepush-gate.mjs"])).toContain("full-suite");
    expect(classify(["lefthook.yml"])).toContain("full-suite");
    expect(classify(["apps/meeting-web/vercel.json"])).toContain("full-suite");
  });

  test("an empty change set is never classified docs-only", () => {
    expect(classify([])).toContain("full-suite");
  });

  test("markdown outside the allowlist is not docs-only", () => {
    expect(classify(["apps/roadmap-web/CLAUDE.md"])).toContain("full-suite");
  });
});
