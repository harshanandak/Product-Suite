import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  buildCiPlan,
  CI_PLAN_SCHEMA_VERSION,
} from "../scripts/prepush-classify.mjs";
import { planFromInputs } from "../scripts/ci-change-plan.mjs";

// This file covers the gate's impure CLI shell: that it reads its env toggles and
// reports the classification it computed. The routing RULES themselves are pure and
// asserted in-process by test/prepush-classify.test.js — deliberately not here,
// because every test below spawns a fresh runtime (~1-2s cold start on Windows).
// Keeping that cost to ONE spawn per test is what stops this suite from blowing
// bun's default 5000ms per-test timeout while the gate runs it during a real push.
const scriptPath = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "scripts",
  "prepush-gate.mjs"
);

// Wall-clock headroom for the single process spawn each test performs. This bounds
// runtime startup under a loaded machine — it is not a logic assertion, and every
// expectation below still has to hold.
const SPAWN_TIMEOUT_MS = 30_000;

// Every env key the gate script reads. The harness must OWN all of them for
// every spawn: this suite is part of the always-on `test:repo-tooling` check, so
// it runs inside a real `PREPUSH_GATE_FAST=1 git push`. If an ambient value
// leaked into the spawned child, the default-mode assertions below would read
// fast-mode output and abort the push (issue #118).
const GATE_ENV_KEYS = ["PREPUSH_GATE_FAST", "PREPUSH_GATE_DRY", "PREPUSH_GATE_TEST_FILES"];

// Build the child env explicitly: inherit everything EXCEPT the gate keys, then
// apply only the overrides this call asks for. A key absent from `overrides` is
// genuinely deleted, not merely omitted — relying on the parent not to set it is
// exactly the bug in #118. Case-insensitive removal because Windows env names
// are case-insensitive (a `prepush_gate_fast` would otherwise survive).
function gateEnv(overrides = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (GATE_ENV_KEYS.includes(key.toUpperCase())) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) continue;
    env[key] = value;
  }
  return env;
}

// Run the real gate CLI in dry-run mode and return what it printed.
function classify(files, extraEnv = {}) {
  return execFileSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    env: gateEnv({
      PREPUSH_GATE_TEST_FILES: files.join(","),
      PREPUSH_GATE_DRY: "1",
      ...extraEnv,
    }),
  }).trim();
}

// Same dry-run classification, but with the fast-mode toggle set explicitly.
function classifyFast(files) {
  return classify(files, { PREPUSH_GATE_FAST: "1" });
}

// Run `fn` with `vars` temporarily present in this process's env, then restore
// the previous values (including deleting keys that were previously unset).
function withAmbientEnv(vars, fn) {
  const saved = new Map();
  for (const [key, value] of Object.entries(vars)) {
    saved.set(key, process.env[key]);
    process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe("prepush-gate CLI wiring", () => {
  test(
    "the CLI reads PREPUSH_GATE_TEST_FILES and reports the scoped plan",
    () => {
      // End-to-end proof that the shell wires env -> classifier -> printed report.
      const out = classify(["apps/platform-web/src/x.tsx"]);
      expect(out).toContain("classification: scoped");
      expect(out).toContain("verify:platform-web");
      expect(out).not.toContain("mode: fast");
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "PREPUSH_GATE_FAST=1 switches the CLI to the fast-mode report",
    () => {
      const out = classifyFast(["apps/platform-web/src/x.tsx"]);
      expect(out).toContain("mode: fast");
      expect(out).toContain("apps/platform-web:lint");
      expect(out).not.toContain("verify:platform-web");
    },
    SPAWN_TIMEOUT_MS,
  );
});

describe("change-aware CI plan", () => {
  const SHA = "a".repeat(40);
  const BASE = "b".repeat(40);

  test("scoped workspace changes include ordered cheap gates and no DB evidence", () => {
    const plan = buildCiPlan(["apps/platform-web/src/x.tsx"], SHA);
    expect(plan).toMatchObject({
      schemaVersion: CI_PLAN_SCHEMA_VERSION,
      exactSha: SHA,
      classification: "scoped",
      dbEvidenceRequired: false,
    });
    expect(plan.cheapScripts).toEqual([
      "check:source-test",
      "test:repo-tooling",
      "verify:platform-web",
    ]);
  });

  test("docs-only changes permit explicit N/A and only run integrity", () => {
    const plan = buildCiPlan(["docs/work/example/plan.md"], SHA);
    expect(plan.classification).toBe("docs-only");
    expect(plan.cheapScripts).toEqual(["check:source-test"]);
    expect(plan.dbEvidenceRequired).toBe(false);
    expect(plan.dbEvidenceReason).toBe("non-authority change");
  });

  test("Roadmap API CLAUDE pointer guidance stays off the DB Contract path", () => {
    for (const file of [
      "apps/roadmap-web/src/app/api/CLAUDE.md",
      "apps/roadmap-web/src/app/api/dependencies/CLAUDE.md",
    ]) {
      const plan = buildCiPlan({
        files: [file],
        exactSha: SHA,
        fileContents: { [file]: "@AGENTS.md\n" },
      });
      expect(plan.dbEvidenceRequired, file).toBe(false);
      expect(plan.classification, file).toBe("scoped");
      expect(plan.cheapScripts, file).toContain("test:roadmap-canvas-boundary");
      expect(plan.cheapScripts, file).not.toContain("verify:roadmap-web");
    }
  });

  test("Roadmap API CLAUDE changes without verified pointer content fail closed", () => {
    const file = "apps/roadmap-web/src/app/api/CLAUDE.md";
    for (const fileContents of [undefined, {}, { [file]: "# changed guidance\n" }]) {
      const plan = buildCiPlan({ files: [file], exactSha: SHA, fileContents });
      expect(plan.dbEvidenceRequired, JSON.stringify(fileContents)).toBe(true);
      expect(plan.classification, JSON.stringify(fileContents)).toBe("full-suite");
    }
  });

  test("Roadmap API AGENTS guidance and behavior remain fail-closed", () => {
    for (const file of [
      "apps/roadmap-web/src/app/api/AGENTS.md",
      "apps/roadmap-web/src/app/api/dependencies/AGENTS.md",
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
      expect(plan.cheapScripts, file).toContain("verify:roadmap-web");
      expect(plan.cheapScripts, file).not.toContain("test:roadmap-canvas-boundary");
    }
  });

  test("Roadmap API pointer documentation cannot mask behavior changes", () => {
    const plan = buildCiPlan([
      "apps/roadmap-web/src/app/api/dependencies/CLAUDE.md",
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
    ], SHA);
    expect(plan.dbEvidenceRequired).toBe(true);
    expect(plan.classification).toBe("full-suite");
    expect(plan.cheapScripts).toContain("verify:roadmap-web");
    expect(plan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");
  });

  test("authority, API, DB, migration, security, and workflow changes require DB proof", () => {
    for (const files of [
      ["apps/platform-api/src/agent/tools.ts"],
      ["packages/db/src/schema.ts"],
      ["infra/neon/migrations/001.sql"],
      ["scripts/check-worker-secrets.mjs"],
      ["scripts/prepush-gate.mjs"],
      ["apps/platform-web/src/auth/session.ts"],
      [".github/workflows/db-contract.yml"],
    ]) {
      const plan = buildCiPlan(files, SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("authority/security ownership rules fail closed across explicit and keyword surfaces", () => {
    const authorityPaths = [
      "apps/meeting-api/backend/tenant_context.py",
      "apps/meeting-api/backend/auth.py",
      "scripts/delivery/classify-change.mjs",
      "scripts/delivery/security-routing.mjs",
      "scripts/check-source-test-coupling.mjs",
      "scripts/check-historical-db-artifacts.mjs",
      "packages/contracts/src/auth/index.d.ts",
      "packages/contracts/src/conversation.js",
      "packages/contracts/src/meeting.js",
      "packages/contracts/src/work-items.js",
      "packages/contracts/src/authorization/policy.ts",
      "packages/contracts/src/permissions/index.d.ts",
      "packages/contracts/src/identity/user.ts",
      "apps/platform-web/src/tenant/route.ts",
      "apps/platform-web/src/identity/session.ts",
      "apps/platform-web/src/access/guard.ts",
      "apps/platform-web/src/permission/check.ts",
      "apps/platform-web/src/security/csp.ts",
      "apps/meeting-web/src/lib/authContracts.js",
      "apps/meeting-web/src/lib/hostedAuthFlow.js",
    ];
    for (const file of authorityPaths) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
    }
  });

  test("meeting runtime config and platform shell layout require DB proof", () => {
    for (const file of [
      "apps/meeting-web/src/lib/runtimeConfig.js",
      "APPS/MEETING-WEB/SRC/LIB/RUNTIMECONFIG.JS",
      "apps/platform-web/src/shell/ShellLayout.tsx",
      "APPS/PLATFORM-WEB/SRC/SHELL/SHELLLAYOUT.TSX",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
    }

    for (const file of [
      "apps/meeting-web/src/lib/runtimeConfig.js.bak",
      "apps/meeting-web/src/lib/runtimeConfig.jsx",
      "apps/meeting-web/src/lib/runtimeConfig.js/extra",
      "apps/platform-web/src/shell/ShellLayout.ts",
      "apps/platform-web/src/shell/ShellLayout.tsx.bak",
      "apps/platform-web/src/shell/ShellLayout.tsx/extra",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(false);
      expect(plan.classification, file).toBe("scoped");
    }
  });

  test("executable migration authority and existing OAuth, token, and session surfaces fail closed", () => {
    const authorityPaths = [
      "docs/history/database-migrations/manifest.json",
      "scripts/provision-database-roles.mjs",
      "scripts/database-pool.mjs",
      "apps/roadmap-web/src/lib/integrations/oauth-providers.ts",
      "apps/roadmap-web/src/app/api/integrations/oauth/callback/[provider]/route.ts",
      "apps/roadmap-web/src/app/api/review-links/by-token/[token]/route.ts",
      "apps/meeting-api/backend/db.py",
      "apps/meeting-api/backend/config.py",
      "apps/meeting-api/backend/server.py",
      "apps/meeting-api/backend/settings.py",
      "apps/meeting-api/backend/repositories/history.py",
      "apps/meeting-api/backend/routes/history.py",
      "apps/meeting-api/backend/routes/tools.py",
      "apps/meeting-api/backend/alembic/versions/0001_multi_user_jobs.py",
      "apps/meeting-api/backend/migrate.py",
      "apps/meeting-api/backend/alembic/versions/0005_remove_workos_session_id.py",
      "apps/roadmap-web/src/middleware.ts",
      "apps/roadmap-web/src/lib/supabase/middleware.ts",
      "apps/roadmap-web/src/lib/supabase/server.ts",
      "apps/roadmap-web/src/lib/supabase/database.types.ts",
      "apps/roadmap-web/supabase/config.toml",
      "apps/roadmap-web/src/app/api/team/members/[id]/route.ts",
      "apps/roadmap-web/src/app/api/team/phase-assignments/route.ts",
      "apps/roadmap-web/src/app/api/invitations/send/route.ts",
      "apps/roadmap-web/src/app/api/departments/[id]/route.ts",
      "apps/roadmap-web/src/app/api/workspaces/[id]/mode/route.ts",
      "apps/roadmap-web/src/app/api/debug/member-status/route.ts",
      "apps/roadmap-web/src/app/api/admin/setup-users-table/route.ts",
      "apps/roadmap-web/src/app/api/user/profile/route.ts",
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
      "apps/roadmap-web/src/app/api/work-items/route.ts",
      "apps/meeting-web/src/lib/api.js",
      "apps/meeting-web/src/hooks/useBuddyAgent.js",
      "apps/meeting-web/src/hooks/useMeetingState.js",
      "apps/meeting-web/src/hooks/useRealtimeTranscript.js",
      "apps/platform-web/src/data/work-items/RepositoryProvider.tsx",
      "apps/platform-web/src/data/meeting-actions/MeetingActionsRepositoryProvider.tsx",
      "apps/platform-web/src/data/proposals/ProposalRepositoryProvider.tsx",
      "apps/platform-web/src/data/memories/MemoriesProvider.tsx",
      "apps/platform-web/src/data/meeting-actions/network-repository.ts",
      "apps/platform-web/src/data/proposals/network-repository.ts",
      "apps/platform-web/src/data/agent/transport.ts",
      "apps/platform-web/src/data/memories/adapter.ts",
      "apps/roadmap-web/src/app/(dashboard)/layout.tsx",
      "apps/roadmap-web/src/app/(dashboard)/workspaces/[id]/page.tsx",
      "apps/roadmap-web/src/app/(auth)/accept-invite/page.tsx",
      "apps/roadmap-web/src/app/(auth)/layout.tsx",
      "apps/roadmap-web/src/app/(auth)/auth/callback/route.ts",
      "apps/roadmap-web/src/lib/ai/agent-executor.ts",
      "apps/roadmap-web/src/lib/ai/context-builder.ts",
      "apps/roadmap-web/src/lib/ai/compression/l2-summarizer.ts",
      "apps/roadmap-web/src/lib/ai/embeddings/document-processor.ts",
      "apps/roadmap-web/scripts/upgrade-user-to-pro.ts",
    ];

    for (const file of authorityPaths) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(true);
      expect(plan.classification, file).toBe("full-suite");
    }

    const roadmapAuthorityPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/integrations/oauth/callback/[provider]/route.ts",
    ], SHA);
    expect(roadmapAuthorityPlan.cheapScripts).toContain("verify:roadmap-web");
    expect(roadmapAuthorityPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");

    const roadmapMembershipPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/team/members/[id]/route.ts",
    ], SHA);
    expect(roadmapMembershipPlan.cheapScripts).toContain("verify:roadmap-web");
    expect(roadmapMembershipPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");

    const roadmapIdentityPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/user/profile/route.ts",
    ], SHA);
    expect(roadmapIdentityPlan.cheapScripts).toContain("verify:roadmap-web");
    expect(roadmapIdentityPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");

    const roadmapApiPlan = buildCiPlan([
      "apps/roadmap-web/src/app/api/dependencies/route.ts",
    ], SHA);
    expect(roadmapApiPlan.cheapScripts).toContain("verify:roadmap-web");
    expect(roadmapApiPlan.cheapScripts).not.toContain("test:roadmap-canvas-boundary");
  });

  test("the contracts authority entrypoints require DB proof", () => {
    for (const file of ["packages/contracts/src/index.js", "packages/contracts/src/index.d.ts"]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("platform-web authentication roots require DB proof", () => {
    for (const file of ["apps/platform-web/src/AppRoot.tsx", "apps/platform-web/src/fixtures-mode.ts"]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("root and workspace manifests require the full canonical DB path", () => {
    for (const file of [
      "package.json",
      "apps/platform-web/package.json",
      "packages/contracts/package.json",
      "packages/ui-meeting/package.json",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.classification).toBe("full-suite");
    }
  });

  test("unrelated surfaces remain scoped and do not acquire DB proof", () => {
    for (const file of [
      "apps/platform-web/src/components/board.tsx",
      "apps/meeting-api/backend/health.py",
      "packages/ui/src/button.tsx",
      "packages/ui/src/styles/tokens.css",
      "apps/roadmap-web/src/components/roadmap-card.tsx",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(false);
      expect(plan.classification, file).toBe("scoped");
    }

    const roadmapComponentPlan = buildCiPlan(
      ["apps/roadmap-web/src/components/roadmap-card.tsx"],
      SHA,
    );
    expect(roadmapComponentPlan.cheapScripts).toContain("test:roadmap-canvas-boundary");
    expect(roadmapComponentPlan.cheapScripts).not.toContain("verify:roadmap-web");
  });

  test("unrelated documentation remains docs-only even when it discusses design tokens", () => {
    const plan = buildCiPlan(["docs/design/tokens.css"], SHA);
    expect(plan.dbEvidenceRequired).toBe(false);
    expect(plan.classification).toBe("docs-only");
  });

  test("ordinary authority documentation stays docs-only while executable DB history remains protected", () => {
    for (const file of [
      "docs/plans/2026-05-16-pr5-auth-contracts-and-adapters-design.md",
      "docs/security/authorization-model.md",
    ]) {
      const plan = buildCiPlan([file], SHA);
      expect(plan.dbEvidenceRequired, file).toBe(false);
      expect(plan.classification, file).toBe("docs-only");
    }

    const manifestPlan = buildCiPlan(["docs/history/database-migrations/manifest.json"], SHA);
    expect(manifestPlan.dbEvidenceRequired).toBe(true);
    expect(manifestPlan.classification).toBe("full-suite");
  });

  test("ambiguous ranges and unowned paths fail closed to full DB validation", () => {
    for (const input of [null, [], ["unknown-root-file.txt"], ["apps/platform-web/src/x.tsx", "README"]]) {
      const plan = buildCiPlan(input, SHA);
      expect(plan.classification).toBe("full-suite");
      expect(plan.dbEvidenceRequired).toBe(true);
    }
  });

  test("invalid exact SHA remains an explicit invalid full plan", () => {
    const plan = buildCiPlan(["apps/platform-web/src/x.tsx"], "not-a-sha");
    expect(plan.classification).toBe("full-suite");
    expect(plan.dbEvidenceRequired).toBe(true);
    expect(plan.exactSha).toBeNull();
    expect(plan.inputValid).toBe(false);
  });

  test("CLI adapter validates refs and produces deterministic output", () => {
    const plan = planFromInputs({
      baseSha: BASE,
      headSha: SHA,
      files: ["apps/platform-web/src/x.tsx"],
    });
    expect(plan).toEqual(planFromInputs({
      baseSha: BASE,
      headSha: SHA,
      files: ["apps/platform-web/src/x.tsx"],
    }));
    expect(plan.exactSha).toBe(SHA);
    expect(plan.inputValid).toBe(true);
  });

  test("malformed base or missing file range produces full fail-closed plan", () => {
    for (const input of [
      { baseSha: "bad", headSha: SHA, files: ["docs/a.md"] },
      { baseSha: BASE, headSha: SHA, files: null },
    ]) {
      const plan = planFromInputs(input);
      expect(plan.classification).toBe("full-suite");
      expect(plan.dbEvidenceRequired).toBe(true);
      expect(plan.inputValid).toBe(false);
      expect(plan.exactSha).toBe(SHA);
    }
  });
});

describe("prepush-gate harness env isolation (regression for #118)", () => {
  // `test:repo-tooling` is an always-on gate check, so this file executes during a
  // real `PREPUSH_GATE_FAST=1 git push`. Before the fix the spawned gate inherited
  // that ambient flag, the default-mode expectations read fast-mode output, and the
  // push aborted — PREPUSH_GATE_FAST could never be used. These tests simulate the
  // ambient environment directly so the leak cannot come back.
  test(
    "an ambient PREPUSH_GATE_FAST=1 does not leak into default-mode spawns",
    () => {
      withAmbientEnv({ PREPUSH_GATE_FAST: "1" }, () => {
        const out = classify(["apps/platform-web/src/x.tsx"]);
        expect(out).not.toContain("mode: fast");
        expect(out).toContain("verify:platform-web");
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "fast-mode cases still opt in explicitly even with no ambient flag set",
    () => {
      withAmbientEnv({ PREPUSH_GATE_FAST: "" }, () => {
        const out = classifyFast(["apps/platform-web/src/x.tsx"]);
        expect(out).toContain("mode: fast");
        expect(out).toContain("apps/platform-web:lint");
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  test(
    "ambient PREPUSH_GATE_DRY / PREPUSH_GATE_TEST_FILES cannot override the harness",
    () => {
      // Ambient DRY=0 must not make the gate actually execute checks, and an ambient
      // file list must not replace the one the test passed in (package.json would
      // otherwise force full-suite).
      withAmbientEnv({ PREPUSH_GATE_DRY: "0", PREPUSH_GATE_TEST_FILES: "package.json" }, () => {
        const out = classify(["apps/platform-web/src/x.tsx"]);
        expect(out).toContain("scoped");
        expect(out).toContain("verify:platform-web");
        expect(out).not.toContain("full-suite");
      });
    },
    SPAWN_TIMEOUT_MS,
  );

  test("gateEnv removes gate keys in any casing and keeps the rest of the env", () => {
    // Injects the gate keys in lower/mixed case so the assertion actually depends
    // on the case-insensitive filtering: on Windows these ARE the same variables,
    // and on Linux they are distinct ones that a case-sensitive filter would leak
    // straight into the child. Drop the `.toUpperCase()` in gateEnv and this fails.
    // The sentinel proves unrelated ambient env survives — a length check cannot.
    withAmbientEnv(
      {
        prepush_gate_fast: "1",
        Prepush_Gate_Dry: "0",
        PREPUSH_GATE_TEST_FILES: "package.json",
        PREPUSH_GATE_SENTINEL_KEPT: "yes",
      },
      () => {
        const env = gateEnv({ PREPUSH_GATE_DRY: "1" });

        // Compare against GATE_ENV_KEYS, not a `PREPUSH_GATE_` prefix: only those
        // three keys are owned by the harness, and the sentinel below shares the
        // prefix precisely to prove the filter is key-scoped rather than prefix-scoped.
        const leaked = Object.keys(env).filter(
          (key) => GATE_ENV_KEYS.includes(key.toUpperCase()) && key !== "PREPUSH_GATE_DRY",
        );
        expect(leaked).toEqual([]);

        expect(env.PREPUSH_GATE_DRY).toBe("1");
        expect(env.PREPUSH_GATE_SENTINEL_KEPT).toBe("yes");
        // non-gate env is still inherited, so the child can find node/bun and its deps
        expect(env.PATH ?? env.Path).toBeDefined();
      },
    );
  });
});
