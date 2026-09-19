import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const packageJson = JSON.parse(
  readFileSync(join(rootDir, "package.json"), "utf8"),
);
const platformApiPackageJson = JSON.parse(
  readFileSync(join(rootDir, "apps", "platform-api", "package.json"), "utf8"),
);
const platformWebPackageJson = JSON.parse(
  readFileSync(join(rootDir, "apps", "platform-web", "package.json"), "utf8"),
);
const roadmapWebPackageJson = JSON.parse(
  readFileSync(join(rootDir, "apps", "roadmap-web", "package.json"), "utf8"),
);
const dbPackageJson = JSON.parse(
  readFileSync(join(rootDir, "packages", "db", "package.json"), "utf8"),
);
const dependencyLockPaths = [
  join(rootDir, "bun.lock"),
  join(rootDir, "apps", "roadmap-web", "bun.lock"),
];
const isPatchedSerovalVersion = (version) => {
  const minimumVersion = [1, 5, 3];

  for (let index = 0; index < minimumVersion.length; index++) {
    const difference = Number(version[index]) - minimumVersion[index];
    if (difference !== 0) return difference > 0;
  }

  return true;
};
const rootReadme = readFileSync(join(rootDir, "README.md"), "utf8");
const validationDocPath = join(rootDir, "docs", "VALIDATION.md");
const validationDoc = readFileSync(validationDocPath, "utf8");
const p2bMemoryImpactDesign = readFileSync(
  join(rootDir, "docs", "design", "2026-07-16-memory-brain-p2b.md"),
  "utf8",
);
const servicesReadme = readFileSync(join(rootDir, "services", "README.md"), "utf8");
const buildingBlocksPlan = readFileSync(
  join(rootDir, "docs", "plans", "building-blocks-transformation-pr-plan.md"),
  "utf8",
);
const pr6ResearchDoc = readFileSync(
  join(rootDir, "docs", "research", "pr6-auth-provider-rollout.md"),
  "utf8",
);
const pr19ArtifactPaths = [
  join(rootDir, "docs", "research", "pr19-unified-supabase-platform-schema.md"),
  join(rootDir, "docs", "plans", "2026-06-02-pr19-unified-supabase-platform-schema-design.md"),
  join(rootDir, "docs", "plans", "2026-06-02-pr19-unified-supabase-platform-schema-decisions.md"),
  join(rootDir, "docs", "plans", "2026-06-02-pr19-unified-supabase-platform-schema-tasks.md"),
];
const pr20ArtifactPaths = [
  join(rootDir, "docs", "research", "pr20-meeting-database-cutover-from-neon-to-supabase.md"),
  join(rootDir, "docs", "plans", "2026-06-03-pr20-meeting-database-cutover-from-neon-to-supabase-design.md"),
  join(rootDir, "docs", "plans", "2026-06-03-pr20-meeting-database-cutover-from-neon-to-supabase-decisions.md"),
  join(rootDir, "docs", "plans", "2026-06-03-pr20-meeting-database-cutover-from-neon-to-supabase-tasks.md"),
];
const pr21ArtifactPaths = [
  join(rootDir, "docs", "research", "pr21-single-domain-platform-shell.md"),
  join(rootDir, "docs", "plans", "2026-06-08-pr21-single-domain-platform-shell-design.md"),
  join(rootDir, "docs", "plans", "2026-06-08-pr21-single-domain-platform-shell-decisions.md"),
  join(rootDir, "docs", "plans", "2026-06-08-pr21-single-domain-platform-shell-tasks.md"),
];
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
const repoToolingWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "repo-tooling-ci.yml"),
  "utf8",
);
const platformApiDeployWorkflow = readFileSync(
  join(rootDir, ".github", "workflows", "platform-api-deploy.yml"),
  "utf8",
);
const dbContractWorkflowPath = join(
  rootDir,
  ".github",
  "workflows",
  "db-contract.yml",
);
const dbContractWorkflow = readFileSync(dbContractWorkflowPath, "utf8");
const lifecycleScriptHardenedWorkflowPaths = [
  dbContractWorkflowPath,
  join(rootDir, ".github", "workflows", "platform-web-ci.yml"),
  join(rootDir, ".github", "workflows", "platform-web-deploy.yml"),
];
const dbContractTelemetry = readFileSync(
  join(rootDir, "apps", "platform-api", "test", "db-contract", "telemetry.ts"),
  "utf8",
);
const lefthookConfig = readFileSync(join(rootDir, "lefthook.yml"), "utf8");

describe("repo tooling", () => {
  test("root dependency bootstrap exposes ESLint's AJV 6 draft-04 reference", () => {
    expect(packageJson.devDependencies.ajv).toBe("6.14.0");
    expect(() =>
      execFileSync(
        process.execPath,
        ["-e", "require.resolve('ajv/lib/refs/json-schema-draft-04.json')"],
        { cwd: rootDir, stdio: "pipe" },
      ),
    ).not.toThrow();
  });

  test("memory-value analysis unions attribution rails at the run-memory unit", () => {
    const attributionSection = p2bMemoryImpactDesign.match(
      /#### Attribution basis for memory-value \/ holdout analysis[\s\S]*?(?=\n### |\n## |\s*$)/i,
    );
    expect(attributionSection).not.toBeNull();
    const section = attributionSection[0].toLowerCase();
    const sqlMatch = section.match(/```sql\s+([\s\S]*?)```/i);
    expect(sqlMatch).not.toBeNull();
    const contract = sqlMatch[1];

    expect(contract).toContain("with memory_exposure as");
    expect(contract).toMatch(
      /select a\.run_id,\s*a\.memory_id,\s*a\.suppressed\s+from "run_memory_attributions" a\s+where a\.memory_id\s+is\s+not\s+null/,
    );
    expect(contract).toMatch(
      /select a\.run_id,\s*a\.memory_id,\s*a\.suppressed\s+from "run_knowledge_attributions" a\s+where a\.kind\s*=\s*'memory'\s+and a\.memory_id\s+is\s+not\s+null/,
    );
    expect(contract).toMatch(
      /run_memory_attributions[\s\S]*union all[\s\S]*run_knowledge_attributions/,
    );
    expect(contract).toMatch(
      /select e\.run_id,\s*e\.memory_id,\s*bool_or\(suppressed\)\s+as\s+suppressed[\s\S]*group by run_id,\s*memory_id/,
    );
    expect(contract).toMatch(
      /select e\.run_id,\s*e\.memory_id,\s*e\.suppressed,\s*r\.memory_holdout[\s\S]*join "agent_runs" r\s+on r\.id\s*=\s*e\.run_id[\s\S]*where r\.kind\s*=\s*'chat'/,
    );
    expect(section).toContain("suppressed rows are retained");
    expect(section).toContain("repeated runs remain separate");
  });

  test("all locked seroval versions include the security patch", () => {
    expect(isPatchedSerovalVersion(["1", "4", "1003"])).toBe(false);

    for (const lockPath of dependencyLockPaths) {
      const versions = [...readFileSync(lockPath, "utf8").matchAll(
        /"[^"\n]*seroval": \["seroval@(\d+)\.(\d+)\.(\d+)"/g,
      )];
      expect(versions.length).toBeGreaterThan(0);
      expect(versions.every(([, ...version]) => isPatchedSerovalVersion(version))).toBe(true);
    }
  });

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
    expect(packageJson.scripts["worktree:create"]).toContain("worktree-bootstrap.mjs create");
    expect(packageJson.scripts["worktree:bootstrap"]).toContain("worktree-bootstrap.mjs bootstrap");
    expect(packageJson.scripts["check:supabase-exposure"]).toBeUndefined();
    expect(packageJson.scripts["preflight:meeting-cutover"]).toBeUndefined();
    expect(packageJson.scripts["test:repo-tooling"]).toContain("check-source-test-coupling.test.js");
    for (const retiredTest of [
      "check-supabase-exposure.test.js",
      "supabase-platform-schema.test.js",
      "meeting-cutover-preflight.test.js",
      "meeting-supabase-cutover-docs.test.js",
    ]) {
      expect(packageJson.scripts["test:repo-tooling"]).not.toContain(retiredTest);
    }
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

  test("server workspace lint gates keep their shared config", () => {
    expect(existsSync(join(rootDir, "eslint.config.mjs"))).toBe(true);
    expect(platformApiPackageJson.scripts.lint).toContain("--max-warnings 0");
    expect(dbPackageJson.scripts.lint).toContain("--max-warnings 0");
    expect(packageJson.scripts["verify:platform-api"]).toContain(
      "--cwd apps/platform-api lint",
    );
    expect(packageJson.scripts["verify:db"]).toContain("--cwd packages/db lint");
  });

  test("root aggregate lint forwards the zero-warning threshold", () => {
    expect(packageJson.scripts.lint).toMatch(/lint -- --max-warnings 0/);
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

  test("building blocks plan marks PR20 verified and PR21+ superseded", () => {
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
    expect(buildingBlocksPlan).toContain("PR16 Hocuspocus Provider Controlled Rollout`: merged and verified");
    expect(buildingBlocksPlan).toContain(
      "PR17 Platform Auth And Data Consolidation Plan`: merged via GitHub PR #18 and verified on `origin/main`",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-decisions.md",
    );
    expect(buildingBlocksPlan).toContain(
      "PR18 Clerk Auth Foundation`: merged via GitHub PR #19 and verified on `origin/main`",
    );
    expect(buildingBlocksPlan).toContain(
      "PR19 Unified Supabase Platform Schema`: merged via GitHub PR #21 and verified on `origin/main`",
    );
    expect(buildingBlocksPlan).toContain(
      "PR20 Meeting Database Cutover From Neon To Supabase`: merged via GitHub PR #24 and verified on `origin/main`",
    );
    expect(buildingBlocksPlan).toContain("PR21+`: **superseded 2026-06-12**");
    expect(buildingBlocksPlan).toContain("DESIGN.md");
    expect(buildingBlocksPlan).toContain("docs/plans/implementation-plan-2026-06-12.md");
    expect(buildingBlocksPlan).not.toContain(
      "PR21 Single Domain Platform Shell`: active on `feat/pr21-single-domain-platform-shell`",
    );
    expect(buildingBlocksPlan).toContain("docs/research/pr18-clerk-auth-foundation.md");
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-31-pr18-clerk-auth-foundation-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-31-pr18-clerk-auth-foundation-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-05-31-pr18-clerk-auth-foundation-decisions.md",
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
    expect(buildingBlocksPlan).not.toContain("PR20 Meeting Database Cutover From Neon To Supabase`: active");
  });

  test("PR21 single domain platform shell plan artifacts are durable", () => {
    for (const artifactPath of pr21ArtifactPaths) {
      expect(existsSync(artifactPath)).toBe(true);
    }

    const pr21ResearchDoc = readFileSync(pr21ArtifactPaths[0], "utf8");
    const pr21DesignDoc = readFileSync(pr21ArtifactPaths[1], "utf8");
    const pr21TasksDoc = readFileSync(pr21ArtifactPaths[3], "utf8");

    expect(pr21ResearchDoc).toContain(
      "docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md",
    );
    expect(pr21ResearchDoc).toContain("Route ownership matrix");
    expect(pr21DesignDoc).toContain("Module registry records must stay metadata-only");
    expect(pr21DesignDoc).toContain("OWASP Notes");
    expect(pr21TasksDoc).toContain("Task 2: Metadata-Only Module Registry");
    expect(pr21TasksDoc).toContain("OWNS:");
  });

  test("PR19 unified Supabase platform schema plan artifacts are durable", () => {
    for (const artifactPath of pr19ArtifactPaths) {
      expect(existsSync(artifactPath)).toBe(true);
    }

    const pr19ResearchDoc = readFileSync(pr19ArtifactPaths[0], "utf8");

    expect(pr19ResearchDoc).toContain(
      "docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md",
    );
    expect(pr19ResearchDoc).toContain("Live Neon baseline");
    expect(pr19ResearchDoc).toContain("Checked-in Supabase baseline");
    expect(buildingBlocksPlan).toContain(
      "PR19 Unified Supabase Platform Schema`: merged via GitHub PR #21 and verified on `origin/main`",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/research/pr19-unified-supabase-platform-schema.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-design.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-tasks.md",
    );
    expect(buildingBlocksPlan).toContain(
      "docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-decisions.md",
    );
  });

  test("PR20 Meeting database cutover plan artifacts are durable", () => {
    for (const artifactPath of pr20ArtifactPaths) {
      expect(existsSync(artifactPath)).toBe(true);
    }

    const pr20ResearchDoc = readFileSync(pr20ArtifactPaths[0], "utf8");
    const pr20DesignDoc = readFileSync(pr20ArtifactPaths[1], "utf8");
    const pr20TasksDoc = readFileSync(pr20ArtifactPaths[3], "utf8");

    expect(pr20ResearchDoc).toContain(
      "docs/plans/2026-05-21-pr17-platform-auth-data-consolidation-design.md",
    );
    expect(pr20ResearchDoc).toContain(
      "docs/plans/2026-06-02-pr19-unified-supabase-platform-schema-design.md",
    );
    expect(pr20ResearchDoc).toContain("docs/architecture/schema-domain-ownership.md");
    expect(pr20DesignDoc).toContain("Status: dev");
    expect(pr20DesignDoc).toContain("Meeting API's hosted database target from Neon Postgres to Supabase Postgres");
    expect(pr20TasksDoc).toContain("Task 2: Meeting Schema Migration Into Supabase");
    expect(pr20TasksDoc).toContain("Task 3: Cutover Preflight");
    expect(pr20TasksDoc).toContain("Task 4: Meeting Runtime Config");
    expect(buildingBlocksPlan).toContain(
      "PR20 Meeting Database Cutover From Neon To Supabase`: merged via GitHub PR #24 and verified on `origin/main`",
    );
  });

  test("meeting-api CI reflects the local validation baseline", () => {
    expect(meetingApiWorkflow).toContain("Run backend lint");
    expect(meetingApiWorkflow).toContain("python -m flake8");
    expect(meetingApiWorkflow).toContain(
      "image: pgvector/pgvector:0.8.6-pg17@sha256:7ae6051efd0e60444282c27c7e141af07f322ce033300e727a49c3dd11075e38",
    );
    expect(meetingApiWorkflow).toContain('--health-cmd "pg_isready -U postgres -d meeting_agent"');
    expect(meetingApiWorkflow).toContain("Run backend migrations");
    expect(meetingApiWorkflow).toContain("0020_canonical_membership_roles");
    expect(meetingApiWorkflow).toContain("--expected-floor 0021");
    expect(meetingApiWorkflow).toContain("Run backend tests");
    expect(meetingApiWorkflow).toContain("python -m pytest apps/meeting-api/tests/backend -q");
  });

  test("roadmap CI reflects the local validation baseline", () => {
    expect(roadmapWebWorkflow).toContain("Roadmap unit tests");
    expect(roadmapWebWorkflow).toContain("bun run test");
  });

  test("roadmap CI preserves the required test check on every pull request", () => {
    const workflow = Bun.YAML.parse(roadmapWebWorkflow);
    const testJob = workflow.jobs.test;

    expect(workflow.on.pull_request.paths).toBeUndefined();
    expect(testJob.name).toBe("test");
    expect(testJob.if).toBeUndefined();
    expect(testJob.steps).toContainEqual(
      expect.objectContaining({
        name: "Install dependencies",
        run: "bun install --frozen-lockfile --ignore-scripts",
      }),
    );
    expect(testJob.steps).toContainEqual(
      expect.objectContaining({
        name: "Install Playwright Browsers",
        run: "bun run --no-install ci:prepare:browsers",
      }),
    );
    expect(roadmapWebWorkflow).not.toContain("bun x playwright install");
    expect(roadmapWebWorkflow).not.toContain("bun run playwright install");
    expect(roadmapWebWorkflow).not.toContain("playwright install");
    expect(roadmapWebPackageJson.scripts["ci:prepare:browsers"]).toBe(
      "playwright install --with-deps chromium",
    );
    expect(testJob.steps).toContainEqual(
      expect.objectContaining({
        name: "Run Playwright tests",
        if: "steps.changes.outputs.run == 'true'",
        run: "bun run test:e2e",
      }),
    );
    expect(testJob.steps).toContainEqual(
      expect.objectContaining({
        name: "Roadmap Playwright N/A",
        if: "steps.changes.outputs.run != 'true'",
      }),
    );
  });

  test("retired Roadmap Supabase authority surfaces stay absent", () => {
    for (const relativePath of [
      ".github/workflows/roadmap-supabase.yml",
      ".github/workflows/roadmap-web-playwright.yml",
      "scripts/check-supabase-exposure.mjs",
      "scripts/meeting-cutover-preflight.mjs",
    ]) {
      expect(existsSync(join(rootDir, relativePath))).toBe(false);
    }

    const cutoverDoc = readFileSync(
      join(rootDir, "docs", "deployment", "MEETING_SUPABASE_CUTOVER.md"),
      "utf8",
    );
    expect(cutoverDoc).toMatch(/historical|non-authoritative/i);
    expect(cutoverDoc).not.toMatch(/bun run preflight:meeting-cutover|DATABASE_PROVIDER=supabase/i);

    const roadmapSetup = readFileSync(
      join(rootDir, "apps", "roadmap-web", "SUPABASE_SETUP.md"),
      "utf8",
    );
    expect(roadmapSetup).toMatch(/unsupported|archived/i);
    expect(roadmapSetup).not.toMatch(/supabase db push|supabase login|NEXT_PUBLIC_SUPABASE_ANON_KEY/i);
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
    expect(repoToolingWorkflow).not.toContain(
      '".github/workflows/roadmap-web-playwright.yml"',
    );
    expect(repoToolingWorkflow).toContain("bun run test:agent-core");
    expect(repoToolingWorkflow).toContain("bun run test:hocuspocus");
    expect(repoToolingWorkflow).toContain("bun run test:roadmap-canvas-boundary");
    expect(repoToolingWorkflow).toContain("bun run test:repo-tooling");
  });

  test("Railway preview completes one event-aware job for every configured event", () => {
    const workflow = Bun.YAML.parse(meetingApiRailwayPreviewWorkflow);
    const pushDeploy = "${{ github.event_name == 'push' && env.HAS_RAILWAY_DEPLOY_SECRETS == 'true' }}";
    const closedCleanup = "${{ github.event_name == 'pull_request' && env.HAS_RAILWAY_CLEANUP_SECRETS == 'true' }}";
    const sharedSetup = "${{ (github.event_name == 'push' && env.HAS_RAILWAY_DEPLOY_SECRETS == 'true') || (github.event_name == 'pull_request' && env.HAS_RAILWAY_CLEANUP_SECRETS == 'true') }}";

    expect(workflow.on.push).toBeDefined();
    expect(workflow.on.pull_request.types).toEqual(["closed"]);
    expect(Object.keys(workflow.jobs)).toEqual(["preview"]);
    expect(workflow.jobs.preview.if).toBeUndefined();
    expect(workflow.jobs.preview.env.HAS_RAILWAY_DEPLOY_SECRETS).toBe(
      "${{ secrets.RAILWAY_API_TOKEN != '' && vars.RAILWAY_PROJECT_ID != '' && vars.RAILWAY_BASE_ENVIRONMENT != '' && vars.RAILWAY_BACKEND_SERVICE != '' }}",
    );
    expect(workflow.jobs.preview.env.HAS_RAILWAY_CLEANUP_SECRETS).toBe(
      "${{ secrets.RAILWAY_API_TOKEN != '' && vars.RAILWAY_PROJECT_ID != '' }}",
    );

    const steps = Object.fromEntries(
      workflow.jobs.preview.steps.map((step) => [step.name, step]),
    );
    expect(steps["Skip when Railway preview secrets are unavailable"].if).toBe(
      "${{ github.event_name == 'push' && env.HAS_RAILWAY_DEPLOY_SECRETS != 'true' }}",
    );
    expect(steps["Skip when Railway cleanup secrets are unavailable"].if).toBe(
      "${{ github.event_name == 'pull_request' && env.HAS_RAILWAY_CLEANUP_SECRETS != 'true' }}",
    );
    expect(steps.Checkout.if).toBe(pushDeploy);
    expect(steps["Install Railway CLI"].if).toBe(sharedSetup);
    expect(steps["Resolve preview environment name"].if).toBe(sharedSetup);
    expect(steps["Create or sync PR environment"].if).toBe(pushDeploy);
    expect(steps["Deploy backend preview"].if).toBe(pushDeploy);
    expect(steps["Delete PR environment"].if).toBe(closedCleanup);
  });

  test("repo-tooling CI fetches full Git history for immutable migration provenance", () => {
    const workflow = Bun.YAML.parse(repoToolingWorkflow);
    const checkout = workflow.jobs["repo-tooling"].steps.find((step) => step.name === "Checkout");
    expect(checkout.with["fetch-depth"]).toBe(0);
  });

  test("protected platform-api preflight fetches immutable migration provenance", () => {
    const workflow = Bun.YAML.parse(platformApiDeployWorkflow);
    const checkout = workflow.jobs.preflight.steps.find((step) => step.name === "Checkout");
    expect(checkout.with["fetch-depth"]).toBe(0);
    expect(platformApiDeployWorkflow).toContain("--expected-pending 0018,0019,0020,0021");
    expect(platformApiDeployWorkflow).toContain("--expected-floor 0021");
  });

  test("db-contract reports every pull request and preserves the stable context", () => {
    const workflow = Bun.YAML.parse(dbContractWorkflow);
    const triggers = workflow.on;

    expect(triggers.pull_request).toEqual({});
    expect(triggers.push?.paths).toBeUndefined();
    expect(workflow.jobs["db-contract"].name).toBe("db-contract");
    expect(dbContractWorkflow).toContain("DB contract N/A: no authority-relevant files changed.");
    expect(dbContractWorkflow).not.toContain("paths-ignore");
  });

  test("reported CI workflows disable dependency lifecycle scripts", () => {
    for (const workflowPath of lifecycleScriptHardenedWorkflowPaths) {
      const workflow = Bun.YAML.parse(readFileSync(workflowPath, "utf8"));
      const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);
      const installs = steps.filter((step) => step.name === "Install dependencies");

      expect(installs.length).toBeGreaterThan(0);
      for (const install of installs) {
        expect(install.run).toBe("bun install --frozen-lockfile --ignore-scripts");
      }
    }
  });

  test("linted authority workspaces own the lint executable", () => {
    const eslintVersion = platformWebPackageJson.devDependencies.eslint;
    expect(eslintVersion).toMatch(/\S/);
    expect(platformApiPackageJson.devDependencies.eslint).toBe(eslintVersion);
    expect(dbPackageJson.devDependencies.eslint).toBe(eslintVersion);
  });

  test("db-contract locks exact-head execution and publishes sanitized teardown evidence", () => {
    const workflow = Bun.YAML.parse(dbContractWorkflow);
    const runtime = workflow.jobs["db-contract-runtime"];
    const steps = runtime.steps;
    const install = steps.find((step) => step.name === "Install dependencies");
    const focusedRun = steps.find((step) => step.name === "Run focused real-Neon conformance proof");
    const requiredRun = steps.find((step) => step.name === "Run required DB-contract suite");
    const exactHead = steps.find((step) => step.name === "Verify planned exact checkout");
    const summary = steps.find((step) => step.name === "Publish DB-contract summary");
    const artifact = steps.find((step) => step.name === "Upload DB-contract telemetry");

    expect(dbContractWorkflow).not.toContain("bunx");
    expect(install.run).toBe("bun install --frozen-lockfile --ignore-scripts");
    expect(steps.find((step) => step.name === "Checkout").with.ref).toBe(
      "${{ needs['classify'].outputs.exactSha }}",
    );
    expect(exactHead.run).toContain('git rev-parse HEAD');
    expect(exactHead.run).toContain('DB_CONTRACT_EXACT_HEAD');
    expect(focusedRun.id).toBe('conformance');
    expect(requiredRun.id).toBe('suite');
    expect(focusedRun["working-directory"]).toBe("apps/platform-api");
    expect(focusedRun.run).toBe("bun test/db-contract/conformance-cli.ts");
    expect(focusedRun.env.NEON_API_KEY).toBe("${{ secrets.NEON_API_KEY }}");
    expect(focusedRun.env.NEON_PROJECT_ID).toBe("${{ secrets.NEON_PROJECT_ID }}");
    expect(focusedRun.env.NEON_PARENT_BRANCH_ID).toBe("${{ secrets.NEON_PARENT_BRANCH_ID }}");
    expect(focusedRun.env.DB_CONTRACT_CONFORMANCE_MARKER_PATH).toBe(
      "${{ runner.temp }}/db-contract-conformance.marker",
    );
    expect(steps.indexOf(focusedRun)).toBeLessThan(steps.indexOf(requiredRun));
    expect(requiredRun.if).toContain("success()");
    expect(requiredRun["working-directory"]).toBe("apps/platform-api");
    expect(requiredRun.run).toBe("bun x --no-install vitest run --config vitest.db-contract.config.ts");
    expect(requiredRun.env.VITEST_SKIP_INSTALL_CHECKS).toBe("1");
    expect(requiredRun.env.DB_CONTRACT_BRANCH_CAP).toBe("${{ vars.DB_CONTRACT_BRANCH_CAP }}");
    expect(requiredRun.env.NEON_API_KEY).toBe("${{ secrets.NEON_API_KEY }}");
    expect(summary["working-directory"]).toBe("apps/platform-api");
    expect(summary.run).toBe("bun test/db-contract/telemetry.ts summary");
    expect(requiredRun.env.NEON_PROJECT_ID).toBe("${{ secrets.NEON_PROJECT_ID }}");
    expect(requiredRun.env.NEON_PARENT_BRANCH_ID).toBe("${{ secrets.NEON_PARENT_BRANCH_ID }}");
    expect(requiredRun.env.DB_CONTRACT_REQUIRED).toBe("1");
    expect(requiredRun.env.DB_CONTRACT_CONFORMANCE_MARKER_PATH).toBe(
      "${{ runner.temp }}/db-contract-conformance.marker",
    );
    expect(runtime.env.NEON_API_KEY).toBeUndefined();
    for (const step of steps.filter((step) => step !== requiredRun && step !== focusedRun)) {
      expect(JSON.stringify(step)).not.toContain("secrets.NEON_");
    }
    expect(summary.if).toContain("steps.conformance.outcome == 'success'");
    expect(artifact.if).toContain("steps.conformance.outcome == 'success'");
  });

  test("db-contract gates protected runtime behind exact-SHA cheap checks", () => {
    const workflow = Bun.YAML.parse(dbContractWorkflow);
    const jobs = workflow.jobs;
    expect(workflow.permissions).toBeUndefined();
    expect(Object.keys(jobs)).toEqual(["classify", "cheap-gates", "db-contract-runtime", "db-contract"]);
    expect(jobs.classify.permissions).toEqual({ contents: "read" });
    expect(jobs["cheap-gates"].permissions).toEqual({ contents: "read" });
    expect(jobs["cheap-gates"].services.postgres).toEqual({
      image: "pgvector/pgvector:0.8.6-pg17@sha256:7ae6051efd0e60444282c27c7e141af07f322ce033300e727a49c3dd11075e38",
      env: {
        POSTGRES_DB: "meeting_agent",
        POSTGRES_USER: "postgres",
        POSTGRES_PASSWORD: "postgres",
      },
      ports: ["5432:5432"],
      options: '--health-cmd "pg_isready -U postgres -d meeting_agent" --health-interval 10s --health-timeout 5s --health-retries 5',
    });
    expect(jobs["cheap-gates"].env).toEqual({
      CI: "true",
      PYTHONPATH: "apps/meeting-api",
      DEPLOYMENT_MODE: "oss",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/meeting_agent",
      MIGRATION_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/meeting_agent",
      DATABASE_ENVIRONMENT: "fresh",
      MEETING_TARGET_SMOKE_REQUIRED: "1",
      MEETING_TARGET_SMOKE_DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:5432/meeting_agent",
      MEETING_TARGET_SMOKE_DATABASE_PROVIDER: "postgres",
    });
    expect(jobs["db-contract-runtime"].permissions).toEqual({ contents: "read" });
    expect(jobs["db-contract"].permissions).toEqual({});
    expect(jobs["cheap-gates"].needs).toEqual("classify");
    expect(jobs["db-contract-runtime"].needs).toEqual(["classify", "cheap-gates"]);
    expect(jobs["db-contract"].needs).toEqual(["classify", "cheap-gates", "db-contract-runtime"]);
    expect(jobs["cheap-gates"].if).toBe("${{ needs.classify.result == 'success' && needs.classify.outputs.exactSha != '' }}");
    expect(jobs["db-contract-runtime"].if).toBe("${{ needs.classify.result == 'success' && needs['cheap-gates'].result == 'success' && needs['classify'].outputs.dbEvidenceRequired == 'true' }}");
    expect(jobs["db-contract-runtime"].environment).toBe("db-contract-production");

    const classifyCheckout = jobs.classify.steps.find((step) => step.name === "Checkout");
    const cheapCheckout = jobs["cheap-gates"].steps.find((step) => step.name === "Checkout");
    const runtimeCheckout = jobs["db-contract-runtime"].steps.find((step) => step.name === "Checkout");
    for (const checkout of [classifyCheckout, cheapCheckout, runtimeCheckout]) {
      expect(checkout.uses).toBe("actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5");
      expect(checkout.with["fetch-depth"]).toBe(0);
      expect(checkout.with["persist-credentials"]).toBe(false);
    }
    const actionUses = Object.values(jobs)
      .flatMap((job) => job.steps)
      .map((step) => step.uses)
      .filter(Boolean);
    for (const uses of actionUses) {
      expect(uses).toMatch(/^[^@]+@[0-9a-f]{40}$/);
    }
    expect(new Set(actionUses)).toEqual(new Set([
      "actions/checkout@34e114876b0b11c390a56381ad16ebd13914f8d5",
      "oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6",
      "actions/setup-python@a26af69be951a213d495a4c3e4e4022e16d87065",
      "actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f",
    ]));
    expect(cheapCheckout.with.ref).toBe("${{ needs['classify'].outputs.exactSha }}");
    expect(runtimeCheckout.with.ref).toBe("${{ needs['classify'].outputs.exactSha }}");

    const selectorDetection = jobs.classify.steps.find(
      (step) => step.name === "Detect selector ownership boundary",
    );
    expect(selectorDetection.env).toEqual({
      CI_CHANGE_PLAN_BASE_SHA: "${{ github.event.pull_request.base.sha || github.event.before }}",
      CI_CHANGE_PLAN_HEAD_SHA: "${{ github.event.pull_request.head.sha || github.sha }}",
    });
    expect(selectorDetection.run).toContain('case "$CI_CHANGE_PLAN_BASE_SHA" in');
    expect(selectorDetection.run).toContain("0000000000000000000000000000000000000000)");
    expect(selectorDetection.run).toContain('changed_paths="$(git --no-replace-objects diff --no-renames --name-only --diff-filter=ACMRD');
    expect(selectorDetection.run).toContain('echo "selectorOwnedChange=$selector_owned_change" >> "$GITHUB_OUTPUT"');
    expect(selectorDetection.run).toContain('echo "baseShaZero=$base_sha_zero" >> "$GITHUB_OUTPUT"');

    const planStepIndex = jobs.classify.steps.findIndex(
      (step) => step.name === "Produce validated changed-surface plan",
    );
    const detectionStepIndex = jobs.classify.steps.findIndex(
      (step) => step.name === "Detect selector ownership boundary",
    );
    expect(detectionStepIndex).toBeLessThan(planStepIndex);

    const selectorGuard = jobs.classify.steps.find(
      (step) => step.name === "Enforce selector ownership boundary",
    );
    expect(selectorGuard.env).toEqual({
      SELECTOR_OWNED_CHANGE: "${{ steps.selector-boundary.outputs.selectorOwnedChange }}",
      SELECTOR_BASE_SHA_ZERO: "${{ steps.selector-boundary.outputs.baseShaZero }}",
      CI_CHANGE_PLAN_HEAD_SHA: "${{ github.event.pull_request.head.sha || github.sha }}",
      PLANNED_SCHEMA_VERSION: "${{ steps.plan.outputs.schemaVersion }}",
      PLANNED_EXACT_SHA: "${{ steps.plan.outputs.exactSha }}",
      PLANNED_INPUT_VALID: "${{ steps.plan.outputs.inputValid }}",
      PLANNED_CLASSIFICATION: "${{ steps.plan.outputs.classification }}",
      PLANNED_CHEAP_SCRIPTS_JSON: "${{ steps.plan.outputs.cheapScriptsJson }}",
      PLANNED_DB_EVIDENCE_REQUIRED: "${{ steps.plan.outputs.dbEvidenceRequired }}",
    });
    expect(selectorDetection.run).toContain(
      ".github/workflows/db-contract.yml|scripts/ci-change-plan.mjs|scripts/prepush-classify.mjs",
    );
    expect(selectorGuard.run).not.toContain("git diff");
    expect(selectorGuard.run).toContain('if [ "$SELECTOR_OWNED_CHANGE" = "true" ]; then');
    expect(selectorGuard.run).toContain('if [ "$SELECTOR_BASE_SHA_ZERO" = "true" ]; then');
    expect(selectorGuard.run).toContain('test "$PLANNED_EXACT_SHA" = "$CI_CHANGE_PLAN_HEAD_SHA"');
    expect(selectorGuard.run).toContain('test "$PLANNED_DB_EVIDENCE_REQUIRED" = "true"');
    expect(selectorGuard.run).toContain('test "$PLANNED_CLASSIFICATION" = "full-suite"');
    expect(selectorGuard.run).toContain(
      '["check:source-test","test:repo-tooling","verify:platform-web","verify:platform-api","verify:meeting-web","verify:roadmap-web","ci:meeting-api","test:contracts","verify:db","test:sdk","test:ui","test:ui-chat","test:ui-canvas","test:ui-meeting","test:ui-planning","test:ui-charting","test:agent-core","test:hocuspocus"]',
    );

    const cheapInstall = jobs["cheap-gates"].steps.find((step) => step.name === "Install dependencies");
    expect(cheapInstall.run).toBe("bun install --frozen-lockfile --ignore-scripts");
    const cheapPython = jobs["cheap-gates"].steps.find((step) => step.name === "Set up Python");
    expect(cheapPython.with["python-version"]).toBe("3.13");
    const cheapMeetingInstall = jobs["cheap-gates"].steps.find((step) => step.name === "Install Meeting API dependencies");
    expect(cheapMeetingInstall.if).toBe("${{ contains(needs.classify.outputs.cheapScriptsJson, '\"ci:meeting-api\"') }}");
    expect(cheapMeetingInstall.run).toBe("node scripts/meeting-api-validation.mjs install apps/meeting-api/backend/requirements.txt");
    const meetingSetupSteps = [
      "Provision Meeting database roles",
      "Run Meeting database migrations",
      "Verify Meeting database history",
      "Assert Meeting target smoke is required",
    ].map((name) => jobs["cheap-gates"].steps.find((step) => step.name === name));
    for (const step of meetingSetupSteps) {
      expect(step.if).toBe("${{ contains(needs.classify.outputs.cheapScriptsJson, '\"ci:meeting-api\"') }}");
    }
    expect(meetingSetupSteps[0].run).toBe("node scripts/provision-database-roles.mjs");
    expect(meetingSetupSteps[1].run).toContain("node scripts/migrate-database.mjs bootstrap --environment fresh");
    expect(meetingSetupSteps[1].run).toContain("0021_command_kernel");
    expect(meetingSetupSteps[2].run).toBe("node scripts/migrate-database.mjs verify --environment fresh --history-variant repaired-bootstrap --expected-floor 0021");
    expect(meetingSetupSteps[3].run).toContain('test "$MEETING_TARGET_SMOKE_DATABASE_URL" = "$DATABASE_URL"');
    const cheapRun = jobs["cheap-gates"].steps.find((step) => step.name === "Run selected cheap gates sequentially");
    expect(cheapRun.env.SOURCE_TEST_BASE_SHA).toBe("${{ github.event.pull_request.base.sha || github.event.before }}");
    expect(cheapRun.env.SOURCE_TEST_HEAD_SHA).toBe("${{ needs['classify'].outputs.exactSha }}");
    for (const key of [
      "PYTHONPATH",
      "DEPLOYMENT_MODE",
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "DATABASE_ENVIRONMENT",
      "MEETING_TARGET_SMOKE_REQUIRED",
      "MEETING_TARGET_SMOKE_DATABASE_URL",
      "MEETING_TARGET_SMOKE_DATABASE_PROVIDER",
    ]) {
      expect(cheapRun.run).toContain(`'${key}'`);
    }
    expect(cheapRun.run).toContain("if (script !== 'ci:meeting-api')");
    expect(cheapRun.run).toContain("delete childEnvironment[key]");
    expect(cheapRun.run).toContain("env: childEnvironment");
    for (const script of [
      "check:source-test",
      "test:repo-tooling",
      "verify:platform-web",
      "verify:platform-api",
      "verify:meeting-web",
      "verify:roadmap-web",
      "test:roadmap-canvas-boundary",
      "ci:meeting-api",
      "test:contracts",
      "verify:db",
      "test:sdk",
      "test:ui",
      "test:ui-chat",
      "test:ui-canvas",
      "test:ui-meeting",
      "test:ui-planning",
      "test:ui-charting",
      "test:agent-core",
      "test:hocuspocus",
    ]) {
      expect(cheapRun.run).toContain(`'${script}': [`);
    }
    expect(cheapRun.run).toContain("const commands = canonicalCommands[script]");
    expect(cheapRun.run).toContain(
      "command('apps/roadmap-web', 'bun', ['x', '--no-install', 'vitest', 'run', 'src/components/blocksuite/__tests__/canvas-boundary.test.ts'])",
    );
    expect(cheapRun.run).toContain("CI_CHANGE_PLAN_CANONICAL_COMMAND_MISSING");
    expect(cheapRun.run).toContain("spawnSync(command.executable, command.args");
    expect(cheapRun.run).not.toContain("spawnSync('bun', ['run', script]");
    const runtimeRun = jobs["db-contract-runtime"].steps.find((step) => step.name === "Run required DB-contract suite");
    expect(runtimeRun.run).toBe("bun x --no-install vitest run --config vitest.db-contract.config.ts");
    expect(runtimeRun.env.NEON_API_KEY).toBe("${{ secrets.NEON_API_KEY }}");
    expect(runtimeRun.env.NEON_PROJECT_ID).toBe("${{ secrets.NEON_PROJECT_ID }}");
    expect(runtimeRun.env.DB_CONTRACT_REQUIRED).toBe("1");
    expect(jobs["db-contract-runtime"].env).toEqual({ CI: "true" });

    for (const [jobId, job] of Object.entries(jobs)) {
      if (jobId === "db-contract-runtime") continue;
      expect(JSON.stringify(job)).not.toContain("secrets.NEON_");
    }
    expect(jobs["db-contract"].if).toBe("${{ always() }}");
    const finalRun = jobs["db-contract"].steps.find((step) => step.name === "Validate final DB-contract verdict");
    expect(finalRun.run).toContain("cancelled");
    expect(finalRun.run).toContain("exact");
    expect(finalRun.run).toContain("N/A");
    expect(dbContractWorkflow).toContain("github.event.pull_request.number || github.ref");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
    expect(dbContractTelemetry).toContain("Zero skip:");
    expect(dbContractTelemetry).toContain("Cleanup:");
    expect(platformApiPackageJson.scripts["test:db-contract:list"]).toBe(
      "DB_CONTRACT_LIST_ONLY=1 vitest list --config vitest.db-contract.config.ts",
    );
    expect(platformApiPackageJson.scripts["test:db-contract:required"]).toBe(
      "vitest run --config vitest.db-contract.config.ts",
    );
    expect(platformApiPackageJson.scripts["test:db-contract:conformance"]).toBe(
      "bun test/db-contract/conformance-cli.ts",
    );
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
