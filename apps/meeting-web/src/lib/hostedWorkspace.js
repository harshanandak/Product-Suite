export function resolveHostedWorkspaceStage({
  bootstrapStatus,
  isHostedMode,
  authRequired,
  authStatus,
  onboardingStatus,
}) {
  if (bootstrapStatus !== "ready") {
    return "loading";
  }

  if (!isHostedMode) {
    if (authRequired && authStatus !== "authenticated") {
      return "auth";
    }
    return "app";
  }

  if (authStatus !== "authenticated") {
    return "auth";
  }

  if (onboardingStatus === "loading") {
    return "loading";
  }

  if (onboardingStatus === "required") {
    return "onboarding";
  }

  if (onboardingStatus === "error") {
    return "onboarding";
  }

  if (onboardingStatus === "refresh-required") {
    return "refresh-required";
  }

  return "app";
}
