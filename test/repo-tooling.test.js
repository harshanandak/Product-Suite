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
const servicesReadme = readFileSync(join(rootDir, "services", "README.md"), "utf8");
const buildingBlocksPlan = readFileSync(
  join(rootDir, "docs", "plans", "building-blocks-transformation-pr-plan.md"),
  "utf8",
);
const pr6ResearchDoc = readFileSync(
  join(rootDir, "docs", "research", "pr6-auth-provider-rollout.md"),
  "utf8",
);
const meetingWebEnvExample = readFileSync(
  join(rootDir, "apps", "meeting-web", ".env.example"),
  "utf8",
);
const meetingApiEnvExample = readFileSync(
  join(rootDir, "apps", "meeting-api", "backend", ".env.example"),
  "utf8",
);
const roadmapWebEnvExample = readFileSync(
  join(rootDir, "apps", "roadmap-web", ".env.example"),
  "utf8",
);
const roadmapNextConfig = readFileSync(
  join(rootDir, "apps", "roadmap-web", "next.config.ts"),
  "utf8",
);
const meetingApiWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "meeting-api-ci.yml"),
  "utf8",
);
const meetingWebWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "meeting-web-ci.yml"),
  "utf8",
);
const roadmapWebWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "roadmap-web-ci.yml"),
  "utf8",
);
const meetingApiRailwayPreviewWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "meeting-api-railway-preview.yml"),
  "utf8",
);
const roadmapWebPlaywrightWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "roadmap-web-playwright.yml"),
  "utf8",
);
const repoToolingWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "repo-tooling-ci.yml"),
  "utf8",
);
const lefthookConfig = readFileSync(join(rootDir, "lefthook.yml"), "utf8");

describe("repo tooling", () => {
  test("root workspace and scripts acknowledge shared packages", () => {
    expect(packageJson.workspaces).toContain("packages/contracts");
    expect(packageJson.workspaces).toContain("packages/sdk");
    expect(packageJson.workspaces).toContain("packages/ui-meeting");
    expect(packageJson.workspaces).toContain("packages/ui-chat");
    expect(packageJson.workspaces).toContain("packages/ui-canvas");
    expect(packageJson.workspaces).toContain("packages/ui-planning");
    expect(packageJson.workspaces).toContain("packages/ui-charting");
    expect(packageJson.workspaces).toContain("services/agent-core");
    expect(packageJson.workspaces).toContain("services/hocuspocus");
    expect(packageJson.scripts["test:contracts"]).toBeDefined();
    expect(packageJson.scripts["test:contracts"]).toContain("packages/contracts");
    expect(packageJson.scripts["test:ui-meeting"]).toBeDefined();
    expect(packageJson.scripts["test:ui-meeting"]).toContain("packages/ui-meeting");
    expect(packageJson.scripts["test:ui-chat"]).toBeDefined();
    expect(packageJson.scripts["test:ui-chat"]).toContain("packages/ui-chat");
    expect(packageJson.scripts["test:ui-canvas"]).toBeDefined();
    expect(packageJson.scripts["test:ui-canvas"]).toContain("packages/ui-canvas");
    expect(packageJson.scripts["test:ui-planning"]).toBeDefined();
    expect(packageJson.scripts["test:ui-planning"]).toContain("packages/ui-planning");
    expect(packageJson.scripts["test:ui-charting"]).toBeDefined();
    expect(packageJson.scripts["test:ui-charting"]).toContain("packages/ui-charting");
    expect(packageJson.scripts["test:agent-core"]).toBeDefined();
    expect(packageJson.scripts["test:agent-core"]).toContain("services/agent-core");
    expect(packageJson.scripts["test:hocuspocus"]).toBeDefined();
    expect(packageJson.scripts["test:hocuspocus"]).toContain("services/hocuspocus");
    expect(packageJson.scripts["start:hocuspocus"]).toBeDefined();
    expect(packageJson.scripts["start:hocuspocus"]).toContain("services/hocuspocus start");
    expect(packageJson.scripts["test:roadmap-canvas-boundary"]).toBeDefined();
    expect(packageJson.scripts["test:roadmap-canvas-boundary"]).toContain(
      "src/components/blocksuite/__tests__/canvas-boundary.test.ts",
    );
    expect(packageJson.scripts["check:source-test"]).toBeDefined();
    expect(packageJson.scripts["check:source-test"]).toContain("check-source-test-coupling");
    expect(packageJson.scripts["test:repo-tooling"]).toContain("check-source-test-coupling.test.js");
    expect(packageJson.scripts["test:prepush"]).toContain("check:source-test");
    expect(packageJson.scripts["test:prepush"]).toContain("test:agent-core");
    expect(packageJson.scripts["test:prepush"]).toContain("test:hocuspocus");
    expect(packageJson.scripts["test:prepush"]).toContain("test:roadmap-canvas-boundary");
    expect(lefthookConfig).toContain("pre-commit:");
    expect(lefthookConfig).toContain("bun run check:source-test");
  });

  test("root CI scripts validate every deployable", () => {
    expect(packageJson.scripts["ci:meeting-web"]).toContain("apps/meeting-web");
    expect(packageJson.scripts["ci:meeting-web"]).toContain("apps/meeting-web test");
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
    expect(packageJson.scripts["ci:roadmap-web"]).toContain("apps/roadmap-web test");
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
    expect(validationDoc).toContain("bun run test:contracts");
    expect(validationDoc).toContain("bun run test:ui-chat");
    expect(validationDoc).toContain("bun run test:ui-canvas");
    expect(validationDoc).toContain("bun run test:ui-planning");
    expect(validationDoc).toContain("bun run test:ui-charting");
    expect(validationDoc).toContain("bun run test:agent-core");
    expect(validationDoc).toContain("bun run test:hocuspocus");
    expect(validationDoc).toContain("bun run start:hocuspocus");
    expect(validationDoc).toContain("bun run test:roadmap-canvas-boundary");
    expect(validationDoc).toContain("packages/contracts");
    expect(validationDoc).toContain("services/agent-core");
    expect(validationDoc).toContain("services/hocuspocus");
    expect(validationDoc).toContain("bun run validate:meeting-web");
    expect(validationDoc).toContain("bun run validate:roadmap-web");
    expect(validationDoc).toContain("unit tests");
    expect(validationDoc).toContain("bun run install:meeting-api");
    expect(validationDoc).toContain("bun run validate:meeting-api");
    expect(validationDoc).toContain("python -m alembic");
  });

  test("building blocks plan points to the active PR5 artifacts", () => {
    expect(buildingBlocksPlan).toContain("PR5 Auth Contracts And Adapters");
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-16-pr5-auth-contracts-and-adapters-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-16-pr5-auth-contracts-and-adapters-tasks.md",
    );
    expect(buildingBlocksPlan).toContain("docs/research/pr5-auth-contracts-and-adapters.md");
  });

  test("building blocks plan marks PR15 verified and PR16 active", () => {
    expect(buildingBlocksPlan).toContain("PR5 Auth Contracts And Adapters`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR6 Auth Provider Rollout`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR7 SDK / Typed Client Layer`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR8 Meeting Block Extraction`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR9 Chat Block Extraction`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR10 Canvas Boundary Extraction`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR11 Planning And Charting Blocks`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR12 Agent-Core Service`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR13 Realtime Transport Split`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR14 Realtime Service Runtime Wiring`: merged and verified");
    expect(buildingBlocksPlan).toContain("PR15 Hocuspocus Provider Cutover Readiness`: merged and verified");
    expect(buildingBlocksPlan).toContain(
      "PR16 Hocuspocus Provider Controlled Rollout`: active on `feat/pr16-hocuspocus-provider-controlled-rollout`",
    );
    expect(buildingBlocksPlan).toContain("docs/research/pr11-planning-and-charting-blocks.md");
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-18-pr11-planning-and-charting-blocks-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-18-pr11-planning-and-charting-blocks-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-18-pr11-planning-and-charting-blocks-decisions.md",
    );
    expect(buildingBlocksPlan).toContain("docs/research/pr12-agent-core-service.md");
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-19-pr12-agent-core-service-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-19-pr12-agent-core-service-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-19-pr12-agent-core-service-decisions.md",
    );
    expect(buildingBlocksPlan).toContain("docs/research/pr13-realtime-transport-split.md");
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-19-pr13-realtime-transport-split-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-19-pr13-realtime-transport-split-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/research/pr14-realtime-service-runtime-wiring.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr14-realtime-service-runtime-wiring-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/research/pr15-hocuspocus-provider-cutover-readiness.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr15-hocuspocus-provider-cutover-readiness-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr15-hocuspocus-provider-cutover-readiness-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr15-hocuspocus-provider-cutover-readiness-decisions.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/research/pr16-hocuspocus-provider-controlled-rollout.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr16-hocuspocus-provider-controlled-rollout-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr16-hocuspocus-provider-controlled-rollout-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-20-pr16-hocuspocus-provider-controlled-rollout-decisions.md",
    );
    expect(buildingBlocksPlan).not.toContain("PR4 is in progress");
    expect(buildingBlocksPlan).not.toContain("PR5+ need planning");
    expect(buildingBlocksPlan).not.toContain("PR6 Auth Provider Rollout`: active");
    expect(buildingBlocksPlan).not.toContain("PR7 SDK / Typed Client Layer`: active");
    expect(buildingBlocksPlan).not.toContain("PR10 Canvas Boundary Extraction`: active");
    expect(buildingBlocksPlan).not.toContain("PR11 Planning And Charting Blocks`: active");
    expect(buildingBlocksPlan).not.toContain("PR12 Agent-Core Service`: active");
    expect(buildingBlocksPlan).not.toContain("PR13 Realtime Transport Split`: active");
    expect(buildingBlocksPlan).not.toContain("PR14 Realtime Service Runtime Wiring`: active");
    expect(buildingBlocksPlan).not.toContain("PR15 Hocuspocus Provider Cutover Readiness`: active");
  });

  test("meeting-api CI reflects the local validation baseline", () => {
    expect(meetingApiWorkflow).toContain("Run backend lint");
    expect(meetingApiWorkflow).toContain("python -m flake8");
    expect(meetingApiWorkflow).toContain("Run backend migrations");
    expect(meetingApiWorkflow).toContain("Run backend tests");
    expect(meetingApiWorkflow).toContain("python -m pytest apps/meeting-api/tests/backend -q");
  });

  test("roadmap CI reflects the local validation baseline", () => {
    expect(roadmapWebWorkflow).toContain("Roadmap unit tests");
    expect(roadmapWebWorkflow).toContain("bun run test");
  });

  test("roadmap Playwright CI reflects the full e2e environment contract", () => {
    expect(roadmapWebPlaywrightWorkflow).toContain("name: Roadmap Web Playwright");
    expect(roadmapWebPlaywrightWorkflow).toContain("Run Playwright tests");
    expect(roadmapWebPlaywrightWorkflow).toContain("bun run test:e2e");
    expect(roadmapWebPlaywrightWorkflow).toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(roadmapWebPlaywrightWorkflow).toContain("TEST_USER_A_EMAIL");
    expect(roadmapWebPlaywrightWorkflow).toContain("TEST_USER_A_PASSWORD");
    expect(roadmapWebPlaywrightWorkflow).toContain("TEST_USER_B_EMAIL");
    expect(roadmapWebPlaywrightWorkflow).toContain("TEST_USER_B_PASSWORD");
  });

  test("meeting web CI reflects the local validation baseline", () => {
    expect(meetingWebWorkflow).toContain("name: Meeting Web CI");
    expect(meetingWebWorkflow).toContain("name: Test");
    expect(meetingWebWorkflow).toContain("run: bun run test");
  });

  test("root tooling changes trigger a dedicated GitHub Actions workflow", () => {
    expect(repoToolingWorkflow).toContain("name: Repo Tooling CI");
    expect(repoToolingWorkflow).toContain('"test/**"');
    expect(repoToolingWorkflow).toContain('"docs/**"');
    expect(repoToolingWorkflow).toContain('"packages/contracts/**"');
    expect(repoToolingWorkflow).toContain('"packages/sdk/**"');
    expect(repoToolingWorkflow).toContain('"packages/ui-meeting/**"');
    expect(repoToolingWorkflow).toContain('"packages/ui-chat/**"');
    expect(repoToolingWorkflow).toContain('"packages/ui-canvas/**"');
    expect(repoToolingWorkflow).toContain('"packages/ui-planning/**"');
    expect(repoToolingWorkflow).toContain('"packages/ui-charting/**"');
    expect(repoToolingWorkflow).toContain('"services/agent-core/**"');
    expect(repoToolingWorkflow).toContain('"services/hocuspocus/**"');
    expect(repoToolingWorkflow).toContain('"README.md"');
    expect(repoToolingWorkflow).toContain('".github/workflows/meeting-api-ci.yml"');
    expect(repoToolingWorkflow).toContain(
      '".github/workflows/meeting-api-railway-preview.yml"',
    );
    expect(repoToolingWorkflow).toContain('".github/workflows/meeting-web-ci.yml"');
    expect(repoToolingWorkflow).toContain('".github/workflows/roadmap-web-ci.yml"');
    expect(repoToolingWorkflow).toContain(
      '".github/workflows/roadmap-web-playwright.yml"',
    );
    expect(repoToolingWorkflow).toContain("bun run test:agent-core");
    expect(repoToolingWorkflow).toContain("bun run test:hocuspocus");
    expect(repoToolingWorkflow).toContain("bun run test:roadmap-canvas-boundary");
    expect(repoToolingWorkflow).toContain("bun run test:repo-tooling");
  });

  test("shared root dependency changes trigger the web and backend CI workflows", () => {
    expect(meetingWebWorkflow).toContain('"packages/contracts/**"');
    expect(meetingWebWorkflow).toContain('"packages/sdk/**"');
    expect(meetingWebWorkflow).toContain('"packages/ui-meeting/**"');
    expect(meetingWebWorkflow).toContain('"packages/ui-chat/**"');
    expect(meetingWebWorkflow).toContain('"packages/ui-canvas/**"');
    expect(meetingWebWorkflow).toContain('"packages/ui-planning/**"');
    expect(meetingWebWorkflow).toContain('"packages/ui-charting/**"');
    expect(meetingWebWorkflow).not.toContain('"docs/**"');
    expect(meetingWebWorkflow).not.toContain('"test/**"');
    expect(meetingWebWorkflow).toContain("Detect app-impacting changes");
    expect(meetingWebWorkflow).toContain("steps.changes.outputs.run == 'true'");
    expect(meetingWebWorkflow).toContain(
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
    );
    expect(meetingWebWorkflow).toContain(
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
    );
    expect(meetingWebWorkflow).toContain("persist-credentials: false");
    expect(meetingWebWorkflow).toContain('"package.json"');
    expect(meetingWebWorkflow).toContain('"bun.lock"');
    expect(roadmapWebWorkflow).toContain('"packages/contracts/**"');
    expect(roadmapWebWorkflow).toContain('"packages/sdk/**"');
    expect(roadmapWebWorkflow).toContain('"packages/ui-meeting/**"');
    expect(roadmapWebWorkflow).toContain('"packages/ui-chat/**"');
    expect(roadmapWebWorkflow).toContain('"packages/ui-canvas/**"');
    expect(roadmapWebWorkflow).toContain('"packages/ui-planning/**"');
    expect(roadmapWebWorkflow).toContain('"packages/ui-charting/**"');
    expect(roadmapWebWorkflow).toContain('"services/agent-core/**"');
    expect(roadmapWebWorkflow).toContain('"services/hocuspocus/**"');
    expect(roadmapWebWorkflow).not.toContain('"docs/**"');
    expect(roadmapWebWorkflow).not.toContain('"test/**"');
    expect(roadmapWebWorkflow).toContain("Detect app-impacting changes");
    expect(roadmapWebWorkflow).toContain("steps.changes.outputs.run == 'true'");
    expect(roadmapWebWorkflow).toContain(
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    );
    expect(roadmapWebWorkflow).toContain("persist-credentials: false");
    expect(roadmapWebWorkflow).toContain('"package.json"');
    expect(roadmapWebWorkflow).toContain('"bun.lock"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"packages/contracts/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"packages/sdk/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"packages/ui-meeting/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"packages/ui-chat/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"packages/ui-canvas/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"packages/ui-planning/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"packages/ui-charting/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"services/agent-core/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"services/hocuspocus/**"');
    expect(roadmapWebPlaywrightWorkflow).not.toContain('"docs/**"');
    expect(roadmapWebPlaywrightWorkflow).not.toContain('"test/**"');
    expect(roadmapWebPlaywrightWorkflow).toContain(
      "Detect app-impacting changes",
    );
    expect(roadmapWebPlaywrightWorkflow).toContain(
      "steps.changes.outputs.run == 'true'",
    );
    expect(roadmapWebPlaywrightWorkflow).toContain(
      "actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd",
    );
    expect(roadmapWebPlaywrightWorkflow).toContain(
      "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
    );
    expect(roadmapWebPlaywrightWorkflow).toContain(
      "persist-credentials: false",
    );
    expect(roadmapWebPlaywrightWorkflow).toContain('"package.json"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"bun.lock"');
    expect(roadmapWebPlaywrightWorkflow).toContain('"infra/supabase/**"');
    expect(roadmapNextConfig).toContain('"@product-suite/ui-planning"');
    expect(roadmapNextConfig).toContain('"@product-suite/ui-charting"');
    expect(meetingApiWorkflow).toContain('"packages/contracts/**"');
    expect(meetingApiWorkflow).toContain('"packages/sdk/**"');
    expect(meetingApiWorkflow).toContain('"test/**"');
    expect(meetingApiWorkflow).toContain('"scripts/meeting-api-validation.mjs"');
    expect(meetingApiRailwayPreviewWorkflow).toContain('"packages/contracts/**"');
    expect(meetingApiRailwayPreviewWorkflow).toContain('"packages/sdk/**"');
    expect(meetingApiRailwayPreviewWorkflow).toContain('"test/**"');
    expect(meetingApiRailwayPreviewWorkflow).toContain(
      '"scripts/meeting-api-validation.mjs"',
    );
    expect(meetingApiRailwayPreviewWorkflow).toContain('"package.json"');
    expect(meetingApiRailwayPreviewWorkflow).toContain('"bun.lock"');
  });

  test("PR6 auth rollout docs and env examples describe canonical provider configuration", () => {
    for (const doc of [buildingBlocksPlan, pr6ResearchDoc]) {
      expect(doc).toContain("canonical");
      expect(doc).toContain("JWKS");
      expect(doc).toContain("issuer");
      expect(doc).toContain("audience");
      expect(doc).toContain("trusted origins");
      expect(doc).toContain("rollback");
    }

    expect(meetingWebEnvExample).toContain("VITE_CANONICAL_AUTH_PROVIDER");
    expect(meetingWebEnvExample).toContain("VITE_BETTER_AUTH_URL");
    expect(meetingWebEnvExample).toContain("VITE_BETTER_AUTH_TRUSTED_ORIGINS");
    expect(meetingApiEnvExample).toContain("CANONICAL_AUTH_PROVIDER");
    expect(meetingApiEnvExample).toContain("CANONICAL_AUTH_ISSUER");
    expect(meetingApiEnvExample).toContain("CANONICAL_AUTH_AUDIENCE");
    expect(meetingApiEnvExample).toContain("CANONICAL_AUTH_JWKS_URL");
    expect(roadmapWebEnvExample).toContain("ROADMAP_CANONICAL_AUTH_PROVIDER");
    expect(roadmapWebEnvExample).toContain("ROADMAP_CANONICAL_AUTH_SECRET");
    expect(roadmapWebEnvExample).toContain("ROADMAP_CANONICAL_AUTH_TRUSTED_ORIGINS");
  });

  test("services docs describe the agent-core service boundary", () => {
    expect(servicesReadme).toContain("agent-core");
    expect(servicesReadme).toContain("task-plan execution");
    expect(servicesReadme).toContain("Roadmap");
    expect(servicesReadme).toContain("hocuspocus");
    expect(servicesReadme).toContain("canonical canvas collaboration transport");
  });
});
