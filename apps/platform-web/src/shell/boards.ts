import {
  Calendar,
  Cpu,
  Frame,
  Home,
  Inbox,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Newspaper,
  Star,
  Target,
  Users,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { LinkProps } from "@tanstack/react-router";

/**
 * Single source of navigation truth (DESIGN §2 — the navigation law).
 *
 * - The bottom dock switches the whole board (tier 1).
 * - Each board owns ONE stable sidebar, rendered from this config (tier 2).
 *   Navigating to any screen WITHIN a board never mutates the sidebar — only
 *   switching boards swaps it. That invariant is enforced structurally: the
 *   sidebar is derived purely from the active board id, which is derived from
 *   the URL, so content navigation within a board yields the same sidebar.
 * - Filters/grouping/view tabs are NOT navigation; they live in the content
 *   area, never here.
 */

export type BoardId = "home" | "workboard" | "meetings" | "canvas";

/** A route target template (TanStack `to`), e.g. `/w/$workspace/workboard`. */
export type To = NonNullable<LinkProps["to"]>;

export interface SidebarItem {
  /** Stable key (also used as the sidebar `data-active` match). */
  key: string;
  label: string;
  /** Route template; absent for section headers and prototype-only stubs. */
  to?: To;
  icon?: LucideIcon;
  count?: number;
  /** Renders as an uppercase section header rather than a nav row. */
  section?: boolean;
  /** Wired in the IA but not implemented in F1 — surfaces a toast. */
  prototypeOnly?: boolean;
  /**
   * Rendered indented beneath the item directly above it, to show it belongs to
   * that item's subtree (e.g. Graph nested under Work items). Purely visual — the
   * item still lives flat in `items`, so routing, active-matching, and
   * {@link resolveScreen} titles are all unchanged.
   */
  nested?: boolean;
}

export interface BoardDef {
  id: BoardId;
  /** Title shown above the sidebar items. */
  title: string;
  /** Dock label / aria-label. */
  label: string;
  icon: LucideIcon;
  /** Board entry route (where the dock icon navigates). */
  entry: To;
  items: SidebarItem[];
}

/** A minimal reference to a Team, used to build the rail's TEAMS section. */
export interface TeamRef {
  id: string;
  name: string;
}

/**
 * The always-present workboard rows (IA redesign). `Views` went live in Phase 2
 * (the Saved Views list surface); `Projects` now lands on the real Projects board
 * (outcome containers grouped by their own status) instead of a prototype toast.
 * `My items` lands on the shared cross-team work-items surface until the
 * Clerk→Owner mapping enables a real assignee-me filter (see plan Risk 3).
 */
const WORKBOARD_STATIC_ITEMS: SidebarItem[] = [
  {
    key: "my-items",
    label: "My items",
    to: "/w/$workspace/workboard",
    icon: ListChecks,
  },
  {
    key: "views",
    label: "Views",
    to: "/w/$workspace/workboard/views",
    icon: Star,
  },
  {
    key: "projects",
    label: "Projects",
    to: "/w/$workspace/projects",
    icon: Target,
  },
];

/**
 * Build the workboard rail items: the three static rows, then — when there is at
 * least one team — a `TEAMS` section header followed by one row per team. Each
 * team row embeds its concrete id in the route at build time (`$workspace` stays
 * a template so the existing {@link href} bridge resolves it), so navigating to a
 * team scopes the items surface without mutating the rail.
 */
export function buildWorkboardItems(
  teams: ReadonlyArray<TeamRef>,
): SidebarItem[] {
  const items: SidebarItem[] = [...WORKBOARD_STATIC_ITEMS];
  if (teams.length > 0) {
    items.push({ key: "teams", label: "Teams", section: true });
    for (const team of teams) {
      items.push({
        key: `team-${team.id}`,
        label: team.name,
        to: `/w/$workspace/workboard/team/${team.id}` as To,
        icon: Users,
      });
    }
  }
  return items;
}

export const BOARDS: BoardDef[] = [
  {
    id: "home",
    title: "Home",
    label: "Home",
    icon: Home,
    entry: "/w/$workspace",
    items: [
      { key: "digest", label: "Digest", to: "/w/$workspace", icon: Newspaper },
      {
        key: "review",
        label: "Review queue",
        to: "/w/$workspace/review",
        icon: Inbox,
        count: 4,
      },
      {
        key: "chat",
        label: "Chat",
        to: "/w/$workspace/inbox",
        icon: MessageSquare,
        count: 2,
      },
    ],
  },
  {
    id: "workboard",
    title: "Workboard",
    label: "Workboard",
    icon: LayoutGrid,
    entry: "/w/$workspace/workboard",
    items: [...WORKBOARD_STATIC_ITEMS],
  },
  {
    id: "meetings",
    title: "Meeting board",
    label: "Meeting board",
    icon: Video,
    entry: "/w/$workspace/meetings",
    items: [
      {
        key: "all-meetings",
        label: "All meetings",
        to: "/w/$workspace/meetings",
        icon: Video,
      },
      {
        key: "this-week",
        label: "This week",
        to: "/w/$workspace/meetings/week",
        icon: Calendar,
      },
      {
        key: "action-items",
        label: "Action items",
        to: "/w/$workspace/meetings/actions",
        icon: ListChecks,
        count: 4,
      },
      {
        key: "triage-queue",
        label: "Triage queue",
        to: "/w/$workspace/meetings/triage",
        icon: Inbox,
        count: 2,
      },
      { key: "processing", label: "Processing", section: true },
      {
        key: "jobs",
        label: "Jobs",
        to: "/w/$workspace/meetings/jobs",
        icon: Cpu,
        count: 1,
      },
    ],
  },
  {
    id: "canvas",
    title: "Canvas board",
    label: "Canvas board",
    icon: Frame,
    entry: "/w/$workspace/canvas",
    items: [
      {
        key: "all-canvases",
        label: "All canvases",
        to: "/w/$workspace/canvas",
        icon: Frame,
      },
      {
        key: "starred",
        label: "Starred",
        to: "/w/$workspace/canvas/starred",
        icon: Star,
      },
      {
        key: "shared",
        label: "Shared with me",
        to: "/w/$workspace/canvas/shared",
        icon: Users,
      },
    ],
  },
];

export function getBoard(id: BoardId): BoardDef {
  const board = BOARDS.find((b) => b.id === id);
  if (!board) throw new Error(`Unknown board: ${id}`);
  return board;
}

/** Interpolate a `$workspace` route template into a concrete pathname. */
export function interpolate(to: string, workspace: string): string {
  // split/join (not String.replace) so a "$" in the slug is inserted literally
  // rather than interpreted as a replacement-pattern token ($&, $$, $`).
  return to.split("$workspace").join(workspace);
}

/**
 * Resolve a `$workspace` template into a concrete, typed Link/navigate target.
 * Centralizes the single assertion needed to bridge the config-driven (dynamic)
 * targets to TanStack Router's typed `to` — every nav surface passes a resolved
 * path, so no per-call `params` are required.
 */
export function href(template: To, workspace: string): To {
  return interpolate(template, workspace) as To;
}

/** Human-readable workspace name from a slug, e.g. `befach-hq` → `Befach HQ`. */
export function workspaceDisplayName(slug: string): string {
  const name = slug
    .split("-")
    .filter(Boolean)
    .map((part) =>
      part.length <= 2 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1),
    )
    .join(" ");
  return name || slug;
}

export function normalize(pathname: string): string {
  // Trim trailing slashes without a backtracking-prone regex (keeps "/" as-is).
  let end = pathname.length;
  while (end > 1 && pathname.codePointAt(end - 1) === 47 /* "/" */) {
    end -= 1;
  }
  return pathname.slice(0, end);
}

/**
 * Derive the active board from the URL. Returns null for non-board surfaces
 * (settings, unknown). This is the function that keeps the sidebar stable: the
 * board id depends only on the path's first segment, so every screen within a
 * board resolves to the same board → the same sidebar.
 */
export function deriveActiveBoard(
  pathname: string,
  workspace: string,
): BoardId | null {
  const base = `/w/${workspace}`;
  const path = normalize(pathname);
  if (path !== base && !path.startsWith(`${base}/`)) return null;
  const rest = path.slice(base.length).replace(/^\/+/, "");
  const segment = rest.split("/")[0] ?? "";
  switch (segment) {
    case "":
    case "review":
    case "inbox":
      return "home";
    case "workboard":
      return "workboard";
    case "meetings":
      return "meetings";
    case "canvas":
      return "canvas";
    default:
      return null;
  }
}

export interface ResolvedScreen {
  board: BoardDef | null;
  /** The active sidebar item, if the path maps to one. */
  item: SidebarItem | null;
  /** Display title for the current screen (top-bar agent thread + board screen). */
  title: string;
}

/**
 * Resolve the current screen for titles and active highlighting.
 *
 * `extraItems` are merged into the item match so dynamically-built rows (e.g. the
 * per-team workboard rows from {@link buildWorkboardItems}, which are not in the
 * static {@link BoardDef.items}) still title their screen — ShellLayout passes the
 * merged rail items here.
 */
export function resolveScreen(
  pathname: string,
  workspace: string,
  extraItems: ReadonlyArray<SidebarItem> = [],
): ResolvedScreen {
  const path = normalize(pathname);
  if (path === `/w/${workspace}/settings`) {
    return { board: null, item: null, title: "Settings" };
  }
  const boardId = deriveActiveBoard(path, workspace);
  const board = boardId ? getBoard(boardId) : null;
  if (!board) {
    return { board: null, item: null, title: "Home" };
  }
  const item =
    [...board.items, ...extraItems].find(
      (entry) => entry.to && interpolate(entry.to, workspace) === path,
    ) ?? null;
  return { board, item, title: item?.label ?? board.title };
}
