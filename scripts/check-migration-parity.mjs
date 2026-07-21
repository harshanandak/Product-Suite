#!/usr/bin/env node
import { readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Anchored to this script's own location (repo-root/scripts/...) rather than
// process.cwd(), so it doesn't matter where the CLI is invoked from — the
// only migrations tree this script will ever read is the real
// packages/db/migrations under this checkout.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXPECTED_MIGRATIONS_ROOT = resolve(SCRIPT_DIR, "..", "packages", "db", "migrations");

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

/**
 * Resolves `migrationsDir` and rejects it if it escapes the expected
 * packages/db/migrations tree. `migrationsDir` comes straight from a CLI
 * arg, so without this a caller (or a malicious/careless invocation) could
 * point the check — and its readdir/readFileSync calls — anywhere on disk.
 */
function assertWithinExpectedTree(migrationsDir) {
  const resolvedDir = resolve(migrationsDir);
  const relativeToExpected = relative(EXPECTED_MIGRATIONS_ROOT, resolvedDir);
  const isWithinExpectedTree =
    resolvedDir === EXPECTED_MIGRATIONS_ROOT ||
    (!relativeToExpected.startsWith("..") && !isAbsolute(relativeToExpected));

  if (!isWithinExpectedTree) {
    throw new Error(
      `"${migrationsDir}" resolves to ${resolvedDir}, which is outside the expected migrations tree (${EXPECTED_MIGRATIONS_ROOT})`,
    );
  }

  return resolvedDir;
}

function loadAndCheck(migrationsDir) {
  const resolvedDir = assertWithinExpectedTree(migrationsDir);
  const journalPath = join(resolvedDir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8"));
  const sqlFileNames = readdirSync(resolvedDir).filter((name) => name.endsWith(".sql"));
  return analyzeMigrationParity(journal, sqlFileNames);
}

function runCli(migrationsDir) {
  if (!migrationsDir) {
    console.error("usage: check-migration-parity.mjs <path-to-migrations-dir>");
    process.exitCode = 1;
    return;
  }

  let issues;
  try {
    issues = loadAndCheck(migrationsDir);
  } catch (err) {
    console.error(`Migration schema-parity check failed for ${migrationsDir}: ${err.message}`);
    process.exitCode = 1;
    return;
  }

  if (issues.length > 0) {
    const formattedIssues = issues.map((issue) => `  - ${issue}`).join("\n");
    console.error(`Migration schema-parity check failed for ${migrationsDir}:\n${formattedIssues}`);
    process.exitCode = 1;
  } else {
    console.log(`Migration schema-parity check passed for ${migrationsDir} (journal and .sql files agree).`);
  }
}

// `import.meta.main` needs Node 22.18+/24.2+ (this script is invoked with
// plain `node` from package.json and the deploy workflow, not guaranteed to
// be that new on every runner). `process.argv[1]` compared against this
// module's own path is the portable ESM equivalent of `require.main ===
// module` and works on any Node or Bun version.
const isDirectlyInvoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectlyInvoked) {
  runCli(process.argv[2]);
}
