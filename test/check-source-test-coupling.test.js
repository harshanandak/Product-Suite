import { describe, expect, test } from "bun:test";

import {
  SOURCE_EXTENSIONS,
  TEST_MARKERS,
  buildCandidateTestPaths,
  getMissingSourceTests,
  hasCorrespondingTest,
  isSourceFile,
  isTestFile,
} from "../scripts/check-source-test-coupling.mjs";

describe("check-source-test-coupling", () => {
  test("tracks the expanded source-language coverage", () => {
    expect(SOURCE_EXTENSIONS.has(".mjs")).toBe(true);
    expect(SOURCE_EXTENSIONS.has(".go")).toBe(true);
    expect(SOURCE_EXTENSIONS.has(".java")).toBe(true);
    expect(SOURCE_EXTENSIONS.has(".rb")).toBe(true);
    expect(SOURCE_EXTENSIONS.has(".cs")).toBe(true);
    expect(isSourceFile("scripts/check-source-test-coupling.mjs")).toBe(true);
  });

  test("recognizes the expanded test markers", () => {
    expect(TEST_MARKERS).toContain(".integration.");
    expect(TEST_MARKERS).toContain("_test.");
    expect(TEST_MARKERS).toContain("Test.");
    expect(isTestFile("apps/meeting-api/tests/backend/service_test.py")).toBe(true);
    expect(isTestFile("services/api/src/__tests__/handler.integration.ts")).toBe(true);
    expect(isTestFile("services/api/tests/HandlerTest.java")).toBe(true);
  });

  test("builds mirrored test candidates for scripts and src trees", () => {
    const scriptCandidates = buildCandidateTestPaths("scripts/check-source-test-coupling.mjs");
    const sourceCandidates = buildCandidateTestPaths("apps/roadmap-web/src/lib/runtimeConfig.ts");
    const configCandidates = buildCandidateTestPaths("apps/roadmap-web/vitest.config.ts");
    const declarationCandidates = buildCandidateTestPaths("packages/contracts/src/index.d.ts");

    expect(scriptCandidates.has("test/check-source-test-coupling.test.js")).toBe(true);
    expect(sourceCandidates.has("apps/roadmap-web/src/lib/__tests__/runtimeConfig.test.ts")).toBe(true);
    expect(sourceCandidates.has("apps/roadmap-web/test/lib/runtimeConfig.test.ts")).toBe(true);
    expect(configCandidates.has("test/repo-tooling.test.js")).toBe(true);
    expect(declarationCandidates.has("packages/contracts/src/index.test.ts")).toBe(true);
  });

  test("requires a corresponding test instead of accepting any staged test file", () => {
    const stagedFiles = [
      "scripts/new-feature.mjs",
      "test/unrelated.test.js",
    ];

    expect(hasCorrespondingTest("scripts/new-feature.mjs", stagedFiles)).toBe(false);
    expect(getMissingSourceTests(stagedFiles)).toEqual(["scripts/new-feature.mjs"]);
  });

  test("accepts matching tests for staged sources", () => {
    const stagedFiles = [
      "scripts/check-source-test-coupling.mjs",
      "test/check-source-test-coupling.test.js",
      "apps/roadmap-web/src/lib/runtimeConfig.ts",
      "apps/roadmap-web/src/lib/__tests__/runtimeConfig.test.ts",
      "apps/roadmap-web/vitest.config.ts",
      "test/repo-tooling.test.js",
      "packages/contracts/src/index.d.ts",
      "packages/contracts/src/index.test.ts",
    ];

    expect(hasCorrespondingTest("scripts/check-source-test-coupling.mjs", stagedFiles)).toBe(true);
    expect(hasCorrespondingTest("apps/roadmap-web/src/lib/runtimeConfig.ts", stagedFiles)).toBe(true);
    expect(hasCorrespondingTest("apps/roadmap-web/vitest.config.ts", stagedFiles)).toBe(true);
    expect(hasCorrespondingTest("packages/contracts/src/index.d.ts", stagedFiles)).toBe(true);
    expect(getMissingSourceTests(stagedFiles)).toEqual([]);
  });

  test("accepts an existing corresponding test file when it already covers the source", () => {
    const stagedFiles = ["packages/contracts/src/index.d.ts"];

    expect(hasCorrespondingTest("packages/contracts/src/index.d.ts", stagedFiles)).toBe(true);
    expect(getMissingSourceTests(stagedFiles)).toEqual([]);
  });
});
