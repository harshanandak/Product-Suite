#!/usr/bin/env node
/**
 * Branch Protection Script (Cross-Platform)
 *
 * Prevents direct pushes to main/master branches.
 * Uses Node.js for Windows compatibility (no shell-specific syntax).
 *
 * Exit codes:
 *   0 - Push allowed
 *   1 - Push blocked (protected branch)
 */

const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ANSI color codes
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const RESET = '\x1b[0m';

const EXEC_OPTS = { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] };

function fileExistsSync(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Resolve a real git binary (git.exe on Windows). Never uses shell — avoids injection via argv joining.
 */
function resolveGitBinary() {
  const raw = (process.platform === 'win32'
    ? (process.env.Path || process.env.PATH || '')
    : (process.env.PATH || ''));
  const dirs = raw.split(path.delimiter).filter(Boolean);
  if (process.platform === 'win32') {
    for (const d of dirs) {
      const exe = path.join(d, 'git.exe');
      if (fileExistsSync(exe)) return exe;
    }
    return 'git.exe';
  }
  for (const d of dirs) {
    const g = path.join(d, 'git');
    if (fileExistsSync(g)) return g;
  }
  return 'git';
}

/** Validate branch names with Git's own ref rules. */
function isSafeGitRefComponent(s) {
  if (!s) return false;
  try {
    return execGit(['check-ref-format', '--branch', s]).trim() === s;
  } catch {
    return false;
  }
}

function execGit(args) {
  return execFileSync(resolveGitBinary(), args, EXEC_OPTS);
}

// Protected branches
const PROTECTED_BRANCHES = new Set(['main', 'master']);
const PROTECTED_REFS = new Set([...PROTECTED_BRANCHES].map(branch => `refs/heads/${branch}`));
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

function isValidGitRef(ref) {
  try {
    execGit(['check-ref-format', ref]);
    return true;
  } catch {
    return false;
  }
}

function prePushDestinations(input) {
  return input.trim().split(/\r?\n/).map((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 4 || !OBJECT_ID.test(fields[1])
      || !OBJECT_ID.test(fields[3]) || !isValidGitRef(fields[2])) {
      throw new Error('malformed pre-push input');
    }
    return fields[2];
  });
}

/**
 * Get the current branch name
 * @returns {string} Current git branch name
 */
function getCurrentBranch() {
  try {
    if (process.env.LEFTHOOK_GIT_BRANCH) {
      const b = process.env.LEFTHOOK_GIT_BRANCH.trim();
      if (!isSafeGitRefComponent(b)) {
        console.error(`${RED}✗ Error: Invalid LEFTHOOK_GIT_BRANCH value${RESET}`);
        process.exit(1);
      }
      return b;
    }

    const branch = execGit(['rev-parse', '--abbrev-ref', 'HEAD']).trim();
    if (!isSafeGitRefComponent(branch)) {
      console.error(`${RED}✗ Error: Invalid branch name from git${RESET}`);
      process.exit(1);
    }
    return branch;
  } catch (error) {
    console.error(`${RED}✗ Error: Could not determine current branch${RESET}`);
    console.error(`  ${error.message}`);
    process.exit(1);
  }
}

/**
 * Check if branch is protected
 * @param {string} branch - Branch name to check
 * @returns {boolean} True if branch is protected
 */
function isProtectedBranch(branch) {
  return PROTECTED_BRANCHES.has(branch);
}

/**
 * Main function
 */
function main({ argv = process.argv, currentBranch: branchOverride, prePushInput } = {}) {
  // Handle --help flag
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Branch Protection Script');
    console.log('');
    console.log('Prevents direct pushes to protected branches (main/master).');
    console.log('');
    console.log('Usage:');
    console.log('  node scripts/branch-protection.js');
    console.log('');
    console.log('Exit codes:');
    console.log('  0 - Push allowed');
    console.log('  1 - Push blocked (protected branch)');
    return 0;
  }

  let currentBranch;
  if (typeof prePushInput === 'string' && prePushInput.trim()) {
    let destinations;
    try {
      destinations = prePushDestinations(prePushInput);
    } catch (error) {
      console.error(`${RED}✗ Error: ${error.message}${RESET}`);
      return 1;
    }
    const protectedRef = destinations.find(ref => PROTECTED_REFS.has(ref));
    if (!protectedRef) return 0;
    currentBranch = protectedRef.slice('refs/heads/'.length);
  } else {
    currentBranch = branchOverride || getCurrentBranch();
  }

  if (!isProtectedBranch(currentBranch)) return 0;
  return blockProtectedPush(currentBranch);
}

function blockProtectedPush(currentBranch) {
    // Beads runtime metadata is local state. Do not bypass protected branches for it.
    try {
      let upstream;
      try {
        upstream = execGit(['rev-parse', '--abbrev-ref', '@{u}']).trim();
      } catch (_e) {
        upstream = `origin/${currentBranch}`;
      }

      if (!isSafeGitRefComponent(upstream)) {
        throw new Error('unsafe upstream ref');
      }

      const output = execGit(['diff', '--name-only', `${upstream}..HEAD`]).trim();
      const changedFiles = output.split('\n').filter(Boolean);

      if (changedFiles.length === 0) {
        console.error(`${YELLOW}Note: no changed files detected — nothing to bypass${RESET}`);
      } else if (changedFiles.every(f => f.startsWith('.beads/'))) {
        console.error(`${YELLOW}Beads metadata is local runtime state; protected branches do not accept .beads-only pushes.${RESET}`);
      }
    } catch (_e) {
      console.error(`${YELLOW}Note: could not detect beads-only push (upstream ref missing?) — blocking by default${RESET}`);
    }

    console.error('');
    console.error(`${RED}╔═══════════════════════════════════════════════════════════════╗${RESET}`);
    console.error(`${RED}║                 ⚠  PUSH BLOCKED                              ║${RESET}`);
    console.error(`${RED}╚═══════════════════════════════════════════════════════════════╝${RESET}`);
    console.error('');
    console.error(`${RED}✗ Direct pushes to '${currentBranch}' are forbidden.${RESET}`);
    console.error('');
    console.error(`${YELLOW}To push your changes:${RESET}`);
    console.error(`  1. Create a feature branch: ${YELLOW}git checkout -b feat/my-feature${RESET}`);
    console.error(`  2. Push to the feature branch: ${YELLOW}git push -u origin feat/my-feature${RESET}`);
    console.error(`  3. Create a pull request for review`);
    console.error('');
    console.error(`${YELLOW}Emergency hook bypass is human-only and must not appear in agent logs.${RESET}`);
    console.error(`  See ${YELLOW}CLAUDE.md${RESET} (Git Workflow) — AI agents must fix failing hooks, not bypass them.`);
    console.error('');
    return 1;
}

if (require.main === module) {
  let prePushInput;
  if (!process.stdin.isTTY) {
    try {
      prePushInput = fs.readFileSync(0, 'utf8');
    } catch (_error) {
      // Forge's direct subprocess check has no pre-push stream; use branch fallback.
    }
  }
  process.exitCode = main({ prePushInput });
}

module.exports = { main };
