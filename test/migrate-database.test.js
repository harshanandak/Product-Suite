import { describe, expect, test } from "bun:test";

import {
  applyMigrations,
  buildMigrationPlan,
  verifyMigrations,
} from "../scripts/migrate-database.mjs";
import { provisionDatabaseRoles } from "../scripts/provision-database-roles.mjs";

const files = [
  { tag: "0018", hash: "h18", timestamp: 18 },
  { tag: "0019", hash: "h19", timestamp: 19 },
  { tag: "0020", hash: "h20", timestamp: 20 },
];

const authority = { environment: "staging", historyVariant: "repaired-bootstrap" };

describe("canonical migration runner", () => {
  test("plans an exact contiguous suffix and rejects reordered extras", () => {
    expect(buildMigrationPlan({ applied: ["0019"], declared: ["0020"], files, authority })).toMatchObject({
      ok: true,
      pending: ["0020"],
    });
    expect(buildMigrationPlan({ applied: ["0019"], declared: ["0020", "0018"], files, authority }).ok).toBe(false);
  });

  test("rejects environment/flag mismatch and P0 non-allowlisted suffix", () => {
    expect(buildMigrationPlan({ applied: ["0019"], declared: ["0020"], files, authority: { environment: "production", historyVariant: "repaired-bootstrap" } }).ok).toBe(false);
    expect(buildMigrationPlan({ applied: ["0017"], declared: ["0020"], files, authority: { environment: "production", historyVariant: "original-production" } }).ok).toBe(false);
  });

  test("verify emits NOOP without writes at the expected floor", async () => {
    const calls = [];
    const result = await verifyMigrations({
      adapter: { query: async (sql) => { calls.push(sql); return { rows: [{ tag: "0019", hash: "h19" }] }; } },
      applied: ["0019"], files, expectedFloor: "0019", declared: [], authority,
    });
    expect(result).toMatchObject({ ok: true, status: "NOOP" });
    expect(calls).toHaveLength(0);
  });

  test("apply rereads under an advisory lock before executing", async () => {
    const calls = [];
    const result = await applyMigrations({
      adapter: { query: async (sql) => { calls.push(sql); return { rows: [] }; } },
      applied: ["0019"], files, declared: ["0020"], authority,
    });
    expect(result.ok).toBe(true);
    expect(calls.join("\n")).toContain("pg_advisory_xact_lock");
  });

  test.each([
    ["repaired bootstrap", { environment: "test", historyVariant: "repaired-bootstrap" }],
    ["test-only original conformance", { environment: "conformance-original", historyVariant: "original-production" }],
  ])("provisions roles before applying synthetic 0020 then verifies NOOP for %s", async (_label, variantAuthority) => {
    const calls = [];
    const adapter = { query: async (sql) => { calls.push(sql); return { rows: [] }; } };

    const provisioned = await provisionDatabaseRoles({
      adapter,
      databaseUrl: "postgresql://owner:secret@ep-test.us-east-2.aws.neon.tech/neondb?sslmode=require",
      environment: variantAuthority.environment,
    });
    const applied = await applyMigrations({
      adapter,
      applied: ["0019"],
      files,
      declared: ["0020"],
      authority: variantAuthority,
    });
    const noop = await verifyMigrations({
      adapter,
      applied: ["0019", "0020"],
      files,
      declared: [],
      expectedFloor: "0020",
      authority: variantAuthority,
    });

    expect(provisioned.ok).toBe(true);
    expect(applied).toMatchObject({ ok: true, status: "APPLIED", historyVariant: variantAuthority.historyVariant });
    expect(noop).toMatchObject({ ok: true, status: "NOOP" });
    expect(calls.findIndex((sql) => sql.includes("product-suite:database-roles"))).toBeLessThan(
      calls.findIndex((sql) => sql.includes("product-suite:database-migrations")),
    );
  });
});
