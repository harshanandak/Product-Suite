import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  getPlatformModuleById,
  getPlatformModules,
  resolvePlatformModule,
} from "../module-registry";

const registrySource = readFileSync(
  resolve(dirname(fileURLToPath(import.meta.url)), "../module-registry.ts"),
  "utf8",
);

describe("platform module registry", () => {
  it("defines the shell-owned modules with stable hrefs", () => {
    expect(
      getPlatformModules().map((module) => ({
        id: module.id,
        label: module.label,
        href: module.href,
        status: module.status,
      })),
    ).toEqual([
      { id: "meetings", label: "Meetings", href: "/meetings", status: "active" },
      { id: "roadmap", label: "Roadmap", href: "/roadmap", status: "active" },
      { id: "canvas", label: "Canvas", href: "/canvas", status: "reserved" },
      { id: "agents", label: "Agents", href: "/agents", status: "reserved" },
      { id: "settings", label: "Settings", href: "/settings", status: "reserved" },
    ]);
  });

  it("resolves active modules from nested module routes", () => {
    expect(resolvePlatformModule("/meetings/new")?.id).toBe("meetings");
    expect(resolvePlatformModule("/meetings/meeting_123")?.id).toBe("meetings");
    expect(resolvePlatformModule("/roadmap/workspaces/acme")?.id).toBe("roadmap");
    expect(resolvePlatformModule("/canvas/documents/doc_123")?.id).toBe("canvas");
    expect(resolvePlatformModule("/agents/runs/run_123")?.id).toBe("agents");
    expect(resolvePlatformModule("/settings/billing")?.id).toBe("settings");
    expect(resolvePlatformModule("/auth/sign-in")).toBeNull();
  });

  it("exposes lookup helpers without allowing caller mutation", () => {
    const modules = getPlatformModules();

    expect(getPlatformModuleById("meetings")?.href).toBe("/meetings");
    expect(Object.isFrozen(modules)).toBe(true);
    expect(Object.isFrozen(modules[0])).toBe(true);
  });

  it("stays metadata-only and does not import module runtimes", () => {
    expect(registrySource).not.toMatch(/from\s+["'].*components\/meetings/);
    expect(registrySource).not.toContain("@product-suite/ui-meeting");
    expect(registrySource).not.toContain("@product-suite/ui-canvas");
    expect(registrySource).not.toContain("apps/meeting-web");
    expect(registrySource).not.toMatch(/^import\s/m);
  });
});
