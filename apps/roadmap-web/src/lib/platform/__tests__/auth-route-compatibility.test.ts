import { describe, expect, it } from "vitest";

import {
  buildPlatformLoginRedirectPath,
  isAuthOnlyRoute,
  isProtectedPlatformRoute,
  resolvePlatformReturnIntent,
} from "../auth-route-compatibility";

describe("platform auth route compatibility", () => {
  it("marks platform module routes as protected return-intent candidates", () => {
    expect(isProtectedPlatformRoute("/w/acme")).toBe(true);
    expect(isProtectedPlatformRoute("/w/acme/workboard")).toBe(true);
    expect(isProtectedPlatformRoute("/w/acme/meetings")).toBe(true);
    expect(isProtectedPlatformRoute("/meetings")).toBe(true);
    expect(isProtectedPlatformRoute("/meetings/new")).toBe(true);
    expect(isProtectedPlatformRoute("/roadmap")).toBe(true);
    expect(isProtectedPlatformRoute("/canvas")).toBe(true);
    expect(isProtectedPlatformRoute("/agents")).toBe(true);
    expect(isProtectedPlatformRoute("/settings")).toBe(true);
    expect(isProtectedPlatformRoute("/auth/callback")).toBe(false);
  });

  it("keeps auth-only paths out of post-login return intent", () => {
    expect(isAuthOnlyRoute("/auth/sign-in")).toBe(true);
    expect(isAuthOnlyRoute("/auth/callback")).toBe(true);
    expect(isAuthOnlyRoute("/login")).toBe(true);
    expect(resolvePlatformReturnIntent("/auth/callback", "?returnTo=/meetings")).toBeNull();
    expect(resolvePlatformReturnIntent("//evil.example.com", "")).toBeNull();
  });

  it("builds same-origin module login redirects", () => {
    expect(buildPlatformLoginRedirectPath("/w/acme/meetings", "?tab=upcoming")).toBe(
      "/login?returnTo=%2Fw%2Facme%2Fmeetings%3Ftab%3Dupcoming",
    );
    expect(buildPlatformLoginRedirectPath("/meetings", "?tab=upcoming")).toBe(
      "/login?returnTo=%2Fmeetings%3Ftab%3Dupcoming",
    );
    expect(buildPlatformLoginRedirectPath("/auth/callback", "?code=abc")).toBe(
      "/login",
    );
  });
});
