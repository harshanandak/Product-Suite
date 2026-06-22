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

  test("cross-cutting / infra changes force the full suite", () => {
    expect(classify(["scripts/prepush-gate.mjs"])).toContain("full-suite");
    expect(classify(["lefthook.yml"])).toContain("full-suite");
    expect(classify(["apps/meeting-web/vercel.json"])).toContain("full-suite");
    expect(classify(["package.json"])).toContain("full-suite");
    expect(classify(["tsconfig.base.json"])).toContain("full-suite");
  });

  test("an empty change set is never classified docs-only", () => {
    expect(classify([])).toContain("full-suite");
  });

  test("a lockfile change forces the full suite (a re-resolve can touch any workspace)", () => {
    // bun.lock alone, and bun.lock riding along with an otherwise-scoped change,
    // both run full — a lock re-resolve can alter any workspace's resolved tree.
    expect(classify(["bun.lock"])).toContain("full-suite");
    expect(classify(["bun.lock", "apps/platform-web/package.json"])).toContain("full-suite");
  });

  test("a single-app change is scoped to that app's suite only", () => {
    const out = classify(["apps/platform-web/src/x.tsx"]);
    expect(out).toContain("scoped");
    expect(out).toContain("ci:platform-web");
    // a platform-web-only change must NOT drag in the other apps' suites
    expect(out).not.toContain("ci:roadmap-web");
    expect(out).not.toContain("ci:meeting-web");
  });

  test("docs riding along with app code do not widen the scope", () => {
    const out = classify(["docs/a.md", "apps/roadmap-web/src/x.ts"]);
    expect(out).toContain("scoped");
    expect(out).toContain("ci:roadmap-web");
    expect(out).not.toContain("ci:platform-web");
  });

  test("a shared-package change fans out to its dependents", () => {
    const out = classify(["packages/ui/src/button.tsx"]);
    expect(out).toContain("scoped");
    expect(out).toContain("test:ui");
    // platform-web declares @product-suite/ui as a workspace dep, so it is rebuilt
    expect(out).toContain("ci:platform-web");
  });

  test("a packages/sdk change runs sdk's own suite (it is not orphaned)", () => {
    const out = classify(["packages/sdk/src/meeting.js"]);
    expect(out).toContain("scoped");
    expect(out).toContain("test:sdk");
    // sdk's only workspace dependent is meeting-web, which must also rebuild
    expect(out).toContain("ci:meeting-web");
  });

  test("scoped pushes always include the cheap cross-cutting checks", () => {
    const out = classify(["apps/platform-web/src/x.tsx"]);
    expect(out).toContain("check:source-test");
    expect(out).toContain("test:repo-tooling");
  });

  test("a per-app markdown change is scoped to that app, not full", () => {
    const out = classify(["apps/roadmap-web/CLAUDE.md"]);
    expect(out).toContain("scoped");
    expect(out).toContain("ci:roadmap-web");
  });
});
