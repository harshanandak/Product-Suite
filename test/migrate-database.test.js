import { describe, expect, test } from "bun:test";

import {
  applyMigrations,
  buildMigrationPlan,
  verifyMigrations,
} from "../scripts/migrate-database.mjs";

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
});
