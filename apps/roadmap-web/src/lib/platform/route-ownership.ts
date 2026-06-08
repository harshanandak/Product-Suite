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

const routeOwnershipRules: readonly RouteOwnershipRule[] = Object.freeze([
  defineRoute({
    pathPrefix: "/meetings/new",
    owner: "platform-shell",
    compatibility: "meeting-compatible",
    moduleId: "meetings",
  }),
  defineRoute({
    pathPrefix: "/meetings/:meetingId",
    owner: "platform-shell",
    compatibility: "meeting-compatible",
    moduleId: "meetings",
  }),
  defineRoute({
    pathPrefix: "/meetings",
    owner: "platform-shell",
    compatibility: "shell-native",
    moduleId: "meetings",
  }),
  defineRoute({
    pathPrefix: "/roadmap",
    owner: "platform-shell",
    compatibility: "shell-native",
    moduleId: "roadmap",
  }),
  defineRoute({
    pathPrefix: "/canvas",
    owner: "platform-shell",
    compatibility: "reserved",
    moduleId: "canvas",
  }),
  defineRoute({
    pathPrefix: "/agents",
    owner: "platform-shell",
    compatibility: "reserved",
    moduleId: "agents",
  }),
  defineRoute({
    pathPrefix: "/settings",
    owner: "platform-shell",
    compatibility: "reserved",
    moduleId: "settings",
  }),
  defineRoute({
    pathPrefix: "/dashboard",
    owner: "roadmap-web",
    compatibility: "preserved",
    moduleId: "roadmap",
  }),
  defineRoute({
    pathPrefix: "/workspaces",
    owner: "roadmap-web",
    compatibility: "preserved",
    moduleId: "roadmap",
  }),
  defineRoute({
    pathPrefix: "/auth",
    owner: "auth",
    compatibility: "auth-only",
  }),
  defineRoute({
    pathPrefix: "/login",
    owner: "auth",
    compatibility: "auth-only",
  }),
]);

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
