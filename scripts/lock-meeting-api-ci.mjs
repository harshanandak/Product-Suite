import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = "apps/meeting-api/backend/requirements.txt";
const lockPath =
  "apps/meeting-api/backend/requirements-ci-cp313-linux-x86_64.txt";
const sourcePins = readFileSync(join(rootDir, sourcePath), "utf8")
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith("#"));
const sourceDigest = createHash("sha256")
  .update(`${sourcePins.join("\n")}\n`, "utf8")
  .digest("hex");
const tempDir = mkdtempSync(join(tmpdir(), "meeting-api-ci-lock-"));
const generatedPath = join(tempDir, "requirements.txt");

try {
  execFileSync(
    process.platform === "win32" ? "uv.exe" : "uv",
    [
      "pip",
      "compile",
      sourcePath,
      "--generate-hashes",
      "--no-strip-extras",
      "--python-version",
      "3.13",
      "--python-platform",
      "x86_64-unknown-linux-gnu",
      "--no-build",
      "--index-url",
      "https://pypi.org/simple",
      "--output-file",
      generatedPath,
      "--custom-compile-command",
      "node scripts/lock-meeting-api-ci.mjs",
    ],
    { cwd: rootDir, stdio: "inherit" },
  );
  const lock = readFileSync(generatedPath, "utf8").replace(/\r\n?/g, "\n");
  writeFileSync(
    join(rootDir, lockPath),
    `# source-pins-sha256: ${sourceDigest}\n${lock}`,
    "utf8",
  );
} finally {
  rmSync(tempDir, { force: true, recursive: true });
}
