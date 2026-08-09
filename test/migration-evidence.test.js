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
});
