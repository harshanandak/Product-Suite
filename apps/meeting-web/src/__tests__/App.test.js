import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  bootstrapHostedIdentitySession,
  performHostedSignOutFlow,
  retryHostedOnboardingFlow,
  shouldRedirectHostedAnonymousUser,
  shouldReturnHostedUserToPostLoginPath,
  startHostedGoogleSignInFlow,
} from "../lib/hostedAuthFlow";

describe("App hosted auth helpers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  test("redirects anonymous hosted users away from workspace routes", () => {
    expect(
      shouldRedirectHostedAnonymousUser({
        authStatus: "anonymous",
        isHostedSignInRoute: false,
        isHostedCallbackRoute: false,
        isHostedSignedOutRoute: false,
      })
    ).toBe(true);

    expect(
      shouldRedirectHostedAnonymousUser({
        authStatus: "anonymous",
        isHostedSignInRoute: true,
        isHostedCallbackRoute: false,
        isHostedSignedOutRoute: false,
      })
    ).toBe(false);
  });

  test("returns authenticated hosted users to their saved destination", () => {
    expect(
      shouldReturnHostedUserToPostLoginPath({
        authStatus: "authenticated",
        isHostedSignInRoute: true,
        isHostedCallbackRoute: false,
      })
    ).toBe(true);

    expect(
      shouldReturnHostedUserToPostLoginPath({
        authStatus: "authenticated",
        isHostedSignInRoute: false,
        isHostedCallbackRoute: false,
      })
    ).toBe(false);
  });

  test("completes hosted bootstrap and restores the saved route after onboarding is complete", async () => {
    const completeHostedSessionExchange = vi.fn().mockResolvedValue({ access_token: "app-token" });
    const refreshOnboardingState = vi.fn().mockResolvedValue({ needs_onboarding: false });
    const resetLocalSession = vi.fn();
    const clearPostLoginPath = vi.fn();
    const replaceBrowserPath = vi.fn();
    const readPostLoginPath = vi.fn().mockReturnValue("/meetings/alpha");

    const result = await bootstrapHostedIdentitySession({
      completeHostedSessionExchange,
      refreshOnboardingState,
      resetLocalSession,
      clearPostLoginPath,
      replaceBrowserPath,
      readPostLoginPath,
      isHostedSignInRoute: true,
      isHostedCallbackRoute: false,
    });

    expect(result).toEqual({ status: "exchanged", onboardingState: { needs_onboarding: false } });
    expect(refreshOnboardingState).toHaveBeenCalledWith(true);
    expect(clearPostLoginPath).toHaveBeenCalledTimes(1);
    expect(replaceBrowserPath).toHaveBeenCalledWith("/meetings/alpha");
    expect(resetLocalSession).not.toHaveBeenCalled();
  });

  test("keeps hosted users in onboarding when organization setup is still required", async () => {
    const clearPostLoginPath = vi.fn();
    const replaceBrowserPath = vi.fn();

    const result = await bootstrapHostedIdentitySession({
      completeHostedSessionExchange: vi.fn().mockResolvedValue({ access_token: "app-token" }),
      refreshOnboardingState: vi.fn().mockResolvedValue({ needs_onboarding: true }),
      resetLocalSession: vi.fn(),
      clearPostLoginPath,
      replaceBrowserPath,
      readPostLoginPath: vi.fn().mockReturnValue("/meetings/alpha"),
      isHostedSignInRoute: true,
      isHostedCallbackRoute: false,
    });

    expect(result).toEqual({ status: "exchanged", onboardingState: { needs_onboarding: true } });
    expect(clearPostLoginPath).not.toHaveBeenCalled();
    expect(replaceBrowserPath).not.toHaveBeenCalled();
  });

  test("resets the hosted session and returns callback failures to sign-in", async () => {
    const resetLocalSession = vi.fn();
    const clearPostLoginPath = vi.fn();
    const replaceBrowserPath = vi.fn();
    const formatError = vi.fn().mockReturnValue("Hosted sign-in failed");

    const result = await bootstrapHostedIdentitySession({
      completeHostedSessionExchange: vi.fn().mockRejectedValue(new Error("exchange failed")),
      refreshOnboardingState: vi.fn(),
      resetLocalSession,
      clearPostLoginPath,
      replaceBrowserPath,
      readPostLoginPath: vi.fn(),
      isHostedSignInRoute: false,
      isHostedCallbackRoute: true,
      formatError,
    });

    expect(result.status).toBe("error");
    expect(resetLocalSession).toHaveBeenCalledWith("Hosted sign-in failed");
    expect(clearPostLoginPath).toHaveBeenCalledTimes(1);
    expect(replaceBrowserPath).toHaveBeenCalledWith("/auth/sign-in");
  });

  test("captures the intended destination and Neon callback URL for Google sign-in", async () => {
    const writePostLoginPath = vi.fn();
    const signInHostedWithGoogle = vi.fn().mockResolvedValue(undefined);

    const callbackUrl = await startHostedGoogleSignInFlow({
      search: "?next=/meetings/bravo",
      origin: "https://meeting-agent.example.com",
      readPostLoginPath: vi.fn().mockReturnValue("/"),
      writePostLoginPath,
      signInHostedWithGoogle,
    });

    expect(writePostLoginPath).toHaveBeenCalledWith("/meetings/bravo");
    expect(signInHostedWithGoogle).toHaveBeenCalledWith(
      "https://meeting-agent.example.com/auth/callback"
    );
    expect(callbackUrl).toBe("https://meeting-agent.example.com/auth/callback");
  });

  test("sign-out clears local state and lands on the dedicated signed-out page", async () => {
    const signOutHostedSession = vi.fn().mockResolvedValue(undefined);
    const resetLocalSession = vi.fn();
    const resetWorkspaceState = vi.fn();
    const clearPostLoginPath = vi.fn();
    const replaceBrowserPath = vi.fn();

    await performHostedSignOutFlow({
      isHostedMode: true,
      signOutHostedSession,
      resetLocalSession,
      resetWorkspaceState,
      clearPostLoginPath,
      replaceBrowserPath,
    });

    expect(signOutHostedSession).toHaveBeenCalledTimes(1);
    expect(resetLocalSession).toHaveBeenCalledTimes(1);
    expect(resetWorkspaceState).toHaveBeenCalledTimes(1);
    expect(clearPostLoginPath).toHaveBeenCalledTimes(1);
    expect(replaceBrowserPath).toHaveBeenCalledWith("/auth/signed-out");
  });

  test("retrying onboarding clears stale errors before refreshing state", async () => {
    const clearOnboardingError = vi.fn();
    const refreshOnboardingState = vi.fn().mockResolvedValue({ needs_onboarding: true });

    const result = await retryHostedOnboardingFlow({
      clearOnboardingError,
      refreshOnboardingState,
    });

    expect(clearOnboardingError).toHaveBeenCalledWith("");
    expect(refreshOnboardingState).toHaveBeenCalledWith(true);
    expect(result).toEqual({ needs_onboarding: true });
  });
});
