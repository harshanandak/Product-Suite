import {
  clearAuthToken,
  exchangeHostedSession,
  getOnboardingState,
  getHostedIdentityToken,
  getHostedSession,
  setAuthToken,
} from "@/lib/api";
import { clearHostedPostLoginPath, getHostedPostLoginPath, sanitizeSameOriginPath } from "@/lib/hostedAuthRoutes";

export function describeRequestError(error, fallbackMessage) {
  return error?.response?.data?.detail || error?.message || fallbackMessage;
}

export async function completeHostedExchange() {
  const session = await getHostedSession();
  const sessionUser = session?.data?.user || session?.user || null;

  if (!sessionUser) {
    return null;
  }

  const providerToken = await getHostedIdentityToken();
  if (!providerToken) {
    throw new Error("Hosted session token is unavailable");
  }

  const exchange = await exchangeHostedSession(providerToken);
  setAuthToken(exchange?.data?.access_token || "");
  return exchange?.data || null;
}

export async function resolvePostAuthPath() {
  let needsOnboarding = false;

  try {
    const onboardingResponse = await getOnboardingState();
    needsOnboarding = Boolean(onboardingResponse?.data?.needs_onboarding);
  } catch {
    needsOnboarding = false;
  }

  const storedPath = getHostedPostLoginPath();
  const fallbackPath = needsOnboarding ? "/meetings" : "/app";
  const nextPath = sanitizeSameOriginPath(storedPath, fallbackPath);
  clearHostedPostLoginPath();

  return nextPath === "/" ? fallbackPath : nextPath;
}

export function clearAuthAndPostLoginState() {
  clearAuthToken();
  clearHostedPostLoginPath();
}
