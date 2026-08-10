#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateOriginalProductionVector } from "./check-historical-db-artifacts.mjs";

// Anchored to this script's own location (repo-root/scripts/...) rather than
// process.cwd(), so it doesn't matter where the CLI is invoked from — the
// only migrations tree this script will ever read is the real
// packages/db/migrations under this checkout.
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const EXPECTED_MIGRATIONS_ROOT = resolve(SCRIPT_DIR, "..", "packages", "db", "migrations");

function createCanonicalHash(value) {
  return createHash("sha256").update(String(value).replace(/\r\n?/g, "\n"), "utf8").digest("hex");
}

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

  // Drizzle applies entries in array order, so declaration order — not just the
  // set of idx values — has to be ascending; the sort below would mask a swap.
  for (let i = 1; i < entries.length; i += 1) {
    if (!(entries[i].idx > entries[i - 1].idx)) {
      issues.push(
        `journal entry "${entries[i].tag}" (idx ${entries[i].idx}) is out of array order: it is declared after "${entries[i - 1].tag}" (idx ${entries[i - 1].idx})`,
      );
      break;
    }
  }

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

const ORIGINAL_VARIANT = "original-production";
const REPAIRED_VARIANT = "repaired-bootstrap";
const REPAIR_FILES = new Set(["0000_stale_jamie_braddock.sql", "0004_minor_lockheed.sql"]);

function classifyHash(value, fileName, manifest) {
  if (value === "original" || /^original(?:-|$)/i.test(String(value))) return ORIGINAL_VARIANT;
  if (value === "repaired" || /^repaired(?:-|$)/i.test(String(value))) return REPAIRED_VARIANT;
  const entry = manifest?.drizzle?.repairs?.find((candidate) => candidate.path === fileName);
  if (!entry) return null;
  if ([entry.original?.lfSha256, entry.original?.crlfSha256].filter(Boolean).includes(value)) return ORIGINAL_VARIANT;
  if ([entry.repaired?.lfSha256, entry.repaired?.sha256].filter(Boolean).includes(value)) return REPAIRED_VARIANT;
  if (manifest?.drizzle?.historyVectors?.[ORIGINAL_VARIANT]?.entries?.some((candidate) => candidate.filename === fileName && candidate.observedSha256 === value)) return ORIGINAL_VARIANT;
  return null;
}

export function validateOriginalProductionRows(rows, { manifest, root, journal } = {}) {
  const vector = validateOriginalProductionVector({ manifest, root });
  if (!vector.ok) return { ok: false, code: "HISTORY_VECTOR_INVALID", issues: vector.issues };
  let migrationJournal = journal;
  try {
    migrationJournal ??= JSON.parse(readFileSync(join(root ?? resolve(SCRIPT_DIR, ".."), "packages", "db", "migrations", "meta", "_journal.json"), "utf8"));
  } catch {
    return { ok: false, code: "HISTORY_JOURNAL_INVALID", issues: ["migration journal is unavailable"] };
  }
  const timestamps = new Map((migrationJournal.entries ?? []).map((entry) => [entry.tag.slice(0, 4), Number(entry.when)]));
  const expected = vector.entries;
  if (!Array.isArray(rows) || rows.length !== expected.length) return { ok: false, code: "HISTORY_COUNT_MISMATCH", issues: [`expected ${expected.length} production rows`] };
  const byHash = new Map(expected.map((entry) => [entry.observedSha256, entry.tag]));
  const normalized = [];
  for (let index = 0; index < expected.length; index += 1) {
    const row = rows[index] ?? {};
    const expectedEntry = expected[index];
    const hash = row.hash ?? row.hash_value;
    const tag = row.tag ?? row.name ?? row.migration_tag ?? byHash.get(hash);
    if (tag !== expectedEntry.tag) return { ok: false, code: "HISTORY_ORDER_INVALID", issues: [`production history row ${index} is not ${expectedEntry.tag}`] };
    if (hash !== expectedEntry.observedSha256) return { ok: false, code: "HISTORY_HASH_UNKNOWN", issues: [`production history hash is not proven at ${expectedEntry.tag}`] };
    const timestamp = row.timestamp ?? row.created_at ?? row.when;
    if (Number(timestamp) !== timestamps.get(expectedEntry.tag)) return { ok: false, code: "HISTORY_TIMESTAMP_MISMATCH", issues: [`production history timestamp mismatch at ${expectedEntry.tag}`] };
    normalized.push({ ...row, tag, hash, timestamp });
  }
  return { ok: true, code: "ORIGINAL_PRODUCTION_HISTORY_VALID", entries: normalized, count: normalized.length };
}

/**
 * Validate the applied-history prefix independently of the manifest journal.
 * The manifest is only an allowlist of observed immutable bytes; it never
 * supplies pending migration order or acts as a second journal.
 */
function validateHistoryVariantHashes(hashes, historyVariant, manifest) {
  const modes = [...REPAIR_FILES].map((file) => classifyHash(hashes[file], file, manifest));
  if (modes.some((mode) => !mode)) return { ok: false, code: "HISTORY_HASH_UNKNOWN", issues: ["0000/0004 contains an unknown or fabricated hash"] };
  if (new Set(modes).size !== 1) return { ok: false, code: "HISTORY_VARIANT_MIXED", issues: ["0000 and 0004 must belong to the same history variant"] };
  if (modes[0] !== historyVariant) return { ok: false, code: "HISTORY_VARIANT_MISMATCH", issues: [`declared ${historyVariant} does not match observed ${modes[0]}`] };
  return null;
}

function validateOriginalHistory({ manifest, historyRows, root }) {
  const vector = validateOriginalProductionVector({ manifest, root });
  if (!vector.ok) return { ok: false, code: "HISTORY_VECTOR_INVALID", issues: vector.issues };
  if (historyRows === undefined) return null;
  const rows = validateOriginalProductionRows(historyRows, { manifest, root });
  return rows.ok ? null : rows;
}

function validateSnapshots(snapshotHashes, manifest) {
  const knownSnapshots = manifest?.snapshots ?? {};
  for (const [file, hash] of Object.entries(snapshotHashes)) {
    const expected = knownSnapshots[file]?.sha256 ?? knownSnapshots[file];
    if (!expected || expected !== hash) return { ok: false, code: "SNAPSHOT_HASH_UNKNOWN", issues: [`fabricated or unknown snapshot hash: ${file}`] };
  }
  return null;
}

export function validateMigrationHistory({ journal, sqlFileNames, hashes = {}, historyVariant, manifest, snapshotHashes = {}, historyRows, root } = {}) {
  const parityIssues = journal && sqlFileNames ? analyzeMigrationParity(journal, sqlFileNames) : [];
  if (parityIssues.length) return { ok: false, code: "MIGRATION_PARITY", issues: parityIssues };
  if (![ORIGINAL_VARIANT, REPAIRED_VARIANT].includes(historyVariant)) return { ok: false, code: "HISTORY_VARIANT_UNKNOWN", issues: ["history variant is not recognized"] };
  const hashIssue = validateHistoryVariantHashes(hashes, historyVariant, manifest);
  if (hashIssue) return hashIssue;
  if (historyVariant === ORIGINAL_VARIANT) {
    const vectorIssue = validateOriginalHistory({ manifest, historyRows, root });
    if (vectorIssue) return vectorIssue;
  }
  const snapshotIssue = validateSnapshots(snapshotHashes, manifest);
  if (snapshotIssue) return snapshotIssue;
  return { ok: true, historyVariant, issues: [] };
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
  return { issues: analyzeMigrationParity(journal, sqlFileNames), journal, sqlFileNames, resolvedDir };
}

function runCli(migrationsDir) {
  if (!migrationsDir) {
    console.error("usage: check-migration-parity.mjs <path-to-migrations-dir>");
    process.exitCode = 1;
    return;
  }

  let issues;
  try {
    const loaded = loadAndCheck(migrationsDir);
    issues = loaded.issues;
    const manifestPath = join(SCRIPT_DIR, "..", "docs", "history", "database-migrations", "manifest.json");
    if (issues.length === 0 && existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      const hashes = {};
      for (const file of REPAIR_FILES) hashes[file] = createCanonicalHash(readFileSync(join(loaded.resolvedDir, file), "utf8"));
      const snapshotHashes = {};
      const snapshotPrefix = "packages/db/migrations/";
      for (const file of Object.keys(manifest.snapshots ?? {})) {
        if (!file.startsWith(snapshotPrefix)) throw new Error(`snapshot path is outside the migrations tree: ${file}`);
        const snapshotPath = resolve(loaded.resolvedDir, file.slice(snapshotPrefix.length));
        if (relative(loaded.resolvedDir, snapshotPath).startsWith("..")) throw new Error(`snapshot path is outside the migrations tree: ${file}`);
        snapshotHashes[file] = createCanonicalHash(readFileSync(snapshotPath, "utf8"));
      }
      const variants = [...REPAIR_FILES].map((file) => classifyHash(hashes[file], file, manifest));
      const inferred = variants.length > 0 && variants.every((variant) => variant === variants[0]) ? variants[0] : null;
      const history = validateMigrationHistory({ journal: loaded.journal, sqlFileNames: loaded.sqlFileNames, hashes, historyVariant: inferred, manifest, snapshotHashes });
      if (!history.ok) issues = history.issues;
    }
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
