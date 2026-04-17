import {
  HOSTED_AUTH_CALLBACK_PATH,
  HOSTED_AUTH_SIGN_IN_PATH,
  HOSTED_AUTH_SIGNED_OUT_PATH,
} from "./hostedAuthRoutes";

export function shouldRedirectHostedAnonymousUser({
  authStatus,
  isHostedSignInRoute,
  isHostedCallbackRoute,
  isHostedSignedOutRoute,
}) {
  return (
    authStatus === "anonymous" &&
    !isHostedSignInRoute &&
    !isHostedCallbackRoute &&
    !isHostedSignedOutRoute
  );
}

export function shouldReturnHostedUserToPostLoginPath({
  authStatus,
  isHostedSignInRoute,
  isHostedCallbackRoute,
}) {
  return authStatus === "authenticated" && (isHostedSignInRoute || isHostedCallbackRoute);
}

export async function bootstrapHostedIdentitySession({
  completeHostedSessionExchange,
  refreshOnboardingState,
  resetLocalSession,
  clearPostLoginPath,
  replaceBrowserPath,
  readPostLoginPath,
  isHostedSignInRoute,
  isHostedCallbackRoute,
  formatError,
}) {
  try {
    const exchangeData = await completeHostedSessionExchange();
    if (!exchangeData) {
      resetLocalSession();
      return { status: "missing-session" };
    }

    const onboardingState = await refreshOnboardingState(true);
    if (!onboardingState?.needs_onboarding && (isHostedSignInRoute || isHostedCallbackRoute)) {
      const nextPath = readPostLoginPath();
      clearPostLoginPath();
      replaceBrowserPath(nextPath);
    }

    return { status: "exchanged", onboardingState };
  } catch (error) {
    resetLocalSession(formatError(error, "Hosted sign-in failed"));
    clearPostLoginPath();
    if (isHostedCallbackRoute) {
      replaceBrowserPath(HOSTED_AUTH_SIGN_IN_PATH);
    }
    return { status: "error", error };
  }
}

export async function performHostedSignOutFlow({
  isHostedMode,
  signOutHostedSession,
  resetLocalSession,
  resetWorkspaceState,
  clearPostLoginPath,
  replaceBrowserPath,
  logError = console.error,
}) {
  if (isHostedMode) {
    try {
      await signOutHostedSession();
    } catch (error) {
      logError("Failed to close hosted identity session:", error);
    }
  }

  resetLocalSession();
  resetWorkspaceState();
  clearPostLoginPath();
  replaceBrowserPath(HOSTED_AUTH_SIGNED_OUT_PATH);
}

export async function startHostedGoogleSignInFlow({
  search = "",
  origin,
  readPostLoginPath,
  writePostLoginPath,
  signInHostedWithGoogle,
}) {
  const signInParams = new URLSearchParams(search);
  writePostLoginPath(signInParams.get("next") || readPostLoginPath());
  const callbackUrl = `${origin}${HOSTED_AUTH_CALLBACK_PATH}`;
  await signInHostedWithGoogle(callbackUrl);
  return callbackUrl;
}

export async function retryHostedOnboardingFlow({
  clearOnboardingError,
  refreshOnboardingState,
}) {
  clearOnboardingError("");
  return refreshOnboardingState(true);
}
