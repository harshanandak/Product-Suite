import type { PlatformModuleId } from "./module-registry";

export type RouteOwner = "platform-shell" | "roadmap-web" | "meeting-web" | "auth";

export type RouteCompatibility =
  | "shell-native"
  | "meeting-compatible"
  | "preserved"
  | "reserved"
  | "auth-only";

export type RouteOwnershipRule = Readonly<{
  pathPrefix: string;
  owner: RouteOwner;
  compatibility: RouteCompatibility;
  moduleId?: PlatformModuleId;
}>;

type RouteOwnershipSeed = readonly [
  pathPrefix: string,
  owner: RouteOwner,
  compatibility: RouteCompatibility,
  moduleId?: PlatformModuleId,
];

const routeOwnershipSeeds = [
  ["/meetings/new", "platform-shell", "meeting-compatible", "meetings"],
  ["/meetings/:meetingId", "platform-shell", "meeting-compatible", "meetings"],
  ["/meetings", "platform-shell", "shell-native", "meetings"],
  ["/roadmap", "platform-shell", "shell-native", "roadmap"],
  ["/canvas", "platform-shell", "reserved", "canvas"],
  ["/agents", "platform-shell", "reserved", "agents"],
  ["/settings", "platform-shell", "reserved", "settings"],
  ["/dashboard", "roadmap-web", "preserved", "roadmap"],
  ["/workspaces", "roadmap-web", "preserved", "roadmap"],
  ["/auth", "auth", "auth-only"],
  ["/login", "auth", "auth-only"],
  ["/signup", "auth", "auth-only"],
] as const satisfies readonly RouteOwnershipSeed[];

const routeOwnershipRules: readonly RouteOwnershipRule[] = Object.freeze(
  routeOwnershipSeeds.map(([pathPrefix, owner, compatibility, moduleId]) =>
    defineRoute({
      pathPrefix,
      owner,
      compatibility,
      ...(moduleId ? { moduleId } : {}),
    }),
  ),
);

export function listRouteOwnershipRules(): readonly RouteOwnershipRule[] {
  return routeOwnershipRules;
}

export function getRouteOwnership(pathname: string): RouteOwnershipRule | null {
  const normalizedPath = normalizePathname(pathname);

  return (
    routeOwnershipRules.find((rule) =>
      pathMatchesRule(normalizedPath, rule.pathPrefix),
    ) ?? null
  );
}

function pathMatchesRule(pathname: string, pathPrefix: string): boolean {
  if (pathPrefix.includes(":")) {
    const prefixBeforeParam = pathPrefix.slice(0, pathPrefix.indexOf("/:"));
    return pathname.startsWith(`${prefixBeforeParam}/`);
  }

  return pathname === pathPrefix || pathname.startsWith(`${pathPrefix}/`);
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

function defineRoute(rule: RouteOwnershipRule): RouteOwnershipRule {
  return Object.freeze(rule);
}
