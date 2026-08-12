import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  bootstrapWorktree,
  resolveWorktreePath,
} from "../scripts/worktree-bootstrap.mjs";

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function makeFixture() {
  const root = mkdtempSync(join(tmpdir(), "product-suite-worktree-bootstrap-"));
  tempRoots.push(root);
  const primaryModules = join(root, "node_modules");
  const worktree = join(root, ".worktrees", "feature-a");
  mkdirSync(primaryModules, { recursive: true });
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, ".git"), "gitdir: fixture");
  writeFileSync(join(primaryModules, "primary-sentinel"), "primary");
  writeFileSync(
    join(worktree, "package.json"),
    JSON.stringify({ workspaces: ["apps/platform-api", "apps/platform-web"] }),
  );
  for (const workspace of ["apps/platform-api", "apps/platform-web"]) {
    mkdirSync(join(worktree, workspace), { recursive: true });
  }
  symlinkSync(primaryModules, join(worktree, "node_modules"), "junction");
  return { root, worktree, primaryModules };
}

function installStub(expectedRoot) {
  return (command, args, options) => {
    expect(command).toBe("bun");
    expect(args).toEqual(["install", "--frozen-lockfile", "--backend", "copyfile"]);
    expect(options.cwd).toBe(expectedRoot);
    const exe = process.platform === "win32" ? ".exe" : "";
    mkdirSync(join(expectedRoot, "node_modules", ".bin"), { recursive: true });
    writeFileSync(join(expectedRoot, "node_modules", ".bin", `lefthook${exe}`), "ok");
    for (const workspace of ["apps/platform-api", "apps/platform-web"]) {
      mkdirSync(join(expectedRoot, workspace, "node_modules", ".bin"), {
        recursive: true,
      });
      for (const binary of ["eslint", "tsc", "vitest"]) {
        writeFileSync(
          join(expectedRoot, workspace, "node_modules", ".bin", `${binary}${exe}`),
          "ok",
        );
      }
    }
    return { status: 0, signal: null };
  };
}

describe("worktree bootstrap", () => {
  test("replaces only the worktree dependency junction with an isolated copyfile install", () => {
    const { root, worktree, primaryModules } = makeFixture();

    const result = bootstrapWorktree(worktree, root, { spawnSync: installStub(worktree) });

    expect(result.verifiedBinaries).toBe(7);
    expect(readFileSync(join(primaryModules, "primary-sentinel"), "utf8")).toBe("primary");
    expect(existsSync(join(worktree, "node_modules", "primary-sentinel"))).toBe(false);
  });

  test("rejects cleanup outside the repository worktree directory", () => {
    const { root } = makeFixture();
    const outside = join(root, "not-a-worktree");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "package.json"), JSON.stringify({ workspaces: [] }));

    expect(() => bootstrapWorktree(outside, root, { spawnSync: installStub(outside) })).toThrow(
      "must be inside",
    );
  });

  test("normalizes a validated slug to the repository worktree directory", () => {
    const { root } = makeFixture();
    expect(resolveWorktreePath(root, "cp0-tools")).toBe(join(root, ".worktrees", "cp0-tools"));
    expect(() => resolveWorktreePath(root, "../escape")).toThrow("Invalid worktree slug");
  });
});
