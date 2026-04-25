import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const SOURCE_EXTENSIONS = new Set([
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".py",
  ".java",
  ".go",
  ".rb",
  ".cs",
]);
export const TEST_MARKERS = [
  ".test.",
  ".spec.",
  ".integration.",
  ".e2e.",
  ".cy.",
  "__tests__/",
  "/tests/",
  "/test/",
  "_test.",
  "Test.",
];

const TEST_SUFFIXES = [".test", ".spec", ".integration", ".e2e", ".cy"];
const TEST_EXTENSIONS = [...SOURCE_EXTENSIONS];
const IGNORED_PREFIXES = [".github/", "docs/", "infra/"];
const IGNORED_SEGMENTS = ["/dist/", "/build/", "/coverage/", "/.next/", "/node_modules/"];

export function normalizePath(file) {
  return file.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\.\//, "");
}

export function getStagedFiles() {
  const output = execFileSync(
    "git",
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    { encoding: "utf8" },
  );

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(normalizePath);
}

export function isIgnored(file) {
  const normalized = normalizePath(file);
  return (
    IGNORED_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    IGNORED_SEGMENTS.some((segment) => normalized.includes(segment))
  );
}

export function isTestFile(file) {
  const normalized = normalizePath(file);
  return TEST_MARKERS.some((marker) => normalized.includes(marker));
}

export function isSourceFile(file) {
  const normalized = normalizePath(file);

  if (isIgnored(normalized) || isTestFile(normalized)) {
    return false;
  }

  if (normalized.endsWith("package.json")) {
    return true;
  }

  return SOURCE_EXTENSIONS.has(path.posix.extname(normalized));
}

function addCandidateBase(candidateBases, basePath) {
  const normalized = normalizePath(basePath);
  if (normalized && normalized !== ".") {
    candidateBases.add(normalized);
  }
}

function getProjectRoot(file) {
  const segments = normalizePath(file).split("/");
  if (["apps", "packages", "services"].includes(segments[0]) && segments.length > 1) {
    return `${segments[0]}/${segments[1]}`;
  }

  return "";
}

function splitSourceFile(file) {
  const normalized = normalizePath(file);

  if (normalized.endsWith(".d.ts")) {
    return {
      extension: ".d.ts",
      basename: path.posix.basename(normalized, ".d.ts"),
      withoutExtension: normalized.slice(0, -".d.ts".length),
    };
  }

  const extension = path.posix.extname(normalized);
  return {
    extension,
    basename: path.posix.basename(normalized, extension),
    withoutExtension: normalized.slice(0, -extension.length),
  };
}

export function buildCandidateTestPaths(file) {
  const normalized = normalizePath(file);
  const { extension, basename, withoutExtension } = splitSourceFile(normalized);
  const directory = path.posix.dirname(normalized);
  const projectRoot = getProjectRoot(normalized);
  const candidateBases = new Set();

  addCandidateBase(candidateBases, `${directory}/${basename}`);
  addCandidateBase(candidateBases, `${directory}/__tests__/${basename}`);
  addCandidateBase(candidateBases, `${directory}/tests/${basename}`);
  addCandidateBase(candidateBases, `${directory}/test/${basename}`);

  if (projectRoot) {
    const relativePath = withoutExtension.slice(projectRoot.length + 1);
    addCandidateBase(candidateBases, `${projectRoot}/tests/${relativePath}`);
    addCandidateBase(candidateBases, `${projectRoot}/test/${relativePath}`);
  }

  if (normalized.includes("/src/")) {
    const [prefix, relativeSourcePath] = normalized.split("/src/");
    const relativePath = relativeSourcePath.slice(0, -extension.length);
    const relativeDirectory = path.posix.dirname(relativePath);
    const relativeBase = path.posix.basename(relativePath);

    addCandidateBase(candidateBases, `${prefix}/src/${relativeDirectory}/__tests__/${relativeBase}`);
    addCandidateBase(candidateBases, `${prefix}/src/${relativeDirectory}/tests/${relativeBase}`);
    addCandidateBase(candidateBases, `${prefix}/tests/${relativePath}`);
    addCandidateBase(candidateBases, `${prefix}/test/${relativePath}`);
  }

  if (normalized.startsWith("scripts/")) {
    const relativePath = withoutExtension.slice("scripts/".length);
    addCandidateBase(candidateBases, `scripts/__tests__/${relativePath}`);
    addCandidateBase(candidateBases, `test/${relativePath}`);
    addCandidateBase(candidateBases, `tests/${relativePath}`);
  }

  if (normalized.includes(".config.") || normalized.endsWith("package.json")) {
    addCandidateBase(candidateBases, "test/repo-tooling");
  }

  const candidates = new Set();
  for (const basePath of candidateBases) {
    const baseDirectory = path.posix.dirname(basePath);
    const baseName = path.posix.basename(basePath);

    for (const testExtension of TEST_EXTENSIONS) {
      for (const suffix of TEST_SUFFIXES) {
        candidates.add(`${basePath}${suffix}${testExtension}`);
      }
      candidates.add(`${basePath}_test${testExtension}`);
      candidates.add(`${basePath}Test${testExtension}`);
      candidates.add(`${baseDirectory}/test_${baseName}${testExtension}`);
    }
  }

  return candidates;
}

export function hasCorrespondingTest(sourceFile, stagedFiles) {
  const candidateTestPaths = buildCandidateTestPaths(sourceFile);
  const hasStagedMatchingTest = stagedFiles
    .map(normalizePath)
    .filter(isTestFile)
    .some((file) => candidateTestPaths.has(file));

  if (hasStagedMatchingTest) {
    return true;
  }

  return [...candidateTestPaths].some((file) => existsSync(file));
}

export function getMissingSourceTests(stagedFiles) {
  const normalizedFiles = stagedFiles.map(normalizePath);
  const sourceFiles = normalizedFiles.filter(isSourceFile);

  if (sourceFiles.length === 0) {
    return [];
  }

  return sourceFiles.filter((file) => !hasCorrespondingTest(file, normalizedFiles));
}

function main() {
  const stagedFiles = getStagedFiles();
  const missingSourceTests = getMissingSourceTests(stagedFiles);

  if (missingSourceTests.length === 0) {
    process.exit(0);
  }

  console.error("Blocked commit: source files are staged without corresponding test files.");
  console.error("Staged source files missing tests:");
  for (const file of missingSourceTests) {
    console.error(`- ${file}`);
  }
  console.error("Stage matching tests for each changed source file and try again.");
  process.exit(1);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
