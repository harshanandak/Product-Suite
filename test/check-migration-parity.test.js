import { describe, expect, test } from "bun:test";

import { analyzeMigrationParity } from "../scripts/check-migration-parity.mjs";

function journal(tags) {
  return {
    version: "7",
    dialect: "postgresql",
    entries: tags.map((tag, idx) => ({ idx, version: "7", when: idx, tag, breakpoints: true })),
  };
}

describe("check-migration-parity", () => {
  test("passes when journal entries and .sql files agree", () => {
    const issues = analyzeMigrationParity(journal(["0000_a", "0001_b"]), ["0000_a.sql", "0001_b.sql"]);

    expect(issues).toEqual([]);
  });

  test("flags a journal entry with no matching .sql file", () => {
    const issues = analyzeMigrationParity(journal(["0000_a", "0001_b"]), ["0000_a.sql"]);

    expect(issues).toContain('journal entry "0001_b" (idx 1) has no matching migrations/0001_b.sql');
  });

  test("flags a .sql file with no journal entry", () => {
    const issues = analyzeMigrationParity(journal(["0000_a"]), ["0000_a.sql", "0001_orphan.sql"]);

    expect(issues).toContain("migrations/0001_orphan.sql exists but has no entry in meta/_journal.json");
  });

  test("flags a non-contiguous idx sequence", () => {
    const badJournal = journal(["0000_a", "0001_b"]);
    badJournal.entries[1].idx = 2;

    const issues = analyzeMigrationParity(badJournal, ["0000_a.sql", "0001_b.sql"]);

    expect(issues.some((issue) => issue.includes("not a contiguous 0..N sequence"))).toBe(true);
  });

  test("flags a count mismatch even when every entry has a file", () => {
    // Two journal entries share a tag by mistake, so entries.length (2) still
    // exceeds the deduped .sql file count (1) — count check catches it even
    // though the per-entry file lookup above would not.
    const dupJournal = journal(["0000_a", "0000_a"]);
    dupJournal.entries[1].idx = 1;

    const issues = analyzeMigrationParity(dupJournal, ["0000_a.sql"]);

    expect(issues.some((issue) => issue.includes("does not match .sql file count"))).toBe(true);
  });

  test("reports no issues for the real repo migrations tree", async () => {
    const { readFileSync, readdirSync } = await import("node:fs");
    const { join } = await import("node:path");

    const migrationsDir = join(import.meta.dir, "..", "packages", "db", "migrations");
    const realJournal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8"));
    const realSqlFiles = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));

    expect(analyzeMigrationParity(realJournal, realSqlFiles)).toEqual([]);
  });
});
