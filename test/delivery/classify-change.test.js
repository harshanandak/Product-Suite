import { describe, expect, test } from "bun:test";
import { classifyChange } from "../../scripts/delivery/classify-change.mjs";

const BASE_SHA = "1".repeat(40);
const HEAD_SHA = "2".repeat(40);

const input = (changedFiles, overrides = {}) => ({
  pr: 172,
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  changedFiles,
  sourceEvidence: { status: "ok" },
  ...overrides,
});

const dependencyCatalog = (packageNames = ["@floating-ui/react"]) => ({
  schemaVersion: "delivery-dependency-catalog.v1",
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  workspaceRoots: ["apps/platform-web"],
  packageNames,
});

const provenUiDependency = {
  status: "proven",
  baseSha: BASE_SHA,
  headSha: HEAD_SHA,
  affectedWorkspaces: ["apps/platform-web"],
  changedPackages: ["@floating-ui/react"],
  databaseRuntimeChanged: false,
  frozenLockConsistent: true,
  packageManagerLifecycleChanged: false,
  dependencyCatalog: dependencyCatalog(),
};

describe("delivery change classifier", () => {
  test.each([
    ["allowlisted docs", ["docs/guides/DELIVERY.md"], "T0", "t0_allowlist"],
    ["allowlisted inert config", [".editorconfig"], "T0", "t0_allowlist"],
    [
      "bounded UI leaf",
      ["apps/platform-web/src/shell/TopBar.tsx", "apps/platform-web/src/shell/TopBar.test.tsx"],
      "T1",
      "bounded_leaf_workspace",
    ],
    [
      "shared API contract",
      ["packages/contracts/src/work-items.js", "packages/contracts/src/work-items.test.ts"],
      "T2",
      "shared_or_api_behavior",
    ],
    ["shared UI package", ["packages/ui/src/Button.tsx"], "T2", "shared_or_api_behavior"],
    [
      "cross-application behavior",
      ["apps/platform-web/src/shell/TopBar.tsx", "apps/roadmap-web/src/app/page.tsx"],
      "T2",
      "cross_workspace_behavior",
    ],
    ["authentication", ["packages/contracts/src/auth.js"], "T3", "sensitive_or_authority_path"],
    ["tenant identity", ["packages/contracts/src/identity.js"], "T3", "sensitive_or_authority_path"],
    ["Neon database", ["packages/db/src/schema.ts"], "T3", "sensitive_or_authority_path"],
    ["platform API", ["apps/platform-api/src/routes/checks.ts"], "T3", "sensitive_or_authority_path"],
    ["workflow authority", [".github/workflows/db-contract.yml"], "T3", "sensitive_or_authority_path"],
    ["classifier self-change", ["scripts/delivery/classify-change.mjs"], "T3", "sensitive_or_authority_path"],
    ["deployment authority doc", ["docs/deployment.md"], "T3", "sensitive_or_authority_path"],
    ["unknown path", ["experimental/widget.xyz"], "T3", "unknown_path"],
  ])("classifies %s", (_name, changedFiles, tier, reason) => {
    const result = classifyChange(input(changedFiles));

    expect(result.tier).toBe(tier);
    expect(result.reasons).toContain(reason);
  });

  test("emits the complete versioned exact-SHA decision contract", () => {
    const result = classifyChange(input(["README.md"]));

    expect(result).toEqual({
      schemaVersion: "delivery-classification.v1",
      classifierVersion: "1.0.0",
      pr: 172,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
      changedFileDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
      tier: "T0",
      reasons: ["t0_allowlist"],
      dependencyEvidence: { status: "not_applicable" },
      expectedChecks: ["targeted", "dependency-security", "affected-build"],
      settleMinutes: 0,
    });
  });

  test("normalizes file order before hashing and classification", () => {
    const files = ["apps/platform-web/src/shell/TopBar.test.tsx", "apps/platform-web/src/shell/TopBar.tsx"];

    expect(classifyChange(input(files)).changedFileDigest).toBe(
      classifyChange(input([...files].reverse())).changedFileDigest,
    );
  });

  test.each(["api_error", "parser_error", "unsupported"])(
    "fails closed for %s source evidence",
    (status) => {
      const result = classifyChange(input(["README.md"], { sourceEvidence: { status } }));

      expect(result.tier).toBe("T3");
      expect(result.reasons).toContain("source_evidence_invalid");
    },
  );

  test.each([
    ["empty changes", [], {}, "changed_files_invalid"],
    ["invalid changed files", null, {}, "changed_files_invalid"],
    ["invalid base SHA", ["README.md"], { baseSha: "main" }, "exact_sha_invalid"],
    ["invalid PR", ["README.md"], { pr: null }, "pr_invalid"],
  ])("fails closed for %s", (_name, files, overrides, reason) => {
    const result = classifyChange(input(files, overrides));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain(reason);
  });

  test("does not let an allowlisted file hide an unknown path", () => {
    const result = classifyChange(input(["README.md", "unknown/file.bin"]));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("unknown_path");
  });

  test("lets sensitive policy paths outrank the documentation allowlist", () => {
    const result = classifyChange(input(["docs/security/auth-policy.md"]));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("sensitive_or_authority_path");
  });

  test("promotes a mixed docs and bounded UI change to T1", () => {
    const result = classifyChange(input(["README.md", "apps/platform-web/src/shell/TopBar.tsx"]));

    expect(result.tier).toBe("T1");
    expect(result.expectedChecks).toEqual(["targeted", "dependency-security", "affected-build"]);
    expect(result.settleMinutes).toBe(2);
  });

  test("accepts a UI-only lock change with matching positive graph proof", () => {
    const result = classifyChange(
      input(["bun.lock", "apps/platform-web/src/shell/TopBar.tsx"], {
        dependencyEvidence: provenUiDependency,
      }),
    );

    expect(result.tier).toBe("T1");
    expect(result.reasons).toContain("dependency_closure_proven_safe");
    expect(result.dependencyEvidence).toEqual(provenUiDependency);
    expect(result.expectedChecks).toContain("migration-integrity");
  });

  test("escalates a transitive DB-driver lock change", () => {
    const result = classifyChange(input(["bun.lock"], {
      dependencyEvidence: {
        ...provenUiDependency,
        changedPackages: ["postgres"],
        dependencyCatalog: dependencyCatalog(["postgres"]),
        databaseRuntimeChanged: true,
      },
    }));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("dependency_changes_db_runtime");
  });

  test("rejects a dependency proof that contradicts its DB-driver closure", () => {
    const result = classifyChange(input(["bun.lock"], {
      dependencyEvidence: {
        ...provenUiDependency,
        changedPackages: ["@neondatabase/serverless"],
        dependencyCatalog: dependencyCatalog(["@neondatabase/serverless"]),
        databaseRuntimeChanged: false,
      },
    }));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("dependency_proof_contradiction");
  });

  test("rejects a package-manager lifecycle change even with a safe dependency graph", () => {
    const result = classifyChange(input(["package.json"], {
      dependencyEvidence: {
        ...provenUiDependency,
        packageManagerLifecycleChanged: true,
      },
    }));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("dependency_changes_lifecycle");
  });

  test("promotes a proven dependency closure spanning UI workspaces to T2", () => {
    const result = classifyChange(input(["bun.lock"], {
      dependencyEvidence: {
        ...provenUiDependency,
        affectedWorkspaces: ["apps/platform-web", "apps/roadmap-web"],
        dependencyCatalog: {
          ...dependencyCatalog(),
          workspaceRoots: ["apps/platform-web", "apps/roadmap-web"],
        },
      },
    }));

    expect(result.tier).toBe("T2");
    expect(result.expectedChecks).toContain("impacted-integration");
    expect(result.settleMinutes).toBe(5);
  });

  test.each([
    ["missing proof", undefined, "dependency_proof_missing"],
    ["mismatched proof", { ...provenUiDependency, headSha: "3".repeat(40) }, "dependency_proof_mismatch"],
    ["unsupported proof", { ...provenUiDependency, status: "unsupported" }, "dependency_proof_invalid"],
    ["missing changed closure", { ...provenUiDependency, changedPackages: undefined }, "dependency_proof_invalid"],
    ["inconsistent frozen lock", { ...provenUiDependency, frozenLockConsistent: false }, "dependency_proof_invalid"],
    ["missing dependency catalog", { ...provenUiDependency, dependencyCatalog: undefined }, "dependency_catalog_invalid"],
    [
      "mismatched dependency catalog",
      { ...provenUiDependency, dependencyCatalog: { ...dependencyCatalog(), headSha: "3".repeat(40) } },
      "dependency_catalog_mismatch",
    ],
  ])("fails closed for %s", (_name, dependencyEvidence, reason) => {
    const result = classifyChange(input(["bun.lock"], { dependencyEvidence }));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain(reason);
  });

  test.each([
    ["nested workspace path", { affectedWorkspaces: ["apps/platform-web/src"] }],
    ["workspace with trailing slash", { affectedWorkspaces: ["apps/platform-web/"] }],
    ["unknown workspace", { affectedWorkspaces: ["apps/unknown-web"] }],
    ["duplicate workspace", { affectedWorkspaces: ["apps/platform-web", "apps/platform-web"] }],
    ["path-like package", { changedPackages: ["../postgres"] }],
    ["URL package", { changedPackages: ["https://example.test/package.tgz"] }],
    ["duplicate package", { changedPackages: ["react", "react"] }],
  ])("rejects malformed dependency closure: %s", (_name, mutation) => {
    const result = classifyChange(input(["bun.lock"], {
      dependencyEvidence: { ...provenUiDependency, ...mutation },
    }));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("dependency_proof_invalid");
  });

  test("rejects a syntactically valid package absent from the exact-SHA catalog", () => {
    const result = classifyChange(input(["bun.lock"], {
      dependencyEvidence: {
        ...provenUiDependency,
        changedPackages: ["not-a-real-package"],
      },
    }));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("dependency_package_unresolved");
  });

  test("rejects a known workspace absent from the exact-SHA catalog", () => {
    const result = classifyChange(input(["bun.lock"], {
      dependencyEvidence: {
        ...provenUiDependency,
        affectedWorkspaces: ["apps/roadmap-web"],
      },
    }));

    expect(result.tier).toBe("T3");
    expect(result.reasons).toContain("dependency_workspace_unresolved");
  });

  test("emits the full fail-closed check vector for T3", () => {
    const result = classifyChange(input(["unknown/file.bin"]));

    expect(result.expectedChecks).toEqual([
      "targeted",
      "dependency-security",
      "affected-build",
      "impacted-integration",
      "security",
      "migration-integrity",
      "db-contract",
    ]);
    expect(result.settleMinutes).toBe(10);
  });
});
