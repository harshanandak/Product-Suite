import { describe, expect, test } from "bun:test";

import {
  redactEvidence,
  createMigrationEvidence,
  createPreflightFailureEvidence,
  verifyMigrationEvidence,
} from "../scripts/migration-evidence.mjs";

describe("migration evidence", () => {
  test("redacts URLs, credentials, SQL and row payloads", () => {
    const evidence = redactEvidence({
      url: "postgresql://user:secret@ep-test.us-east-2.aws.neon.tech/neondb",
      password: "secret",
      sql: "ALTER TABLE users ADD COLUMN x text",
      rows: [{ email: "person@example.com" }],
      tag: "0019",
      hash: "abc",
    });
    expect(JSON.stringify(evidence)).not.toContain("postgresql://");
    expect(JSON.stringify(evidence)).not.toContain("secret");
    expect(JSON.stringify(evidence)).not.toContain("ALTER TABLE");
    expect(JSON.stringify(evidence)).not.toContain("person@example.com");
    expect(evidence).toMatchObject({ tag: "0019", hash: "abc" });
  });

  test.each([
    "postgres://reader@example.invalid/neondb",
    "https://example.invalid/proof",
    "password = exposed",
    "BEGIN",
    "ALTER TABLE users ADD COLUMN x text",
    "CREATE TABLE leaked(id int)",
    "INSERT INTO leaked VALUES (1)",
    "UPDATE leaked SET id = 2",
    "DELETE FROM leaked",
    "DROP TABLE leaked",
  ])("rejects forbidden evidence text after regex decomposition: %s", (value) => {
    expect(redactEvidence({ recoveryId: value })).toEqual({});
  });

  test("accepts a reconstructable exact-SHA evidence record", () => {
    const evidence = createMigrationEvidence({
      operation: "verify", historyVariant: "repaired-bootstrap", expectedFloor: "0019",
      applied: [{ tag: "0019", timestamp: 19, hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], status: "NOOP",
    });
    expect(verifyMigrationEvidence(evidence)).toMatchObject({ ok: true, status: "NOOP" });
  });

  test("accepts the full Drizzle tag for a numeric expected floor", () => {
    const evidence = createMigrationEvidence({
      operation: "verify", historyVariant: "repaired-bootstrap", expectedFloor: "0019",
      applied: [{ tag: "0019_neon_authority_reconciliation", timestamp: 19, hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], status: "NOOP",
    });
    expect(verifyMigrationEvidence(evidence)).toMatchObject({ ok: true, status: "NOOP" });
  });

  test("rejects evidence with missing or mismatched hash/count", () => {
    expect(verifyMigrationEvidence({ status: "NOOP", historyVariant: "repaired-bootstrap", applied: [{ tag: "0019" }] }).ok).toBe(false);
    expect(verifyMigrationEvidence({ status: "APPLIED", historyVariant: "repaired-bootstrap", applied: [{ tag: "0019", timestamp: 19, hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], expectedCount: 2 }).ok).toBe(false);
  });

  test("rejects URL-shaped migration tags even when the hash is valid", () => {
    const evidence = createMigrationEvidence({
      operation: "verify", historyVariant: "repaired-bootstrap", expectedFloor: "0019",
      applied: [{ tag: "0019_https://evil.example", timestamp: 19, hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }], status: "NOOP",
    });

    expect(verifyMigrationEvidence(evidence)).toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
  });

  test("accepts only allowlisted redacted production-preflight evidence", () => {
    const hash = "a".repeat(64);
    const evidence = createMigrationEvidence({
      schemaVersion: "neon-production-preflight-evidence.v1",
      operation: "verify",
      status: "PREFLIGHT_READY",
      reasonCodes: ["PREFLIGHT_READY"],
      repository: "befach/product-suite",
      runId: "123",
      runSha: "b".repeat(40),
      projectId: "project-test", branchId: "branch-test", endpointId: "endpoint-test", database: "neondb", schema: "public",
      proofSource: "independently-signed-export", sourceImmutableSha256: hash, sourceProducedAt: "2026-08-10T09:00:00.000Z",
      attestationBlobId: "c".repeat(40), attestationFileSha256: hash, attestationCanonicalPayloadSha256: hash,
      signatureKeyId: "test-key-v1", recoveryKind: "branch", recoveryId: "recovery-test", recoverySourceBranchId: "branch-test",
      observedAt: "2026-08-10T10:00:00.000Z", expiresAt: "2026-08-11T09:00:00.000Z",
      historyVariant: "original-production",
      expectedFloor: "0017",
      expectedCount: 18,
      applied: Array.from({ length: 18 }, (_, index) => ({ tag: String(index).padStart(4, "0"), timestamp: index, hash })),
      pending: [{ tag: "0018", hash }, { tag: "0019", hash }, { tag: "0020", hash }],
      loginIdentifier: "product_suite_neon_preflight_reader",
      grantContract: "product-suite-neon-preflight-reader-v1",
      grantContractSha256: hash,
      catalogDigest: hash,
      grantDigest: hash,
      reasonCodes: ["PREFLIGHT_READY"],
      aggregateRowCounts: [{ metric: "drizzle_migration_rows", count: 18 }],
      url: "postgresql://owner:secret@example.invalid/neondb",
      sql: "DELETE FROM users",
      rows: [{ email: "person@example.com" }],
    });

    expect(verifyMigrationEvidence(evidence)).toMatchObject({ ok: true, status: "PREFLIGHT_READY" });
    expect(verifyMigrationEvidence({ ...evidence, pending: evidence.pending.slice(0, 2) }))
      .toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("postgresql://");
    expect(serialized).not.toContain("DELETE FROM");
    expect(serialized).not.toContain("person@example.com");
  });

  test("rejects preflight evidence with unknown keys or secret-shaped nested values", () => {
    const base = {
      schemaVersion: "neon-production-preflight-evidence.v1",
      operation: "verify", status: "PREFLIGHT_READY", historyVariant: "original-production",
      expectedFloor: "0017", expectedCount: 18,
      applied: Array.from({ length: 18 }, (_, index) => ({ tag: String(index).padStart(4, "0"), timestamp: index, hash: "a".repeat(64) })),
      pending: [{ tag: "0018", hash: "a".repeat(64) }, { tag: "0019", hash: "a".repeat(64) }, { tag: "0020", hash: "a".repeat(64) }],
      loginIdentifier: "product_suite_neon_preflight_reader",
      grantContract: "product-suite-neon-preflight-reader-v1",
      grantContractSha256: "a".repeat(64), catalogDigest: "a".repeat(64), grantDigest: "a".repeat(64),
    };
    expect(verifyMigrationEvidence({ ...base, unexpected: "value" })).toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
    expect(verifyMigrationEvidence({ ...base, recoveryId: "postgresql://secret" })).toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
  });

  test("creates a validated allowlisted FAIL artifact without driver details", () => {
    const evidence = createPreflightFailureEvidence({
      code: "PREFLIGHT_ATTESTATION_UNCONFIGURED",
      repository: "befach/product-suite", runId: "123", runSha: "a".repeat(40),
      error: "postgresql://reader:secret@example.invalid/neondb",
    });
    expect(evidence).toMatchObject({ ok: false, status: "FAIL", code: "PREFLIGHT_ATTESTATION_UNCONFIGURED" });
    expect(verifyMigrationEvidence(evidence)).toMatchObject({ ok: false, status: "FAIL" });
    expect(JSON.stringify(evidence)).not.toContain("postgresql://");
    expect(JSON.stringify(evidence)).not.toContain("secret");
  });

  test.each([
    ["FAIL", true],
    ["INCOMPLETE", true],
    ["NOOP", false],
  ])("rejects inconsistent status/ok: %s/%s", (status, ok) => {
    const evidence = createMigrationEvidence({
      operation: "verify", historyVariant: "repaired-bootstrap", status,
      applied: [],
    });
    expect(verifyMigrationEvidence({ ...evidence, ok })).toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
  });

  test("rejects unsupported PASS evidence instead of treating it as a preflight proof", () => {
    expect(verifyMigrationEvidence({
      operation: "verify", historyVariant: "repaired-bootstrap", status: "PASS", ok: true, applied: [],
    })).toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
  });
});
