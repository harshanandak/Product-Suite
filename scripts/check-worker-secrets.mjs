#!/usr/bin/env node

/** Renders an unexpected value for an error message without throwing on it. */
function describeValue(value) {
  if (value === undefined) return "undefined";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Validates the payload of `wrangler secret list --format json` for a Worker
 * environment against the secrets that environment must have. Fails closed on
 * anything it cannot positively confirm: unparseable output, a non-array
 * payload, or an entry that is not an object carrying a non-empty string
 * `name` all count as issues rather than being skipped, so a malformed listing
 * can never read as "all secrets present". Pure function: takes the raw text
 * so it can be unit tested without invoking wrangler.
 */
export function analyzeWorkerSecrets(listingText, requiredNames) {
  let parsed;
  try {
    parsed = JSON.parse(listingText);
  } catch (err) {
    return [`could not parse the wrangler secret listing as JSON (${err.message})`];
  }

  if (!Array.isArray(parsed)) {
    return [`expected a JSON array of secrets, got ${describeValue(parsed)}`];
  }

  const issues = [];
  const names = [];
  parsed.forEach((entry, index) => {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      issues.push(`secret listing entry ${index} is not an object (${describeValue(entry)})`);
      return;
    }
    if (typeof entry.name !== "string" || entry.name.trim() === "") {
      issues.push(`secret listing entry ${index} has no usable "name" (${describeValue(entry.name)})`);
      return;
    }
    names.push(entry.name);
  });

  const missing = requiredNames.filter((name) => !names.includes(name));
  if (missing.length > 0) {
    issues.push(`missing required secrets: ${missing.join(", ")}`);
  }

  return issues;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("end", () => resolve(text));
    process.stdin.on("error", reject);
  });
}

async function runCli(requiredNames) {
  if (requiredNames.length === 0) {
    console.error("usage: check-worker-secrets.mjs <REQUIRED_SECRET> [...] < wrangler-secret-list.json");
    process.exitCode = 1;
    return;
  }

  let listingText;
  try {
    listingText = await readStdin();
  } catch (err) {
    console.error(`Worker secret check failed: could not read the secret listing from stdin (${err.message})`);
    process.exitCode = 1;
    return;
  }

  const issues = analyzeWorkerSecrets(listingText, requiredNames);
  if (issues.length > 0) {
    const formattedIssues = issues.map((issue) => `  - ${issue}`).join("\n");
    const hint = issues.some((issue) => issue.startsWith("missing required secrets"))
      ? "\nSet each missing secret with: wrangler secret put <NAME> --env production (see apps/platform-api/DEPLOY.md). Deploying without them leaves the API live but unconfigured."
      : "";
    console.error(`Worker secret check failed:\n${formattedIssues}${hint}`);
    process.exitCode = 1;
    return;
  }

  console.log(`Worker secret check passed — all required secrets are set: ${requiredNames.join(", ")}`);
}

// `process.argv[1]` compared against this module's own path is the portable ESM
// equivalent of `require.main === module`, matching check-migration-parity.mjs.
const { resolve } = await import("node:path");
const { fileURLToPath } = await import("node:url");
const isDirectlyInvoked = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectlyInvoked) {
  await runCli(process.argv.slice(2));
}
