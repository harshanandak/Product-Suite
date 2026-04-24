import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const packageJson = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8"),
);
const rootReadme = readFileSync(join(rootDir, "README.md"), "utf8");
const validationDocPath = join(rootDir, "docs", "VALIDATION.md");
const validationDoc = readFileSync(validationDocPath, "utf8");
const meetingApiWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "meeting-api-ci.yml"),
  "utf8",
);

describe("repo tooling", () => {
  test("root CI scripts validate every deployable", () => {
    expect(packageJson.scripts["ci:meeting-web"]).toContain("apps/meeting-web");
    expect(packageJson.scripts["ci:roadmap-web"]).toContain("apps/roadmap-web");
    expect(packageJson.scripts["ci:meeting-api"]).toBeDefined();
    expect(packageJson.scripts["ci:meeting-api"]).toContain("validate:meeting-api");
  });

  test("root validation scripts expose all three deployables", () => {
    expect(packageJson.scripts.validate).toContain("validate:meeting-web");
    expect(packageJson.scripts.validate).toContain("validate:roadmap-web");
    expect(packageJson.scripts.validate).toContain("validate:meeting-api");

    expect(packageJson.scripts["validate:meeting-web"]).toContain("ci:meeting-web");
    expect(packageJson.scripts["validate:roadmap-web"]).toContain("ci:roadmap-web");
    expect(packageJson.scripts["validate:meeting-api"]).toContain(
      "validate:meeting-api:lint",
    );
    expect(packageJson.scripts["validate:meeting-api"]).toContain(
      "validate:meeting-api:test",
    );
  });

  test("meeting-api validation scripts point at the Python backend", () => {
    expect(packageJson.scripts["install:meeting-api"]).toContain(
      "apps/meeting-api/backend/requirements.txt",
    );
    expect(packageJson.scripts["validate:meeting-api:lint"]).toContain(
      "apps/meeting-api/backend",
    );
    expect(packageJson.scripts["validate:meeting-api:lint"]).toContain(
      "apps/meeting-api/tests/backend",
    );
    expect(packageJson.scripts["validate:meeting-api:test"]).toContain(
      "apps/meeting-api/tests/backend",
    );
  });

  test("root docs describe the shared validation entrypoints", () => {
    expect(rootReadme).toContain("docs/VALIDATION.md");
    expect(validationDoc).toContain("bun run validate");
    expect(validationDoc).toContain("bun run validate:meeting-web");
    expect(validationDoc).toContain("bun run validate:roadmap-web");
    expect(validationDoc).toContain("bun run install:meeting-api");
    expect(validationDoc).toContain("bun run validate:meeting-api");
    expect(validationDoc).toContain("python -m alembic");
  });

  test("meeting-api CI reflects the local validation baseline", () => {
    expect(meetingApiWorkflow).toContain("Run backend lint");
    expect(meetingApiWorkflow).toContain("python -m flake8");
    expect(meetingApiWorkflow).toContain("Run backend migrations");
    expect(meetingApiWorkflow).toContain("Run backend tests");
  });
});
