import { describe, expect, it } from "vitest";

import {
  getRouteOwnership,
  listRouteOwnershipRules,
  type RouteCompatibility,
  type RouteOwner,
} from "../route-ownership";

describe("platform route ownership", () => {
  it("classifies platform module routes with owners, module IDs, and compatibility behavior", () => {
    expectRoute("/meetings", "platform-shell", "shell-native", "meetings");
    expectRoute("/meetings/new", "platform-shell", "meeting-compatible", "meetings");
    expectRoute("/meetings/meeting_123", "platform-shell", "meeting-compatible", "meetings");
    expectRoute("/roadmap", "platform-shell", "shell-native", "roadmap");
    expectRoute("/canvas", "platform-shell", "reserved", "canvas");
    expectRoute("/agents", "platform-shell", "reserved", "agents");
    expectRoute("/settings", "platform-shell", "reserved", "settings");
  });

  it("preserves existing roadmap, meeting, and auth-only route contracts", () => {
    expectRoute("/dashboard", "roadmap-web", "preserved", "roadmap");
    expectRoute("/workspaces/acme", "roadmap-web", "preserved", "roadmap");
    expectRoute("/auth/sign-in", "auth", "auth-only");
    expectRoute("/auth/callback", "auth", "auth-only");
    expectRoute("/login", "auth", "auth-only");
    expect(getRouteOwnership("/unknown/path")).toBeNull();
  });

  it("keeps the matrix ordered from specific module paths to broader preserved routes", () => {
    expect(listRouteOwnershipRules().map((rule) => rule.pathPrefix)).toEqual([
      "/meetings/new",
      "/meetings/:meetingId",
      "/meetings",
      "/roadmap",
      "/canvas",
      "/agents",
      "/settings",
      "/dashboard",
      "/workspaces",
      "/auth",
      "/login",
    ]);
  });
});

function expectRoute(
  pathname: string,
  owner: RouteOwner,
  compatibility: RouteCompatibility,
  moduleId?: string,
) {
  const expected: {
    owner: RouteOwner;
    compatibility: RouteCompatibility;
    moduleId?: string;
  } = {
    owner,
    compatibility,
  };

  if (moduleId) {
    expected.moduleId = moduleId;
  }

  expect(getRouteOwnership(pathname)).toMatchObject(expected);
}
