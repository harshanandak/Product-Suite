#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Compares the drizzle journal (packages/db/migrations/meta/_journal.json) —
 * the ordered record of migrations drizzle-kit believes exist — against the
 * .sql files actually present in the migrations directory. Catches the two
 * ways they can drift apart: a journal entry with no matching .sql file
 * (deleted/renamed by hand) or a .sql file with no journal entry (added
 * without `drizzle-kit generate`). Pure function: takes the parsed journal
 * and a list of filenames so it can be unit tested without touching disk.
 */
export function analyzeMigrationParity(journal, sqlFileNames) {
  const issues = [];
  const entries = Array.isArray(journal?.entries) ? journal.entries : [];
  const sqlFiles = new Set(sqlFileNames);

  const sortedIdx = entries.map((entry) => entry.idx).sort((a, b) => a - b);
  for (let expected = 0; expected < sortedIdx.length; expected += 1) {
    if (sortedIdx[expected] !== expected) {
      issues.push(
        `journal entries are not a contiguous 0..N sequence (expected idx ${expected}, found ${sortedIdx[expected]})`,
      );
      break;
    }
  }

  const journalFiles = new Set();
  for (const entry of entries) {
    const fileName = `${entry.tag}.sql`;
    journalFiles.add(fileName);
    if (!sqlFiles.has(fileName)) {
      issues.push(`journal entry "${entry.tag}" (idx ${entry.idx}) has no matching migrations/${fileName}`);
    }
  }

  for (const fileName of sqlFiles) {
    if (!journalFiles.has(fileName)) {
      issues.push(`migrations/${fileName} exists but has no entry in meta/_journal.json`);
    }
  }

  if (entries.length !== sqlFiles.size) {
    issues.push(
      `journal entry count (${entries.length}) does not match .sql file count (${sqlFiles.size}) in migrations/`,
    );
  }

  return issues;
}

function loadAndCheck(migrationsDir) {
  const journalPath = join(migrationsDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const sqlFileNames = readdirSync(migrationsDir).filter((name) => name.endsWith(".sql"));
  return analyzeMigrationParity(journal, sqlFileNames);
}

function runCli(migrationsDir) {
  if (!migrationsDir) {
    console.error("usage: check-migration-parity.mjs <path-to-migrations-dir>");
    process.exitCode = 1;
    return;
  }

  const issues = loadAndCheck(migrationsDir);
  if (issues.length > 0) {
    console.error(`Migration schema-parity check failed for ${migrationsDir}:\n${issues.map((i) => `  - ${i}`).join("\n")}`);
    process.exitCode = 1;
  } else {
    console.log(`Migration schema-parity check passed for ${migrationsDir} (journal and .sql files agree).`);
  }
}

if (import.meta.main) {
  runCli(process.argv[2]);
}
