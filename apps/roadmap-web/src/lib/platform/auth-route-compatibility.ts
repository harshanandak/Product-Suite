const protectedPlatformPrefixes = [
  "/w",
  "/meetings",
  "/roadmap",
  "/canvas",
  "/agents",
  "/settings",
] as const;

const authOnlyPrefixes = ["/auth", "/login", "/signup"] as const;

export function isProtectedPlatformRoute(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);

  return protectedPlatformPrefixes.some((prefix) =>
    matchesPrefix(normalizedPath, prefix),
  );
}

export function isAuthOnlyRoute(pathname: string): boolean {
  const normalizedPath = normalizePathname(pathname);

  return authOnlyPrefixes.some((prefix) => matchesPrefix(normalizedPath, prefix));
}

export function resolvePlatformReturnIntent(
  pathname: string,
  search = "",
): string | null {
  const normalizedPath = normalizePathname(pathname);

  if (
    normalizedPath === "/" ||
    normalizedPath.startsWith("//") ||
    isAuthOnlyRoute(normalizedPath) ||
    !isProtectedPlatformRoute(normalizedPath)
  ) {
    return null;
  }

  return `${normalizedPath}${search}`;
}

export function buildPlatformLoginRedirectPath(
  pathname: string,
  search = "",
): string {
  const returnIntent = resolvePlatformReturnIntent(pathname, search);

  if (!returnIntent) {
    return "/login";
  }

  return `/login?returnTo=${encodeURIComponent(returnIntent)}`;
}

function normalizePathname(pathname: string): string {
  const [pathOnly] = pathname.split(/[?#]/, 1);

  if (!pathOnly || pathOnly === "/") {
    return "/";
  }

  return pathOnly.endsWith("/") && pathOnly.length > 1
    ? pathOnly.slice(0, -1)
    : pathOnly;
}

function matchesPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}
