import { describe, it, expect, vi } from "vitest";

import * as React from "react";

vi.mock("@clerk/clerk-react", () => ({
  UserButton: () => null,
  SignedIn: ({ children }: { children: React.ReactNode }) => children,
  SignedOut: () => null,
  RedirectToSignIn: () => null,
  SignIn: () => <div data-testid="clerk-signin" />,
  useOrganization: () => ({ organization: null, isLoaded: true }),
}));

import { router } from "./router";

/**
 * Collects the set of full paths the router exposes. Prefers `flatRoutes`
 * (the documented flattened-route accessor) when present, and falls back to
 * the public `routesById` registry — whose values each carry a `fullPath` —
 * for router builds that populate the route tree lazily.
 */
function collectFullPaths(): string[] {
  const candidate = router as unknown as {
    flatRoutes?: Array<{ fullPath: string }>;
    routesById?: Record<string, { fullPath?: string }>;
  };
  if (Array.isArray(candidate.flatRoutes)) {
    return candidate.flatRoutes.map((route) => route.fullPath);
  }
  return Object.values(candidate.routesById ?? {})
    .map((route) => route.fullPath)
    .filter((path): path is string => typeof path === "string");
}

describe("router", () => {
  it("is defined", () => {
    expect(router).toBeDefined();
  });

  it("registers the expected workspace and sign-in full paths", () => {
    const fullPaths = collectFullPaths();

    for (const expected of [
      "/sign-in",
      "/w/$workspace",
      "/w/$workspace/workboard",
      "/w/$workspace/workboard/graph",
      "/w/$workspace/workboard/views",
      "/w/$workspace/workboard/item/$itemId",
      "/w/$workspace/workboard/team/$teamId",
      "/w/$workspace/meetings",
      "/w/$workspace/agents",
      "/w/$workspace/settings",
    ]) {
      expect(fullPaths).toContain(expected);
    }
  });

  it("no longer registers the dead workboard routes", () => {
    const fullPaths = collectFullPaths();

    for (const dead of [
      "/w/$workspace/workboard/strategy",
      "/w/$workspace/workboard/insights",
      "/w/$workspace/workboard/tasks",
      "/w/$workspace/workboard/triage",
      "/w/$workspace/workboard/feedback",
    ]) {
      expect(fullPaths).not.toContain(dead);
    }
  });

  it("redirects /w/:ws/workboard/graph to the items surface on the Graph layout", async () => {
    await router.navigate({
      to: "/w/$workspace/workboard/graph",
      params: { workspace: "test-ws" },
    });
    await router.load();

    // Lands on the single items surface…
    expect(router.state.location.pathname).toBe("/w/test-ws/workboard");
    // …carrying the Graph layout so the deep link still opens the graph.
    expect(router.state.location.search).toMatchObject({ layout: "graph" });
  });
});
