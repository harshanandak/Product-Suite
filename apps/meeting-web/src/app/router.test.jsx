import { describe, expect, test } from "vitest";

import { createAppRouter, meetingRouteCompatibility } from "./router";

describe("meeting app router contract", () => {
  test("keeps standalone routes and platform shell compatibility metadata", () => {
    expect(createAppRouter().map((route) => route.path)).toEqual([
      "/",
      "/auth/sign-in",
      "/auth/callback",
      "/auth/signed-out",
      "/app",
      "/meetings",
      "/meetings/new",
      "/meetings/:meetingId",
    ]);
    expect(meetingRouteCompatibility.platformShellBasePath).toBe("/meetings");
    expect(meetingRouteCompatibility.preservesStandaloneRoutes).toBe(true);
  });
});
