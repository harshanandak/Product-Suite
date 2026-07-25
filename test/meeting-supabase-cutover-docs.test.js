import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const rootDir = join(import.meta.dir, "..");
const cutoverRunbookPath = join(rootDir, "docs", "deployment", "MEETING_SUPABASE_CUTOVER.md");

const REVERSE_HEADING = "# Reverse Cutover: Supabase → Neon";

/**
 * Splits the runbook at the reverse-cutover heading. Reverse-direction
 * assertions are scoped to the reverse half: a term that only ever appears in
 * the forward sections must not be able to satisfy them.
 */
function readRunbookSections() {
  const runbook = readFileSync(cutoverRunbookPath, "utf8");
  const splitAt = runbook.indexOf(REVERSE_HEADING);
  expect(splitAt).toBeGreaterThan(-1);

  return {
    runbook,
    forward: runbook.slice(0, splitAt),
    reverse: runbook.slice(splitAt),
  };
}

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

    const { forward } = readRunbookSections();

    for (const requiredTerm of [
      "bun run preflight:meeting-cutover",
      // Vendor-neutral connection slots — the same variables serve either
      // direction, so the forward section names the vendors separately.
      "MEETING_PREFLIGHT_SOURCE_DATABASE_URL",
      "MEETING_PREFLIGHT_TARGET_DATABASE_URL",
      "MEETING_PREFLIGHT_SOURCE_PROVIDER=neon",
      "MEETING_PREFLIGHT_TARGET_PROVIDER=supabase",
      "PR20_APPROVED_DATA_MIGRATION=1",
      "Rollback",
      "set Meeting API DATABASE_URL back to the Neon connection string",
      "keep Neon available until Meeting create/read smoke tests pass against Supabase",
    ]) {
      expect(forward).toContain(requiredTerm);
    }
  });

  test("documents the reverse direction: Supabase source -> Neon target", () => {
    const { reverse } = readRunbookSections();

    for (const requiredTerm of [
      // The preflight command and the env vars that reverse its direction.
      "MEETING_PREFLIGHT_SOURCE_SCHEMA=meeting",
      "MEETING_PREFLIGHT_TARGET_SCHEMA=meeting",
      // The vendor labels must reverse too, or the archived evidence names the
      // wrong vendor on each side.
      "MEETING_PREFLIGHT_SOURCE_PROVIDER=supabase",
      "MEETING_PREFLIGHT_TARGET_PROVIDER=neon",
      "MEETING_TARGET_SMOKE_DATABASE_URL",
      // Cutover order, rollback, and the retirement criteria — now with
      // Supabase as the thing being retired.
      "Reverse Cutover Order",
      "Reverse Rollback",
      "set Meeting API DATABASE_URL back to the Supabase connection string",
      "Supabase Retirement Criteria",
      "Meeting create/read smoke tests pass against Neon",
    ]) {
      expect(reverse).toContain(requiredTerm);
    }
  });

  test("never instructs setting the approval flag to bypass the fail-closed gate", () => {
    const { runbook, reverse } = readRunbookSections();

    // The flag is documented as an ASSERTION that backup/restore proof exists,
    // never as the way to turn a red preflight green.
    expect(runbook).toContain(
      "Do not set `PR20_APPROVED_DATA_MIGRATION=1` just to bypass the gate.",
    );
    expect(runbook).toContain(
      "Never set it to make a red preflight go green — record the backup evidence first.",
    );
    // And the warning is repeated in the reverse half, where an operator
    // following only the reverse runbook would otherwise never see it.
    expect(reverse).toContain(
      "Never set it to make a red preflight go green — record the backup evidence first.",
    );
    expect(runbook).toContain(
      "a fail-closed result when source data exists without approved migration evidence",
    );
  });
});
