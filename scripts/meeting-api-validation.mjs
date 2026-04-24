import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const pythonCandidates = [
  { command: "python3", args: [] },
  { command: "python", args: [] },
  { command: "py", args: ["-3"] },
];
const requiredPythonVersion = "3.13";

function resolvePython() {
  const discoveredVersions = [];

  for (const candidate of pythonCandidates) {
    const probe = spawnSync(
      candidate.command,
      [...candidate.args, "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
      {
        cwd: rootDir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      },
    );

    if (probe.status !== 0) {
      continue;
    }

    const version = probe.stdout.trim();
    discoveredVersions.push(`${candidate.command} ${candidate.args.join(" ")} -> ${version}`.trim());

    if (version === requiredPythonVersion) {
      return candidate;
    }
  }

  if (discoveredVersions.length > 0) {
    throw new Error(
      `Meeting API validation requires Python ${requiredPythonVersion}. Found: ${discoveredVersions.join(", ")}.`,
    );
  }

  throw new Error(
    `Python ${requiredPythonVersion} was not found. Install Python ${requiredPythonVersion}, then rerun the meeting-api validation command.`,
  );
}

function runPython(python, args) {
  const result = spawnSync(python.command, [...python.args, ...args], {
      cwd: rootDir,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const command = process.argv[2];
const scriptArgs = process.argv.slice(3);
const python = resolvePython();
const requirementsPath = resolve(rootDir, "apps", "meeting-api", "backend", "requirements.txt");

if (!existsSync(requirementsPath)) {
  throw new Error(`Meeting API requirements file is missing: ${requirementsPath}`);
}

switch (command) {
  case "install":
    runPython(python, ["-m", "pip", "install", "-r", scriptArgs[0] ?? "apps/meeting-api/backend/requirements.txt"]);
    break;
  case "lint":
    runPython(python, ["-m", "flake8", ...scriptArgs]);
    break;
  case "test":
    runPython(python, ["-m", "pytest", ...scriptArgs, "-q"]);
    break;
  default:
    throw new Error(
      "Usage: node scripts/meeting-api-validation.mjs <install|lint|test> [extra args...]",
    );
}
