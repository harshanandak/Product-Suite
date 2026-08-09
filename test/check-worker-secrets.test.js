import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { analyzeWorkerSecrets } from "../scripts/check-worker-secrets.mjs";

const SCRIPT_PATH = join(import.meta.dir, "..", "scripts", "check-worker-secrets.mjs");

const REQUIRED = ["DATABASE_URL", "CLERK_SECRET_KEY"];

/** The exact shape `wrangler secret list --format json` writes to stdout. */
function listing(names) {
  return JSON.stringify(
    names.map((name) => ({ name, type: "secret_text" })),
    null,
    2,
  );
}

/** Runs the CLI in a real `node` subprocess with the listing piped on stdin,
 * returning the exit status instead of throwing, since a non-zero exit is the
 * expected outcome for most of these cases. */
function runCli(args, input) {
  try {
    const stdout = execFileSync("node", [SCRIPT_PATH, ...args], { encoding: "utf8", input });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

describe("check-worker-secrets", () => {
  test("passes when every required secret is present", () => {
    const issues = analyzeWorkerSecrets(listing(["DATABASE_URL", "CLERK_SECRET_KEY"]), REQUIRED);

    expect(issues).toEqual([]);
  });

  test("passes when the Worker has extra secrets beyond the required ones", () => {
    const issues = analyzeWorkerSecrets(listing(["CLERK_SECRET_KEY", "DATABASE_URL", "EXTRA_KEY"]), REQUIRED);

    expect(issues).toEqual([]);
  });

  test("fails naming the missing secret", () => {
    const issues = analyzeWorkerSecrets(listing(["DATABASE_URL"]), REQUIRED);

    expect(issues).toContain("missing required secrets: CLERK_SECRET_KEY");
  });

  test("names every missing secret, not just the first", () => {
    const issues = analyzeWorkerSecrets(listing([]), REQUIRED);

    expect(issues).toContain("missing required secrets: DATABASE_URL, CLERK_SECRET_KEY");
  });

  test("fails on a null entry rather than skipping it", () => {
    const issues = analyzeWorkerSecrets('[{"name":"DATABASE_URL"},null]', REQUIRED);

    expect(issues.some((issue) => issue.includes("entry 1 is not an object"))).toBe(true);
  });

  test("fails on an entry with no name field", () => {
    const issues = analyzeWorkerSecrets('[{"name":"DATABASE_URL"},{"type":"secret_text"}]', REQUIRED);

    expect(issues.some((issue) => issue.includes('entry 1 has no usable "name"'))).toBe(true);
  });

  test("fails on an entry whose name is an empty string", () => {
    const issues = analyzeWorkerSecrets('[{"name":""}]', REQUIRED);

    expect(issues.some((issue) => issue.includes('entry 0 has no usable "name"'))).toBe(true);
  });

  test("fails on an entry whose name is not a string", () => {
    const issues = analyzeWorkerSecrets('[{"name":123}]', REQUIRED);

    expect(issues.some((issue) => issue.includes('entry 0 has no usable "name"'))).toBe(true);
  });

  test("fails on non-JSON input", () => {
    const issues = analyzeWorkerSecrets("Authentication error [code: 10000]", REQUIRED);

    expect(issues.some((issue) => issue.includes("could not parse"))).toBe(true);
  });

  test("fails on empty input", () => {
    const issues = analyzeWorkerSecrets("", REQUIRED);

    expect(issues.some((issue) => issue.includes("could not parse"))).toBe(true);
  });

  test("fails on valid JSON that is not an array", () => {
    const issues = analyzeWorkerSecrets('{"name":"DATABASE_URL"}', REQUIRED);

    expect(issues.some((issue) => issue.includes("expected a JSON array"))).toBe(true);
  });

  test("fails when direct migration credentials are exposed to the Worker", () => {
    const issues = analyzeWorkerSecrets(listing(["DATABASE_URL", "CLERK_SECRET_KEY", "MIGRATION_DATABASE_URL"]), REQUIRED);

    expect(issues).toContain("forbidden migration secrets in Worker runtime: MIGRATION_DATABASE_URL");
  });

  describe("CLI entrypoint (real `node` subprocess)", () => {
    test("exits zero and reports the verified secrets", () => {
      const { status, stdout } = runCli(REQUIRED, listing(["DATABASE_URL", "CLERK_SECRET_KEY"]));

      expect(status).toBe(0);
      expect(stdout).toContain("DATABASE_URL, CLERK_SECRET_KEY");
    });

    test("exits non-zero naming the missing secret", () => {
      const { status, stderr } = runCli(REQUIRED, listing(["DATABASE_URL"]));

      expect(status).not.toBe(0);
      expect(stderr).toContain("missing required secrets: CLERK_SECRET_KEY");
    });

    test("exits non-zero on a malformed listing", () => {
      const { status, stderr } = runCli(REQUIRED, "not json at all");

      expect(status).not.toBe(0);
      expect(stderr).toContain("could not parse");
    });

    test("exits non-zero with a usage message when no secret names are given", () => {
      const { status, stderr } = runCli([], listing(["DATABASE_URL"]));

      expect(status).not.toBe(0);
      expect(stderr).toContain("usage: check-worker-secrets.mjs");
    });
  });
});
