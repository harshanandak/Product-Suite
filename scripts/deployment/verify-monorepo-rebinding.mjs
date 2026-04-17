#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..", "..");
const registryPath = path.join(repoRoot, "docs", "deployment", "service-registry.json");

const requiredPaths = [
  "apps/roadmap-web/package.json",
  "apps/meeting-web/package.json",
  "apps/meeting-api/backend/railway.json",
  "apps/meeting-api/backend/requirements.txt",
  "apps/meeting-api/tests/backend",
  "infra/supabase/config.toml",
  ".github/workflows/roadmap-web-ci.yml",
  ".github/workflows/roadmap-web-playwright.yml",
  ".github/workflows/meeting-web-ci.yml",
  ".github/workflows/meeting-api-ci.yml",
  ".github/workflows/meeting-api-railway-preview.yml"
];

function checkPaths() {
  const missing = requiredPaths.filter((relativePath) => {
    const fullPath = path.join(repoRoot, relativePath);
    return !fs.existsSync(fullPath);
  });

  if (missing.length > 0) {
    console.error("Missing required monorepo paths:");
    for (const item of missing) {
      console.error(`- ${item}`);
    }
    process.exit(1);
  }
}

function checkRegistry() {
  const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
  const invalidEntries = registry.services.filter((service) => {
    return !service.id || !service.platform || !service.targetRootDirectory;
  });

  if (invalidEntries.length > 0) {
    console.error("Service registry contains invalid entries.");
    process.exit(1);
  }

  console.log("Verified service registry:");
  for (const service of registry.services) {
    console.log(`- ${service.id}: ${service.platform} -> ${service.targetRootDirectory}`);
  }
}

checkPaths();
checkRegistry();
console.log("Monorepo deployment rebinding checks passed.");
