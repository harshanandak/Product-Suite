import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// The forge CLI's push command shells out to `node scripts/branch-protection.js`
// as its pre-push branch-protection pre-check. Product-Suite retired that legacy
// script in favor of scripts/prepush-gate.mjs (wired via lefthook), which made
// every `forge push` in this repo abort with MODULE_NOT_FOUND. This shim
// restores the contract the CLI expects: block direct pushes to protected
// branches, allow everything else. These tests drive it through the same
// mock-git seam the upstream script ships for its own tests.

const SCRIPT = path.join(import.meta.dir, "..", "scripts", "branch-protection.js");

function makeMockGit(handlers) {
	const dir = mkdtempSync(path.join(tmpdir(), "branch-protection-shim-test-"));
	const mockPath = path.join(dir, "mock-git.js");
	const calls = [];
	writeFileSync(
		mockPath,
		`const handlers = ${JSON.stringify(handlers)};\n` +
			`const input = require("fs").readFileSync(0, "utf8");\n` +
			`const argv = process.argv.slice(2).join(" ");\n` +
			`const match = handlers.find((h) => argv.includes(h.match));\n` +
			`if (match) { process.stdout.write(match.out.replaceAll("\\n", "\\r\\n")); }\n` +
			`else { process.stderr.write("unexpected git invocation: " + argv + " stdin=" + input); process.exit(1); }\n`,
	);
	return {
		mockPath,
		calls,
		cleanup() {
			rmSync(dir, { recursive: true, force: true });
		},
	};
}

function runShim(mockPath) {
	return execFileSync("node", [SCRIPT], {
		encoding: "utf8",
		stdio: ["pipe", "pipe", "pipe"],
		env: {
			...process.env,
			NODE_ENV: "test",
			FORGE_GIT_MOCK_JS: mockPath,
			GIT_MOCK_JS: mockPath,
			// A Lefthook-owned value inherited from an outer push would override the
			// mock branch before mock git is consulted; strip it for isolation.
			LEFTHOOK_GIT_BRANCH: undefined,
		},
	});
}

function expectBlocked(mockPath) {
	try {
		runShim(mockPath);
	} catch (error) {
		expect(error.status).toBe(1);
		expect(String(error.stderr)).toMatch(/protected branch|main|master/i);
		return;
	}
	throw new Error("expected shim to block the push");
}

describe("scripts/branch-protection.js shim", () => {
	test("allows a normal feature-branch push", () => {
		const mock = makeMockGit([
			{ match: "rev-parse --abbrev-ref HEAD", out: "feat/some-feature\n" },
			{ match: "rev-parse --quiet --verify refs/heads/main", out: "" },
			{ match: "rev-parse --quiet --verify refs/heads/master", out: "" },
		]);
		try {
			// Success is a silent exit(0) by contract; only the exit code matters.
			runShim(mock.mockPath);
			expect(true).toBe(true);
		} catch (error) {
			throw new Error(`expected shim to allow the push, got exit ${error.status}`);
		} finally {
			mock.cleanup();
		}
	});

	test("blocks a direct push to main", () => {
		const mock = makeMockGit([
			{ match: "rev-parse --abbrev-ref HEAD", out: "main\n" },
		]);
		try {
			expectBlocked(mock.mockPath);
		} finally {
			mock.cleanup();
		}
	});

	test("blocks a direct push to master", () => {
		const mock = makeMockGit([
			{ match: "rev-parse --abbrev-ref HEAD", out: "master\n" },
		]);
		try {
			expectBlocked(mock.mockPath);
		} finally {
			mock.cleanup();
		}
	});
});
