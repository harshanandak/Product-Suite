export type PlatformModuleId =
  | "meetings"
  | "roadmap"
  | "canvas"
  | "agents"
  | "settings";

export type PlatformModuleStatus = "active" | "reserved";

export type PlatformModuleDefinition = Readonly<{
  id: PlatformModuleId;
  label: string;
  shortLabel: string;
  href: `/${string}`;
  description: string;
  status: PlatformModuleStatus;
  owner: "platform-shell";
  accent: string;
  navOrder: number;
  legacyRoutePrefixes: readonly `/${string}`[];
}>;

const modules: readonly PlatformModuleDefinition[] = Object.freeze([
  defineModule({
    id: "meetings",
    label: "Meetings",
    shortLabel: "Meet",
    href: "/meetings",
    description: "Meeting preparation, capture, and follow-up workspace.",
    status: "active",
    owner: "platform-shell",
    accent: "teal",
    navOrder: 10,
    legacyRoutePrefixes: ["/meetings"] as const,
  }),
  defineModule({
    id: "roadmap",
    label: "Roadmap",
    shortLabel: "Roadmap",
    href: "/roadmap",
    description: "Product planning, backlog, and roadmap workspace.",
    status: "active",
    owner: "platform-shell",
    accent: "blue",
    navOrder: 20,
    legacyRoutePrefixes: ["/dashboard", "/workspaces", "/roadmap"] as const,
  }),
  defineModule({
    id: "canvas",
    label: "Canvas",
    shortLabel: "Canvas",
    href: "/canvas",
    description: "Shared visual canvas and structured collaboration surface.",
    status: "reserved",
    owner: "platform-shell",
    accent: "violet",
    navOrder: 30,
    legacyRoutePrefixes: ["/canvas"] as const,
  }),
  defineModule({
    id: "agents",
    label: "Agents",
    shortLabel: "Agents",
    href: "/agents",
    description: "Automation agents, runs, and operational review queues.",
    status: "reserved",
    owner: "platform-shell",
    accent: "amber",
    navOrder: 40,
    legacyRoutePrefixes: ["/agents"] as const,
  }),
  defineModule({
    id: "settings",
    label: "Settings",
    shortLabel: "Settings",
    href: "/settings",
    description: "Account, workspace, billing, and administration settings.",
    status: "reserved",
    owner: "platform-shell",
    accent: "slate",
    navOrder: 50,
    legacyRoutePrefixes: ["/settings"] as const,
  }),
]);

const modulesById = new Map<PlatformModuleId, PlatformModuleDefinition>(
  modules.map((module) => [module.id, module]),
);

export function getPlatformModules(): readonly PlatformModuleDefinition[] {
  return modules;
}

export function getPlatformModuleById(
  id: PlatformModuleId,
): PlatformModuleDefinition | undefined {
  return modulesById.get(id);
}

export function resolvePlatformModule(
  pathname: string,
): PlatformModuleDefinition | null {
  const normalizedPath = normalizePathname(pathname);

  return (
    modules.find((module) =>
      module.legacyRoutePrefixes.some((prefix) =>
        pathMatchesPrefix(normalizedPath, prefix),
      ),
    ) ?? null
  );
}

export function isPlatformModulePath(pathname: string): boolean {
  return resolvePlatformModule(pathname) !== null;
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

function pathMatchesPrefix(pathname: string, prefix: `/${string}`): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function defineModule(
  module: PlatformModuleDefinition,
): PlatformModuleDefinition {
  return Object.freeze(module);
}
