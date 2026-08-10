import { describe, expect, test } from "bun:test";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";

import {
  canonicalPreflightPayload,
  grantContractDigest,
  resolveGitExecutable,
  verifyProductionPreflightAttestation,
} from "../scripts/migrate-database.mjs";

const root = join(import.meta.dir, "..");
const pathFor = (path) => join(root, path);
const read = (path) => readFileSync(pathFor(path), "utf8");
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const blobId = (value) => execFileSync("git", ["hash-object", "--stdin"], {
  input: value,
  encoding: "utf8",
  windowsHide: true,
}).trim();
const fixedCommand = "bun run migrate:database -- verify --environment production --history-variant original-production --expected-floor 0017";

function workflowContractIssues(workflow) {
  const issues = [];
  const checkoutIndex = workflow.indexOf("name: Check out exact reviewed SHA");
  const failureInitIndex = workflow.indexOf("name: Initialize redacted failure evidence");
  const mainGuardIndex = workflow.indexOf("name: Prove exact current main SHA");
  const beforeMainGuard = workflow.slice(Math.max(0, checkoutIndex), Math.max(0, mainGuardIndex));
  if (!workflow.includes("workflow_dispatch:")) issues.push("manual trigger missing");
  if (/(?:^|\n)\s*(?:push|schedule|workflow_run|repository_dispatch|workflow_call):/m.test(workflow)) issues.push("automatic trigger present");
  if (!workflow.includes("environment: db-preflight-production")) issues.push("environment mismatch");
  if (!workflow.includes("permissions:\n  contents: read") || /id-token:\s*write|packages:\s*write|deployments:\s*write/.test(workflow)) issues.push("permissions broadened");
  if (!workflow.includes("persist-credentials: false")) issues.push("credentials persisted");
  if (!workflow.includes(fixedCommand) || (workflow.match(/migrate:database/g) ?? []).length !== 1) issues.push("command changed");
  if ((workflow.match(/MIGRATION_DATABASE_URL:/g) ?? []).length !== 1) issues.push("secret scope changed");
  if (/provision:database-roles|migrate:database -- (?:apply|bootstrap)|wrangler|NEON_API_KEY/.test(workflow)) issues.push("forbidden authority present");
  if (!workflow.includes("timeout-minutes: 15") || !workflow.includes("cancel-in-progress: true")) issues.push("bounded execution missing");
  if (/^\s*if:\s*github\.ref\s*==\s*'refs\/heads\/main'/m.test(workflow)) issues.push("non-main dispatch skips instead of failing");
  if (!workflow.includes('[[ "${GITHUB_REF}" == "refs/heads/main" ]]')) issues.push("non-main fail check missing");
  if (!workflow.includes("PREFLIGHT_ATTESTATION_BLOB_ID: ${{ steps.attestation.outputs.blob_id }}")) issues.push("attestation blob provenance not persisted");
  if (workflow.includes("preflightFileBlobId ?? gitBlobId(fileBytes)")) issues.push("self-hash provenance tautology");
  if (!workflow.includes("if-no-files-found: warn")) issues.push("missing artifact can fail upload");
  if (!workflow.includes("if: always()")) issues.push("failure artifact is not always uploaded");
  if (checkoutIndex < 0 || mainGuardIndex <= checkoutIndex) issues.push("exact-main guard order missing");
  if (failureInitIndex <= checkoutIndex || failureInitIndex >= mainGuardIndex || !beforeMainGuard.includes('status: "FAIL"') || !beforeMainGuard.includes('code: "PREFLIGHT_RUN_INCOMPLETE"')) issues.push("safe pre-guard failure artifact missing");
  if (/from\s+["']\.\//.test(beforeMainGuard) || /\b(?:bun|npm|pnpm|yarn)\s+(?:run|install|exec)\b/.test(beforeMainGuard) || /\b(?:node|bash|sh|python3?)\s+\.\.?[\\/]/.test(beforeMainGuard) || /^\s*\.\.?[\\/]/m.test(beforeMainGuard)) issues.push("repository code executes before exact-main guard");
  return issues;
}

function signedFixture(overrides = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyId = "product-suite-preflight-reviewer-test-v1";
  const attestation = {
    configured: true,
    schemaVersion: "neon-production-preflight-attestation.v1",
    target: {
      projectId: "project-test-123", productionBranchId: "branch-test-123",
      endpointId: "endpoint-test-123", database: "neondb", schema: "public",
    },
    role: {
      loginIdentifier: "product_suite_neon_preflight_reader",
      grantContract: "product-suite-neon-preflight-reader-v1",
      grantContractSha256: grantContractDigest(),
    },
    catalog: { catalogSha256: "b".repeat(64) },
    recovery: {
      kind: "branch", id: "recovery-test-123", projectId: "project-test-123",
      sourceBranchId: "branch-test-123", createdAt: "2026-08-10T09:00:00.000Z", expiresAt: "2026-08-11T09:00:00.000Z",
    },
    source: {
      kind: "independently-signed-export", immutableSourceSha256: "c".repeat(64), producedAt: "2026-08-10T09:00:00.000Z",
    },
    validity: { notBefore: "2026-08-10T09:00:00.000Z", expiresAt: "2026-08-11T09:00:00.000Z" },
    ...overrides,
  };
  const payload = canonicalPreflightPayload(attestation);
  attestation.signature = {
    algorithm: "Ed25519", keyId,
    canonicalPayloadSha256: sha256(payload),
    value: sign(null, Buffer.from(payload), privateKey).toString("base64"),
  };
  const trust = {
    schemaVersion: "neon-production-preflight-trust.v1",
    keys: [{ keyId, algorithm: "Ed25519", publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) }],
  };
  const fileBytes = `${JSON.stringify(attestation, null, 2)}\n`;
  return { attestation, trust, fileBytes };
}

describe("protected Neon production preflight workflow", () => {
  test("requires the schema, trust contract, unconfigured checked-in template, and isolated workflow", () => {
    for (const path of [
      "config/neon-production-preflight-attestation.schema.json",
      "config/neon-production-preflight-attestation.json",
      "config/neon-production-preflight-trust.json",
      ".github/workflows/neon-production-preflight.yml",
    ]) expect(existsSync(pathFor(path))).toBe(true);

    const workflow = read(".github/workflows/neon-production-preflight.yml");
    const migrationScript = read("scripts/migrate-database.mjs");
    const attestation = JSON.parse(read("config/neon-production-preflight-attestation.json"));
    const schema = JSON.parse(read("config/neon-production-preflight-attestation.schema.json"));
    const grantContract = JSON.parse(read("config/neon-production-preflight-grants.json"));
    expect(attestation).toMatchObject({ configured: false, schemaVersion: "neon-production-preflight-attestation.v1" });
    expect(new Ajv({ allErrors: true }).validate(schema, attestation)).toBe(true);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).not.toMatch(/(?:push|schedule|workflow_run|repository_dispatch|workflow_call):/);
    expect(workflow).toContain("environment: db-preflight-production");
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain("refs/heads/main");
    expect(workflow).toContain("git fetch --no-tags origin main");
    expect(workflow).toContain("bun install --frozen-lockfile --ignore-scripts");
    expect(workflow).toContain(fixedCommand);
    expect(workflow.match(/MIGRATION_DATABASE_URL:/g)).toHaveLength(1);
    expect(workflow).not.toMatch(/provision:database-roles|migrate:database -- (?:apply|bootstrap)|wrangler|cloudflare|NEON_API_KEY|workflow_dispatch.*token/is);
    expect(workflow).toContain("actions/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f");
    expect(workflow).toContain("retention-days: 7");
    expect(workflowContractIssues(workflow)).toEqual([]);
    expect(read(".github/workflows/platform-api-deploy.yml")).not.toMatch(/neon-production-preflight|db-preflight-production/);
    const hasNegative = (source, objectKind, privilege) => grantContract.negativePrivileges.some((fact) =>
      fact.source === source && fact.objectKind === objectKind && fact.privilege === privilege && fact.granted === false,
    );
    for (const source of ["effective", "direct", "inherited", "PUBLIC", "built-in-default-role", "default-acl"]) {
      for (const privilege of ["INSERT", "UPDATE", "DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) expect(hasNegative(source, "table", privilege)).toBe(true);
      for (const privilege of ["USAGE", "UPDATE", "SELECT"]) expect(hasNegative(source, "sequence", privilege)).toBe(true);
    }
    for (const source of ["effective", "direct", "inherited", "PUBLIC", "built-in-default-role", "default-acl"]) {
      expect(hasNegative(source, "database", "CREATE")).toBe(true);
      expect(hasNegative(source, "schema", "CREATE")).toBe(true);
    }
    expect(workflow).not.toContain("if: github.ref == 'refs/heads/main'");
    expect(migrationScript).toContain("has_database_privilege");
    expect(migrationScript).not.toContain("preflightFileBlobId ?? gitBlobId(fileBytes)");
    expect(migrationScript).not.toContain("error?.message ||");
    expect(migrationScript).toContain('execFileSync(gitExecutable, ["hash-object", "--stdin"]');
    expect(migrationScript).not.toContain('execFileSync("git"');
    expect(migrationScript).not.toContain('createHash("sha1")');
    expect(migrationScript.match(/\.sort\(lexicalCompare\)/g)?.length).toBeGreaterThanOrEqual(4);
  });

  test("resolves Git only from fixed platform allowlists and fails closed", () => {
    const windowsBin = "C:\\Program Files\\Git\\bin\\git.exe";
    expect(resolveGitExecutable({ platform: "win32", fileExists: (path) => path === windowsBin })).toBe(windowsBin);
    expect(resolveGitExecutable({ platform: "linux", fileExists: (path) => path === "/usr/bin/git" })).toBe("/usr/bin/git");
    expect(resolveGitExecutable({ platform: "darwin", fileExists: (path) => path === "/opt/homebrew/bin/git" })).toBe("/opt/homebrew/bin/git");
    expect(resolveGitExecutable({ platform: "linux", fileExists: () => false })).toBeNull();
    expect(resolveGitExecutable({ platform: "freebsd", fileExists: () => true })).toBeNull();
  });

  test.each([
    ["automatic trigger", (workflow) => workflow.replace("workflow_dispatch:", "push:\n  workflow_dispatch:")],
    ["broader permission", (workflow) => workflow.replace("contents: read", "contents: read\n  id-token: write")],
    ["persisted credentials", (workflow) => workflow.replace("persist-credentials: false", "persist-credentials: true")],
    ["apply command", (workflow) => workflow.replace("migrate:database -- verify", "migrate:database -- apply")],
    ["job-scoped duplicate secret", (workflow) => workflow.replace("jobs:\n", "jobs:\n  env:\n    MIGRATION_DATABASE_URL: forbidden\n")],
    ["provisioning", (workflow) => `${workflow}\n# provision:database-roles`],
    ["pre-guard repository script", (workflow) => workflow.replace("      - name: Prove exact current main SHA", "      - name: Unsafe repository script\n        run: node ./scripts/migrate-database.mjs\n\n      - name: Prove exact current main SHA")],
  ])("rejects workflow mutation: %s", (_label, mutate) => {
    expect(workflowContractIssues(mutate(read(".github/workflows/neon-production-preflight.yml"))).length).toBeGreaterThan(0);
  });

  test("verifies a fresh trusted Ed25519 attestation and binds file/blob/run context", () => {
    const fixture = signedFixture();
    const fileBytes = fixture.fileBytes.replace(/\n/g, "\r\n");
    expect(verifyProductionPreflightAttestation({
      ...fixture, fileBytes,
      fileBlobId: blobId(fileBytes),
      runSha: "d".repeat(40),
      repository: "befach/product-suite",
      now: new Date("2026-08-10T10:00:00.000Z"),
    })).toMatchObject({ ok: true, runSha: "d".repeat(40), attestationFileSha256: sha256(fileBytes) });
  });

  test.each([
    ["unconfigured", (fixture) => ({ ...fixture, attestation: { ...fixture.attestation, configured: false } }), "PREFLIGHT_ATTESTATION_UNCONFIGURED"],
    ["stale", (fixture) => fixture, "PREFLIGHT_ATTESTATION_STALE", new Date("2026-08-12T10:00:00.000Z")],
    ["forged", (fixture) => ({ ...fixture, attestation: { ...fixture.attestation, target: { ...fixture.attestation.target, endpointId: "forged" } } }), "PREFLIGHT_ATTESTATION_SIGNATURE_INVALID"],
    ["untrusted key", (fixture) => ({ ...fixture, trust: { ...fixture.trust, keys: [] } }), "PREFLIGHT_ATTESTATION_KEY_UNTRUSTED"],
    ["blob mismatch", (fixture) => ({ ...fixture, fileBlobId: "0".repeat(40) }), "PREFLIGHT_ATTESTATION_BLOB_MISMATCH"],
  ])("fails closed for %s attestation input", (_label, mutate, code, now = new Date("2026-08-10T10:00:00.000Z")) => {
    const fixture = signedFixture();
    const input = mutate(fixture);
    expect(verifyProductionPreflightAttestation({
      ...fixture, ...input,
      fileBlobId: input.fileBlobId ?? blobId(fixture.fileBytes),
      runSha: "d".repeat(40), repository: "befach/product-suite", now,
    })).toEqual({ ok: false, code });
  });
});
