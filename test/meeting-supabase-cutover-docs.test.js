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

  test("documents the reverse direction: Supabase source -> Neon target", () => {
    const runbook = readFileSync(cutoverRunbookPath, "utf8");

    for (const requiredTerm of [
      // The preflight command and the env vars that reverse its direction.
      "MEETING_PREFLIGHT_SOURCE_SCHEMA=meeting",
      "MEETING_PREFLIGHT_TARGET_SCHEMA=meeting",
      "MEETING_TARGET_SMOKE_DATABASE_URL",
      // Cutover order, rollback, and the retirement criteria — now with
      // Supabase as the thing being retired.
      "Reverse Cutover Order",
      "Reverse Rollback",
      "set Meeting API DATABASE_URL back to the Supabase connection string",
      "Supabase Retirement Criteria",
      "Meeting create/read smoke tests pass against Neon",
    ]) {
      expect(runbook).toContain(requiredTerm);
    }
  });

  test("never instructs setting the approval flag to bypass the fail-closed gate", () => {
    const runbook = readFileSync(cutoverRunbookPath, "utf8");

    // The flag is documented as an ASSERTION that backup/restore proof exists,
    // never as the way to turn a red preflight green.
    expect(runbook).toContain(
      "Do not set `PR20_APPROVED_DATA_MIGRATION=1` just to bypass the gate.",
    );
    expect(runbook).toContain(
      "Never set it to make a red preflight go green — record the backup evidence first.",
    );
    expect(runbook).toContain(
      "a fail-closed result when source data exists without approved migration evidence",
    );
  });
});
