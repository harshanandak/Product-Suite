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

function classify(files, extraEnv = {}) {
  return execFileSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: {
      ...process.env,
      PREPUSH_GATE_TEST_FILES: files.join(","),
      PREPUSH_GATE_DRY: "1",
      ...extraEnv,
    },
  }).trim();
}

// Same dry-run classification, but with the fast-mode toggle set.
function classifyFast(files) {
  return classify(files, { PREPUSH_GATE_FAST: "1" });
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
    expect(classify(["lefthook.yml"])).toContain("full-suite");
    expect(classify(["apps/meeting-web/vercel.json"])).toContain("full-suite");
    expect(classify(["package.json"])).toContain("full-suite");
    expect(classify(["tsconfig.base.json"])).toContain("full-suite");
  });

  test("repo tooling (scripts/, test/) is scoped to repo-tooling, not full", () => {
    // scripts/ and test/ are exercised by test:repo-tooling (an always-on check);
    // a change there needs the tooling tests, not every app's suite.
    for (const f of ["scripts/prepush-gate.mjs", "test/prepush-gate.test.js"]) {
      const out = classify([f]);
      expect(out).toContain("scoped");
      expect(out).toContain("test:repo-tooling");
      expect(out).not.toContain("full-suite");
      expect(out).not.toContain("verify:platform-web");
    }
  });

  test("a platform-api change runs its own suite (no longer forces full)", () => {
    const out = classify(["apps/platform-api/src/agent/tools.ts"]);
    expect(out).toContain("scoped");
    expect(out).toContain("verify:platform-api");
    expect(out).not.toContain("full-suite");
    expect(out).not.toContain("verify:platform-web");
  });

  test("a packages/db change runs db's suite and fans out to platform-api", () => {
    const out = classify(["packages/db/src/schema.ts"]);
    expect(out).toContain("scoped");
    expect(out).toContain("verify:db");
    // platform-api declares @product-suite/db as a workspace dep
    expect(out).toContain("verify:platform-api");
  });

  test("a mixed tooling + workspace change keeps both and never broadens to full", () => {
    // scripts/ (repo tooling, skipped as an owner) riding along with a platform-api
    // file: the tooling file must NOT force FULL, and the workspace owner must still
    // be picked up. Asserts the exact expected suite set and rejects every unrelated
    // app suite, so a routing regression cannot silently widen the run.
    const out = classify(["scripts/prepush-gate.mjs", "apps/platform-api/src/agent/tools.ts"]);
    expect(out).toContain("scoped");
    expect(out).not.toContain("full-suite");
    // present: the always-on tooling check + the platform-api owner
    expect(out).toContain("test:repo-tooling");
    expect(out).toContain("verify:platform-api");
    // absent: every unrelated app/package suite
    expect(out).not.toContain("verify:platform-web");
    expect(out).not.toContain("verify:meeting-web");
    expect(out).not.toContain("verify:roadmap-web");
    expect(out).not.toContain("verify:db");
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
    expect(out).toContain("verify:platform-web");
    // a platform-web-only change must NOT drag in the other apps' suites
    expect(out).not.toContain("verify:roadmap-web");
    expect(out).not.toContain("verify:meeting-web");
  });

  test("docs riding along with app code do not widen the scope", () => {
    const out = classify(["docs/a.md", "apps/roadmap-web/src/x.ts"]);
    expect(out).toContain("scoped");
    expect(out).toContain("verify:roadmap-web");
    expect(out).not.toContain("verify:platform-web");
  });

  test("a shared-package change fans out to its dependents", () => {
    const out = classify(["packages/ui/src/button.tsx"]);
    expect(out).toContain("scoped");
    expect(out).toContain("test:ui");
    // platform-web declares @product-suite/ui as a workspace dep, so it is verified
    expect(out).toContain("verify:platform-web");
  });

  test("a packages/sdk change runs sdk's own suite (it is not orphaned)", () => {
    const out = classify(["packages/sdk/src/meeting.js"]);
    expect(out).toContain("scoped");
    expect(out).toContain("test:sdk");
    // sdk's only workspace dependent is meeting-web, which must also be verified
    expect(out).toContain("verify:meeting-web");
  });

  test("scoped pushes always include the cheap cross-cutting checks", () => {
    const out = classify(["apps/platform-web/src/x.tsx"]);
    expect(out).toContain("check:source-test");
    expect(out).toContain("test:repo-tooling");
  });

  test("a per-app markdown change is scoped to that app, not full", () => {
    const out = classify(["apps/roadmap-web/CLAUDE.md"]);
    expect(out).toContain("scoped");
    expect(out).toContain("verify:roadmap-web");
  });

  test("the gate never runs an app BUILD — those belong to CI", () => {
    // platform-web change runs verify (lint+typecheck+test), never the build step.
    const out = classify(["apps/platform-web/src/x.tsx"]);
    expect(out).not.toContain("ci:platform-web");
    expect(out).toContain("verify:platform-web");
  });
});

describe("prepush-gate PREPUSH_GATE_FAST (lint+typecheck-only) mode", () => {
  test("fast mode runs a workspace's lint + typecheck but NOT its test/verify", () => {
    const out = classifyFast(["apps/platform-web/src/x.tsx"]);
    expect(out).toContain("mode: fast");
    // per-workspace lint + typecheck, resolved from the workspace package.json
    expect(out).toContain("apps/platform-web:lint");
    expect(out).toContain("apps/platform-web:typecheck");
    // the test step is deferred to CI — no test/verify invocation for the workspace
    expect(out).not.toContain("apps/platform-web:test");
    expect(out).not.toContain("verify:platform-web");
  });

  test("fast mode still runs the always-on cheap checks", () => {
    const out = classifyFast(["apps/platform-web/src/x.tsx"]);
    expect(out).toContain("check:source-test");
    expect(out).toContain("test:repo-tooling");
  });

  test("default (non-fast) mode is unchanged: still runs the full verify incl. test", () => {
    const out = classify(["apps/platform-web/src/x.tsx"]);
    expect(out).not.toContain("mode: fast");
    expect(out).toContain("verify:platform-web");
  });

  test("fast mode skips a step the workspace's gate does not include (meeting-web has no typecheck)", () => {
    const out = classifyFast(["apps/meeting-web/src/x.ts"]);
    expect(out).toContain("mode: fast");
    // meeting-web's verify is lint+test (lint-gated) → run lint, defer test
    expect(out).toContain("apps/meeting-web:lint");
    // verify:meeting-web includes no typecheck step → nothing to run
    expect(out).not.toContain("apps/meeting-web:typecheck");
    expect(out).not.toContain("verify:meeting-web");
  });

  test("fast mode KEEPS test for a no-lint workspace whose tests are its only safety net (platform-api)", () => {
    // verify:platform-api is typecheck+test (no lint step) → fast mode must NOT reduce
    // it to a bare typecheck; the full suite (incl. test) still runs.
    const out = classifyFast(["apps/platform-api/src/agent/tools.ts"]);
    expect(out).toContain("mode: fast");
    expect(out).toContain("verify:platform-api"); // = typecheck && test
    expect(out).not.toContain("apps/platform-api:lint"); // its gate has no lint step
  });

  test("fast mode KEEPS test for packages/db (no lint step → tests are the safety net)", () => {
    const out = classifyFast(["packages/db/src/schema.ts"]);
    expect(out).toContain("mode: fast");
    expect(out).toContain("verify:db"); // = typecheck && test
    // db fans out to platform-api (also no-lint) → it too keeps its test suite
    expect(out).toContain("verify:platform-api");
  });

  test("fast mode keeps a test-only package's suite (packages/ui has no lint → keep test)", () => {
    // packages/ui's only gate is its test suite → fast mode must still run it.
    const out = classifyFast(["packages/ui/src/button.tsx"]);
    expect(out).toContain("mode: fast");
    expect(out).toContain("check:source-test");
    expect(out).toContain("test:ui"); // kept — it is the only local safety net
    expect(out).not.toContain("packages/ui:lint");
    // packages/ui fans out to platform-web (lint-gated) → that one defers test
    expect(out).not.toContain("verify:platform-web");
    expect(out).toContain("apps/platform-web:lint");
  });

  test("fast mode narrows a lint-gated workspace but keeps no-lint workspaces' tests (full push)", () => {
    const out = classifyFast(["package.json"]);
    expect(out).toContain("full-suite");
    expect(out).toContain("mode: fast");
    // lint-gated platform-web: lint+typecheck, test deferred
    expect(out).toContain("apps/platform-web:lint");
    expect(out).toContain("apps/platform-web:typecheck");
    expect(out).not.toContain("verify:platform-web");
    // no-lint workspaces still run their full test-bearing suites
    expect(out).toContain("verify:platform-api");
    expect(out).toContain("verify:db");
    expect(out).toContain("test:ui");
  });

  test("fast mode keeps the docs-only fast path (docs push runs only source-test)", () => {
    const out = classifyFast(["docs/plans/some-plan.md", "README.md"]);
    expect(out).toContain("docs-only");
  });
});
