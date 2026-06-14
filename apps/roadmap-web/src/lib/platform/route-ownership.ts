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
  ["/w/:workspace/meetings/new", "platform-shell", "meeting-compatible", "meetings"],
  ["/w/:workspace/meetings/:meetingId", "platform-shell", "meeting-compatible", "meetings"],
  ["/w/:workspace/meetings", "platform-shell", "shell-native", "meetings"],
  ["/w/:workspace/workboard", "platform-shell", "shell-native", "roadmap"],
  ["/w/:workspace/canvas", "platform-shell", "reserved", "canvas"],
  ["/w/:workspace/agents", "platform-shell", "reserved", "agents"],
  ["/w/:workspace/settings", "platform-shell", "reserved", "settings"],
  ["/w/:workspace", "platform-shell", "shell-native"],
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
  const pathnameSegments = pathname.split("/").filter(Boolean);
  const ruleSegments = pathPrefix.split("/").filter(Boolean);

  if (ruleSegments.length > pathnameSegments.length) {
    return false;
  }

  return ruleSegments.every((segment, index) => {
    if (segment.startsWith(":")) {
      return Boolean(pathnameSegments[index]);
    }

    return pathnameSegments[index] === segment;
  });
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
