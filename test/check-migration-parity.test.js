import { execFileSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import { analyzeMigrationParity, validateMigrationHistory } from "../scripts/check-migration-parity.mjs";

const SCRIPT_PATH = join(import.meta.dir, "..", "scripts", "check-migration-parity.mjs");
const REAL_MIGRATIONS_DIR = join(import.meta.dir, "..", "packages", "db", "migrations");

/** Runs the CLI in a real `node` subprocess (not Bun) so the entrypoint guard
 * itself — not just the pure `analyzeMigrationParity` function — is covered
 * under the exact runtime the deploy workflow and package.json invoke it
 * with. Returns stdout/stderr/status instead of throwing on a non-zero exit,
 * since a non-zero exit is an expected outcome for some of these tests. */
function runCli(args) {
  try {
    const stdout = execFileSync("node", [SCRIPT_PATH, ...args], { encoding: "utf8" });
    return { status: 0, stdout, stderr: "" };
  } catch (err) {
    return { status: err.status, stdout: err.stdout ?? "", stderr: err.stderr ?? "" };
  }
}

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

  test("passes when journal entries are declared in ascending idx order", () => {
    const issues = analyzeMigrationParity(journal(["0000_a", "0001_b", "0002_c"]), [
      "0000_a.sql",
      "0001_b.sql",
      "0002_c.sql",
    ]);

    expect(issues).toEqual([]);
  });

  test("flags entries declared out of array order, naming the first one", () => {
    // Swapped idx values still form a valid 0..N set, so the contiguity check
    // below sees nothing — only declaration order reveals the swap.
    const swapped = journal(["0000_a", "0001_b", "0002_c"]);
    swapped.entries[1].idx = 2;
    swapped.entries[2].idx = 1;

    const issues = analyzeMigrationParity(swapped, ["0000_a.sql", "0001_b.sql", "0002_c.sql"]);

    expect(issues).toContain(
      'journal entry "0002_c" (idx 1) is out of array order: it is declared after "0001_b" (idx 2)',
    );
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

  describe("CLI entrypoint (real `node` subprocess)", () => {
    test("runs and passes when invoked directly with `node`", () => {
      const { status, stdout } = runCli([REAL_MIGRATIONS_DIR]);

      expect(status).toBe(0);
      expect(stdout).toContain("Migration schema-parity check passed");
    });

    test("exits non-zero with a usage message when no path is given", () => {
      const { status, stderr } = runCli([]);

      expect(status).not.toBe(0);
      expect(stderr).toContain("usage: check-migration-parity.mjs");
    });

    test("exits non-zero when the path resolves outside the expected tree", () => {
      const { status, stderr } = runCli([join(import.meta.dir, "..", "scripts")]);

      expect(status).not.toBe(0);
      expect(stderr).toContain("outside the expected migrations tree");
    });

    test("exits non-zero when a manifest-pinned snapshot is changed", () => {
      const fixture = mkdtempSync(join(REAL_MIGRATIONS_DIR, ".parity-test-"));
      try {
        for (const file of readdirSync(REAL_MIGRATIONS_DIR).filter((name) => name.endsWith(".sql"))) {
          copyFileSync(join(REAL_MIGRATIONS_DIR, file), join(fixture, file));
        }
        cpSync(join(REAL_MIGRATIONS_DIR, "meta"), join(fixture, "meta"), { recursive: true });
        const snapshot = join(fixture, "meta", "0011_snapshot.json");
        writeFileSync(snapshot, `${readFileSync(snapshot, "utf8")}\n`);

        const { status, stderr } = runCli([fixture]);

        expect(status).not.toBe(0);
        expect(stderr).toContain("snapshot hash");
      } finally {
        rmSync(fixture, { recursive: true, force: true });
      }
    });
  });

  describe("history variants", () => {
    const base = {
      journal: journal(["0000_stale_jamie_braddock", "0001_dear_the_enforcers", "0002_polite_orphan", "0003_tranquil_tattoo", "0004_minor_lockheed"]),
      hashes: {
        "0000_stale_jamie_braddock.sql": "original-0000",
        "0001_dear_the_enforcers.sql": "immutable-0001",
        "0002_polite_orphan.sql": "immutable-0002",
        "0003_tranquil_tattoo.sql": "immutable-0003",
        "0004_minor_lockheed.sql": "original-0004",
      },
    };

    test("accepts original-production and repaired-bootstrap as complete variants", () => {
      expect(validateMigrationHistory({ ...base, historyVariant: "original-production" }).ok).toBe(true);
      expect(validateMigrationHistory({
        ...base,
        historyVariant: "repaired-bootstrap",
        hashes: { ...base.hashes, "0000_stale_jamie_braddock.sql": "repaired-0000", "0004_minor_lockheed.sql": "repaired-0004" },
      }).ok).toBe(true);
    });

    test("rejects mixed and unknown hash variants", () => {
      expect(validateMigrationHistory({ ...base, historyVariant: "original-production", hashes: { ...base.hashes, "0004_minor_lockheed.sql": "repaired-0004" } })).toMatchObject({ ok: false, code: "HISTORY_VARIANT_MIXED" });
      expect(validateMigrationHistory({ ...base, historyVariant: "original-production", hashes: { ...base.hashes, "0000_stale_jamie_braddock.sql": "fabricated" } })).toMatchObject({ ok: false, code: "HISTORY_HASH_UNKNOWN" });
    });

    test("rejects fabricated snapshot hashes instead of treating them as a prefix", () => {
      expect(validateMigrationHistory({ ...base, historyVariant: "original-production", snapshotHashes: { "0011_snapshot.json": "fabricated" } })).toMatchObject({ ok: false, code: "SNAPSHOT_HASH_UNKNOWN" });
    });
  });
});
