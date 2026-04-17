import { describe, expect, test } from "vitest";

import { resolveHostedWorkspaceStage } from "../hostedWorkspace";

describe("hosted workspace stage resolution", () => {
  test("waits for bootstrap before showing workspace content", () => {
    expect(
      resolveHostedWorkspaceStage({
        bootstrapStatus: "loading",
        isHostedMode: true,
        authStatus: "loading",
        onboardingStatus: "loading",
      })
    ).toBe("loading");
  });

  test("shows onboarding when hosted auth is complete but org context is missing", () => {
    expect(
      resolveHostedWorkspaceStage({
        bootstrapStatus: "ready",
        isHostedMode: true,
        authStatus: "authenticated",
        onboardingStatus: "required",
      })
    ).toBe("onboarding");
  });

  test("shows the app once hosted onboarding is complete", () => {
    expect(
      resolveHostedWorkspaceStage({
        bootstrapStatus: "ready",
        isHostedMode: true,
        authStatus: "authenticated",
        onboardingStatus: "complete",
      })
    ).toBe("app");
  });

  test("routes unauthenticated hosted users to auth", () => {
    expect(
      resolveHostedWorkspaceStage({
        bootstrapStatus: "ready",
        isHostedMode: true,
        authStatus: "anonymous",
        onboardingStatus: "idle",
      })
    ).toBe("auth");
  });
});
