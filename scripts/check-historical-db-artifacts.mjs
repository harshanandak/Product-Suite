#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPOSITORY_ROOT = resolve(SCRIPT_DIR, "..");
export const MIGRATIONS_ROOT = join(REPOSITORY_ROOT, "packages", "db", "migrations");
export const MANIFEST_PATH = join(REPOSITORY_ROOT, "docs", "history", "database-migrations", "manifest.json");

/**
 * The only historical edits permitted by the Neon bootstrap repair.  The
 * contract is deliberately data-shaped so the checker and tests can inspect
 * it without parsing prose or depending on migration order.
 */
export const ALLOWED_REPAIRS = [
  {
    file: "0000_stale_jamie_braddock.sql",
    constraint: "projects_tenant_id_tenants_id_fk",
    table: "projects",
    columns: ["tenant_id"],
    referencedTable: "tenants",
    referencedColumns: ["id"],
    onDelete: "cascade",
    onUpdate: "no action",
  },
  {
    file: "0000_stale_jamie_braddock.sql",
    constraint: "work_items_tenant_id_tenants_id_fk",
    table: "work_items",
    columns: ["tenant_id"],
    referencedTable: "tenants",
    referencedColumns: ["id"],
    onDelete: "cascade",
    onUpdate: "no action",
  },
  {
    file: "0000_stale_jamie_braddock.sql",
    constraint: "work_item_dependencies_tenant_id_tenants_id_fk",
    table: "work_item_dependencies",
    columns: ["tenant_id"],
    referencedTable: "tenants",
    referencedColumns: ["id"],
    onDelete: "cascade",
    onUpdate: "no action",
  },
  {
    file: "0000_stale_jamie_braddock.sql",
    constraint: "work_items_assignee_id_users_id_fk",
    table: "work_items",
    columns: ["assignee_id"],
    referencedTable: "users",
    referencedColumns: ["id"],
    onDelete: "set null",
    onUpdate: "no action",
  },
  {
    file: "0004_minor_lockheed.sql",
    constraint: "projects_lead_id_users_id_fk",
    table: "projects",
    columns: ["lead_id"],
    referencedTable: "users",
    referencedColumns: ["id"],
    onDelete: "set null",
    onUpdate: "no action",
  },
];

const REPAIR_FILES = new Set(ALLOWED_REPAIRS.map(({ file }) => file));
const REPAIRS_BY_FILE = new Map(
  [...REPAIR_FILES].map((file) => [file, ALLOWED_REPAIRS.filter((repair) => repair.file === file)]),
);
const IMMUTABLE_DRIZZLE_FILES = [
  "0001_dear_the_enforcers.sql",
  "0002_polite_orphan.sql",
  "0003_tranquil_tattoo.sql",
  "0005_rename_tasks_to_checks.sql",
  "0006_provenance_foundation.sql",
  "0007_proposals.sql",
  "0008_agent_transcript.sql",
  "0009_chat_threads.sql",
  "0010_memory_brain.sql",
  "0011_memory_source_proposal_uniq.sql",
  "0012_proposals_reflected_at.sql",
  "0013_knowledge_base.sql",
  "0014_work_item_applied_from_proposal_partial.sql",
  "0015_meeting_promotions.sql",
  "0016_memory_ownership_axis.sql",
  "0017_proposal_target_snapshot.sql",
  "0018_collaboration_fabric.sql",
];

export const HISTORY_VARIANTS = Object.freeze({
  ORIGINAL_PRODUCTION: "original-production",
  REPAIRED_BOOTSTRAP: "repaired-bootstrap",
});

export function normalizeLineEndings(value) {
  return String(value).replace(/\r\n?/g, "\n");
}

/** Hashes canonical LF bytes. This is the cross-platform comparison hash. */
export function sha256(value) {
  return createHash("sha256").update(normalizeLineEndings(value), "utf8").digest("hex");
}

/** Hashes the bytes exactly as supplied, used for legacy CRLF provenance. */
export function sha256Bytes(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function compact(value) {
  return normalizeLineEndings(value)
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[^]*?\*\//g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function quote(identifier) {
  return `"${identifier}"`;
}

function expectedFkPattern(repair) {
  const columns = repair.columns.map(quote).join(",");
  const referencedColumns = repair.referencedColumns.map(quote).join(",");
  return new RegExp(
    `alter\\s+table\\s+${quote(repair.table)}\\s+add\\s+constraint\\s+${quote(repair.constraint)}\\s+foreign\\s+key\\s*\\(\\s*${columns}\\s*\\)\\s+references\\s+${quote("public")}\\.${quote(repair.referencedTable)}\\s*\\(\\s*${referencedColumns}\\s*\\)\\s+on\\s+delete\\s+${repair.onDelete.replace(" ", "\\s+")}\\s+on\\s+update\\s+${repair.onUpdate.replace(" ", "\\s+")}`,
    "i",
  );
}

function guardPattern(repair) {
  return new RegExp(
    `if\\s+to_regclass\\s*\\(\\s*['"]public\\.${repair.referencedTable}['"]\\s*\\)\\s+is\\s+not\\s+null\\s+then`,
    "i",
  );
}

function blocksForContent(content) {
  return [...normalizeLineEndings(content).matchAll(/do\s*\$\$[^]*?end\s*\$\$\s*;/gi)].map((match) => match[0]);
}

function fkSignatures(content) {
  return [...normalizeLineEndings(content).matchAll(
    /alter\s+table\s+"([^"]+)"\s+add\s+constraint\s+"([^"]+)"\s+foreign\s+key\s*\(\s*"([^"]+)"\s*\)\s+references\s+"public"\."([^"]+)"\s*\(\s*"([^"]+)"\s*\)\s+on\s+delete\s+(cascade|set null|restrict|no action)\s+on\s+update\s+(cascade|set null|restrict|no action)/gi,
  )].map((match) => ({
    table: match[1],
    constraint: match[2],
    column: match[3],
    referencedTable: match[4],
    referencedColumn: match[5],
    onDelete: match[6].toLowerCase(),
    onUpdate: match[7].toLowerCase(),
  }));
}

/**
 * Check a repaired SQL file's semantic shape. It does not accept a sixth
 * guarded block, a renamed column, or changed referential actions. A hash
 * check in the manifest additionally catches edits outside these FK blocks.
 */
export function inspectRepairSemantics(content, file, { originalContent } = {}) {
  const repairs = REPAIRS_BY_FILE.get(file);
  if (!repairs) {
    return { ok: false, repairCount: 0, semanticViolations: [`${file} is not an allowlisted repair file`] };
  }

  const text = normalizeLineEndings(content);
  const blocks = blocksForContent(text);
  const signatures = fkSignatures(text);
  const semanticViolations = [];
  const guardBlocks = [];

  for (const repair of repairs) {
    const signature = signatures.find(({ constraint }) => constraint === repair.constraint);
    if (!signature) {
      semanticViolations.push(`${file}:${repair.constraint} missing original FK definition`);
      continue;
    }
    const expected = compact(
      `ALTER TABLE ${quote(repair.table)} ADD CONSTRAINT ${quote(repair.constraint)} FOREIGN KEY (${quote(repair.columns[0])}) REFERENCES ${quote("public")}.${quote(repair.referencedTable)} (${quote(repair.referencedColumns[0])}) ON DELETE ${repair.onDelete} ON UPDATE ${repair.onUpdate}`,
    );
    const actual = compact(
      `ALTER TABLE ${quote(signature.table)} ADD CONSTRAINT ${quote(signature.constraint)} FOREIGN KEY (${quote(signature.column)}) REFERENCES ${quote("public")}.${quote(signature.referencedTable)} (${quote(signature.referencedColumn)}) ON DELETE ${signature.onDelete} ON UPDATE ${signature.onUpdate}`,
    );
    if (actual !== expected) semanticViolations.push(`${file}:${repair.constraint} FK semantics changed`);

    const matchingBlock = blocks.find((block) => block.toLowerCase().includes(`"${repair.constraint.toLowerCase()}"`));
    if (!matchingBlock || !guardPattern(repair).test(matchingBlock)) {
      semanticViolations.push(`${file}:${repair.constraint} must be guarded by to_regclass(public.${repair.referencedTable})`);
    } else {
      guardBlocks.push(matchingBlock);
    }
  }

  const unexpectedGuards = blocks.filter((block) => /to_regclass\s*\(/i.test(block) && !guardBlocks.includes(block));
  if (unexpectedGuards.length) semanticViolations.push(`${file} contains a guard outside the five-block allowlist`);

  const expectedConstraints = new Set(repairs.map(({ constraint }) => constraint));
  const externalConstraints = signatures.filter(({ referencedTable }) => ["tenants", "users"].includes(referencedTable));
  for (const signature of externalConstraints) {
    if (!expectedConstraints.has(signature.constraint)) {
      semanticViolations.push(`${file} contains an unallowlisted external FK ${signature.constraint}`);
    }
  }

  if (originalContent !== undefined) {
    const original = normalizeLineEndings(originalContent);
    const repairedWithoutGuards = text.replace(
      /if\s+to_regclass\s*\(\s*['"]public\.(?:tenants|users)['"]\s*\)\s+is\s+not\s+null\s+then/gi,
      "",
    );
    if (compact(repairedWithoutGuards) !== compact(original)) {
      semanticViolations.push(`${file} contains changes outside the guarded FK blocks`);
    }
  }

  return {
    ok: semanticViolations.length === 0,
    repairCount: guardBlocks.length,
    semanticViolations,
    signatures,
  };
}

function classifyMarker(value) {
  if (value === "original" || /^original(?:-|$)/i.test(String(value))) return HISTORY_VARIANTS.ORIGINAL_PRODUCTION;
  if (value === "repaired" || /^repaired(?:-|$)/i.test(String(value))) return HISTORY_VARIANTS.REPAIRED_BOOTSTRAP;
  return null;
}

/** Resolve a pair of 0000/0004 provenance markers into a recognized variant. */
export function detectHistoryVariant(input, manifest = null) {
  if (!input || typeof input !== "object") throw new Error("HISTORY_HASH_UNKNOWN");
  if (input.snapshot) {
    const snapshot = input.snapshot;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.id ?? "")) {
      throw new Error("SNAPSHOT_PROVENANCE_INVALID");
    }
    if (snapshot.prevId !== undefined && !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(snapshot.prevId)) {
      throw new Error("SNAPSHOT_PROVENANCE_INVALID");
    }
  }

  const markerFiles = ["0000_stale_jamie_braddock.sql", "0004_minor_lockheed.sql"];
  const modes = markerFiles.map((file) => {
    const value = input[file];
    const marker = classifyMarker(value);
    if (marker) return marker;
    const repair = ALLOWED_REPAIRS.find((candidate) => candidate.file === file);
    if (!repair) return null;
    const entry = manifest?.drizzle?.repairs?.find((candidate) => candidate.path === repair.file);
    if (!entry) return null;
    const originalHashes = new Set([entry.original?.lfSha256, entry.original?.crlfSha256].filter(Boolean));
    const repairedHashes = new Set([entry.repaired?.lfSha256, entry.repaired?.sha256].filter(Boolean));
    if (originalHashes.has(value)) return HISTORY_VARIANTS.ORIGINAL_PRODUCTION;
    if (repairedHashes.has(value)) return HISTORY_VARIANTS.REPAIRED_BOOTSTRAP;
    return null;
  });

  if (modes.some((mode) => !mode)) throw new Error("HISTORY_HASH_UNKNOWN");
  if (new Set(modes).size !== 1) throw new Error("HISTORY_VARIANT_MIXED");
  return modes[0];
}

function manifestEntries(manifest) {
  const result = [];
  for (const root of Object.values(manifest?.historicalRoots ?? {})) {
    for (const entry of root?.files ?? []) result.push(entry);
  }
  return result;
}

function loadManifest(path = MANIFEST_PATH) {
  if (!existsSync(path)) throw new Error(`manifest not found at ${path}`);
  return JSON.parse(readFileSync(path, "utf8"));
}

function readFileHash(path) {
  const content = readFileSync(path, "utf8");
  return { content, lfSha256: sha256(content), rawSha256: sha256Bytes(content) };
}

/** Full repository check used by CI and the focused CLI. */
export function checkHistoricalArtifacts({ root = REPOSITORY_ROOT, manifestPath = join(root, "docs", "history", "database-migrations", "manifest.json"), expectedVariant } = {}) {
  const issues = [];
  let manifest;
  try {
    manifest = loadManifest(manifestPath);
  } catch (error) {
    return { ok: false, issues: [error.message], variant: null };
  }

  const variantMarkers = {};
  for (const repair of ALLOWED_REPAIRS) {
    const path = join(root, "packages", "db", "migrations", repair.file);
    if (!existsSync(path)) {
      issues.push(`missing allowlisted repair ${repair.file}`);
      continue;
    }
    const { content, lfSha256 } = readFileHash(path);
    const entry = manifest.drizzle?.repairs?.find((candidate) => candidate.path === repair.file);
    if (!entry) {
      issues.push(`manifest missing repair entry ${repair.file}`);
      continue;
    }
    const original = new Set([entry.original?.lfSha256, entry.original?.crlfSha256].filter(Boolean));
    const repaired = new Set([entry.repaired?.lfSha256, entry.repaired?.sha256].filter(Boolean));
    if (original.has(lfSha256)) variantMarkers[repair.file] = "original";
    else if (repaired.has(lfSha256)) variantMarkers[repair.file] = "repaired";
    else issues.push(`unknown hash for ${repair.file}`);
    const semantic = inspectRepairSemantics(content, repair.file);
    if (!semantic.ok && !original.has(lfSha256)) issues.push(...semantic.semanticViolations);
  }

  let variant = null;
  try {
    variant = detectHistoryVariant(variantMarkers, manifest);
  } catch (error) {
    issues.push(error.message);
  }
  if (expectedVariant && variant && expectedVariant !== variant) issues.push(`history variant ${variant} does not match ${expectedVariant}`);

  for (const file of IMMUTABLE_DRIZZLE_FILES) {
    const path = join(root, "packages", "db", "migrations", file);
    const entry = manifest.drizzle?.immutable?.find((candidate) => candidate.path === file);
    if (!entry) {
      issues.push(`manifest missing immutable Drizzle entry ${file}`);
      continue;
    }
    if (!existsSync(path) || sha256(readFileSync(path, "utf8")) !== entry.lfSha256) issues.push(`immutable Drizzle migration changed: ${file}`);
  }

  for (const [snapshotPath, entry] of Object.entries(manifest.snapshots ?? {})) {
    const path = join(root, snapshotPath);
    if (!existsSync(path)) {
      issues.push(`snapshot file missing: ${snapshotPath}`);
      continue;
    }
    const expected = entry?.sha256 ?? entry;
    if (!expected || sha256(readFileSync(path, "utf8")) !== expected) issues.push(`fabricated or changed snapshot: ${snapshotPath}`);
  }

  for (const entry of manifestEntries(manifest)) {
    const path = join(root, entry.path);
    if (!existsSync(path)) {
      issues.push(`historical file missing: ${entry.path}`);
      continue;
    }
    if (sha256(readFileSync(path, "utf8")) !== entry.lfSha256) issues.push(`historical file changed: ${entry.path}`);
  }

  return { ok: issues.length === 0, issues, variant };
}

function parseCli(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--history-variant") options.expectedVariant = args[++index];
    else if (args[index] === "--manifest") options.manifestPath = resolve(args[++index]);
    else if (args[index] === "--root") options.root = resolve(args[++index]);
    else return null;
  }
  return options;
}

function main() {
  const options = parseCli(process.argv.slice(2));
  if (!options) {
    console.error("usage: check-historical-db-artifacts.mjs [--root <repo>] [--manifest <path>] [--history-variant <variant>]");
    process.exitCode = 1;
    return;
  }
  const result = checkHistoricalArtifacts(options);
  if (!result.ok) {
    console.error(`historical database artifact check failed (${result.issues.length} issue(s))`);
    for (const issue of result.issues) console.error(`  - ${issue}`);
    process.exitCode = 1;
    return;
  }
  console.log(`historical database artifact check passed variant=${result.variant}`);
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) main();
