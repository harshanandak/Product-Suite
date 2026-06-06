import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const cutoverRunbookPath = join(rootDir, "docs", "deployment", "MEETING_SUPABASE_CUTOVER.md");

describe("Meeting Supabase cutover runbook", () => {
  test("documents connection-string purpose mapping", () => {
    expect(existsSync(cutoverRunbookPath)).toBe(true);

    const runbook = readFileSync(cutoverRunbookPath, "utf8");

    for (const requiredTerm of [
      "Direct connection",
      "Session pooler",
      "Transaction pooler",
      "migrations, backups, dumps, and restores",
      "persistent Meeting API runtime",
      "transient or serverless clients",
      "prepared statements",
    ]) {
      expect(runbook).toContain(requiredTerm);
    }
  });

  test("documents preflight, rollback, and Neon retirement gates", () => {
    expect(existsSync(cutoverRunbookPath)).toBe(true);

    const runbook = readFileSync(cutoverRunbookPath, "utf8");

    for (const requiredTerm of [
      "bun run preflight:meeting-cutover",
      "NEON_DATABASE_URL",
      "SUPABASE_DATABASE_URL",
      "PR20_APPROVED_DATA_MIGRATION=1",
      "Rollback",
      "set Meeting API DATABASE_URL back to the Neon connection string",
      "keep Neon available until Meeting create/read smoke tests pass against Supabase",
    ]) {
      expect(runbook).toContain(requiredTerm);
    }
  });
});
