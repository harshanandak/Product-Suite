import { execFileSync } from "node:child_process";

const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".ts", ".tsx", ".py"]);
const TEST_MARKERS = [".test.", ".spec.", "__tests__/", "/tests/"];
const IGNORED_PREFIXES = [".github/", "docs/", "infra/", "scripts/"];
const IGNORED_SEGMENTS = ["/dist/", "/build/", "/coverage/", "/.next/", "/node_modules/"];

function getStagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { encoding: "utf8" },
  );

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/\\/g, "/"));
}

function isIgnored(file) {
  return (
    IGNORED_PREFIXES.some((prefix) => file.startsWith(prefix)) ||
    IGNORED_SEGMENTS.some((segment) => file.includes(segment))
  );
}

function isTestFile(file) {
  return TEST_MARKERS.some((marker) => file.includes(marker));
}

function isSourceFile(file) {
  if (isIgnored(file) || isTestFile(file)) {
    return false;
  }

  return [...SOURCE_EXTENSIONS].some((ext) => file.endsWith(ext));
}

const stagedFiles = getStagedFiles();
const sourceFiles = stagedFiles.filter(isSourceFile);

if (sourceFiles.length === 0 || stagedFiles.some(isTestFile)) {
  process.exit(0);
}

console.error("Blocked commit: source files are staged without corresponding test files.");
console.error("Staged source files:");
for (const file of sourceFiles) {
  console.error(`- ${file}`);
}
console.error("Stage at least one matching test file (*.test.*, *.spec.*, __tests__/, or /tests/) and try again.");
process.exit(1);
