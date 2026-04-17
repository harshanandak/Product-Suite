export const HOSTED_AUTH_SIGN_IN_PATH = "/auth/sign-in";
export const HOSTED_AUTH_CALLBACK_PATH = "/auth/callback";
export const HOSTED_AUTH_SIGNED_OUT_PATH = "/auth/signed-out";

const HOSTED_POST_LOGIN_PATH_STORAGE_KEY = "meeting-agent.hosted-post-login-path";
const AUTH_ONLY_PATHS = new Set([
  HOSTED_AUTH_SIGN_IN_PATH,
  HOSTED_AUTH_CALLBACK_PATH,
  HOSTED_AUTH_SIGNED_OUT_PATH,
]);

export function normalizeHostedAuthPath(pathname = "/") {
  if (!pathname || pathname === "/") {
    return "/";
  }

  const normalizedPath = pathname.replace(/\/+$/, "");
  return normalizedPath || "/";
}

export function sanitizeSameOriginPath(candidate, fallback = "/") {
  if (!candidate) {
    return fallback;
  }

  if (typeof window === "undefined") {
    return typeof candidate === "string" && candidate.startsWith("/") ? candidate : fallback;
  }

  try {
    const parsedCandidate = new URL(candidate, window.location.origin);
    if (parsedCandidate.origin !== window.location.origin) {
      return fallback;
    }

    const pathname = normalizeHostedAuthPath(parsedCandidate.pathname);
    return `${pathname}${parsedCandidate.search}${parsedCandidate.hash}`;
  } catch {
    return fallback;
  }
}

export function resolveHostedPostLoginPath(candidate) {
  const nextPath = sanitizeSameOriginPath(candidate, "/");

  if (typeof window === "undefined") {
    return nextPath;
  }

  const parsedNextPath = new URL(nextPath, window.location.origin);
  const pathname = normalizeHostedAuthPath(parsedNextPath.pathname);
  if (AUTH_ONLY_PATHS.has(pathname)) {
    return "/";
  }

  return `${pathname}${parsedNextPath.search}${parsedNextPath.hash}`;
}

export function stripHostedAuthParams(href = typeof window !== "undefined" ? window.location.href : "/") {
  if (typeof window === "undefined") {
    return "/";
  }

  const url = new URL(href, window.location.origin);
  url.searchParams.delete("code");
  url.searchParams.delete("state");
  url.searchParams.delete("error");
  return `${normalizeHostedAuthPath(url.pathname)}${url.search}${url.hash}`;
}

export function setHostedPostLoginPath(pathname) {
  if (typeof window === "undefined") {
    return;
  }

  const resolvedPath = resolveHostedPostLoginPath(pathname);
  window.sessionStorage?.setItem(HOSTED_POST_LOGIN_PATH_STORAGE_KEY, resolvedPath);
}

export function getHostedPostLoginPath() {
  if (typeof window === "undefined") {
    return "/";
  }

  const storedPath = window.sessionStorage?.getItem(HOSTED_POST_LOGIN_PATH_STORAGE_KEY);
  return resolveHostedPostLoginPath(storedPath || "/");
}

export function clearHostedPostLoginPath() {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage?.removeItem(HOSTED_POST_LOGIN_PATH_STORAGE_KEY);
}

export function isHostedAuthOnlyPath(pathname) {
  return AUTH_ONLY_PATHS.has(normalizeHostedAuthPath(pathname));
}
