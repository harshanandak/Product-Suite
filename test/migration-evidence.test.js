import { describe, expect, test } from "bun:test";

import {
  redactEvidence,
  createMigrationEvidence,
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
      historyVariant: "original-production",
      expectedFloor: "0017",
      expectedCount: 18,
      applied: Array.from({ length: 18 }, (_, index) => ({ tag: String(index).padStart(4, "0"), timestamp: index, hash })),
      pending: [{ tag: "0018", hash }, { tag: "0019", hash }],
      loginIdentifier: "product_suite_neon_preflight_reader",
      grantContract: "product-suite-neon-preflight-reader-v1",
      grantContractSha256: hash,
      catalogDigest: hash,
      grantDigest: hash,
      aggregateRowCounts: [{ metric: "drizzle_migration_rows", count: 18 }],
      url: "postgresql://owner:secret@example.invalid/neondb",
      sql: "DELETE FROM users",
      rows: [{ email: "person@example.com" }],
    });

    expect(verifyMigrationEvidence(evidence)).toMatchObject({ ok: true, status: "PREFLIGHT_READY" });
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
      pending: [{ tag: "0018", hash: "a".repeat(64) }, { tag: "0019", hash: "a".repeat(64) }],
      loginIdentifier: "product_suite_neon_preflight_reader",
      grantContract: "product-suite-neon-preflight-reader-v1",
      grantContractSha256: "a".repeat(64), catalogDigest: "a".repeat(64), grantDigest: "a".repeat(64),
    };
    expect(verifyMigrationEvidence({ ...base, unexpected: "value" })).toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
    expect(verifyMigrationEvidence({ ...base, recoveryId: "postgresql://secret" })).toMatchObject({ ok: false, code: "EVIDENCE_INVALID" });
  });
});
