import { describe, expect, it } from "vitest";

import {
  getRouteOwnership,
  listRouteOwnershipRules,
  type RouteCompatibility,
  type RouteOwner,
} from "../route-ownership";

describe("platform route ownership", () => {
  it("classifies platform module routes with owners, module IDs, and compatibility behavior", () => {
    expectRoute("/w/acme/meetings", "platform-shell", "shell-native", "meetings");
    expectRoute("/w/acme/meetings/new", "platform-shell", "meeting-compatible", "meetings");
    expectRoute(
      "/w/acme/meetings/meeting_123",
      "platform-shell",
      "meeting-compatible",
      "meetings",
    );
    expectRoute("/w/acme/workboard", "platform-shell", "shell-native", "roadmap");
    expectRoute("/w/acme/canvas", "platform-shell", "reserved", "canvas");
    expectRoute("/w/acme/agents", "platform-shell", "reserved", "agents");
    expectRoute("/w/acme/settings", "platform-shell", "reserved", "settings");
    expectRoute("/w/acme", "platform-shell", "shell-native");
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
    expectRoute("/signup", "auth", "auth-only");
    expect(getRouteOwnership("/unknown/path")).toBeNull();
  });

  it("keeps the matrix ordered from specific module paths to broader preserved routes", () => {
    expect(listRouteOwnershipRules().map((rule) => rule.pathPrefix)).toEqual([
      "/w/:workspace/meetings/new",
      "/w/:workspace/meetings/:meetingId",
      "/w/:workspace/meetings",
      "/w/:workspace/workboard",
      "/w/:workspace/canvas",
      "/w/:workspace/agents",
      "/w/:workspace/settings",
      "/w/:workspace",
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
      "/signup",
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
