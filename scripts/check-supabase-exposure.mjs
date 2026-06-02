#!/usr/bin/env node
import { readFileSync } from "node:fs";

const EXPOSED_SCHEMAS = new Set(["public", "graphql_public"]);
const PRIVATE_SCHEMAS = new Set(["platform", "meeting", "roadmap", "agent", "realtime"]);

export function analyzeSupabaseExposure(sql) {
  const normalized = normalizeSql(sql);
  const issues = [];
  const createdTables = findCreatedTables(normalized);

  for (const tableName of createdTables) {
    const [schemaName] = tableName.split(".");
    if (EXPOSED_SCHEMAS.has(schemaName) && !hasRlsEnabled(normalized, tableName)) {
      issues.push(`${tableName} is in an exposed schema but does not enable row level security`);
    }
  }

  for (const schemaName of PRIVATE_SCHEMAS) {
    if (
      normalized.includes(`create schema if not exists ${schemaName}`) &&
      !normalized.includes(`revoke all on schema ${schemaName} from public, anon, authenticated`)
    ) {
      issues.push(`${schemaName} schema is private but does not revoke public, anon, and authenticated usage`);
    }
  }

  return issues;
}

function normalizeSql(sql) {
  return sql
    .replace(/--.*$/gm, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function findCreatedTables(sql) {
  const tableNames = [];
  const tablePattern = /create table if not exists ([a-z_][a-z0-9_]*\.[a-z_][a-z0-9_]*)/g;
  for (const match of sql.matchAll(tablePattern)) {
    tableNames.push(match[1]);
  }
  return tableNames;
}

function hasRlsEnabled(sql, tableName) {
  return sql.includes(`alter table ${tableName} enable row level security`);
}

function runCli(paths) {
  const issues = [];
  for (const path of paths) {
    const fileIssues = analyzeSupabaseExposure(readFileSync(path, "utf8"));
    for (const issue of fileIssues) {
      issues.push(`${path}: ${issue}`);
    }
  }

  if (issues.length > 0) {
    console.error(issues.join("\n"));
    process.exitCode = 1;
  }
}

if (import.meta.main) {
  runCli(process.argv.slice(2));
}
