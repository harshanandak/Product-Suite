import {
  Activity,
  Bot,
  Calendar,
  Cpu,
  Frame,
  History,
  Home,
  Inbox,
  LayoutGrid,
  Lightbulb,
  ListChecks,
  ListTodo,
  MessageSquare,
  Newspaper,
  Plug,
  Plus,
  ShieldCheck,
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

export type BoardId = "home" | "workboard" | "meetings" | "canvas" | "agents";

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
    items: [
      {
        key: "work-items",
        label: "Work items",
        to: "/w/$workspace/workboard",
        icon: ListChecks,
      },
      {
        key: "strategy",
        label: "Strategy",
        to: "/w/$workspace/workboard/strategy",
        icon: Target,
      },
      {
        key: "insights",
        label: "Insights",
        to: "/w/$workspace/workboard/insights",
        icon: Lightbulb,
        count: 2,
      },
      {
        key: "tasks",
        label: "Tasks",
        to: "/w/$workspace/workboard/tasks",
        icon: ListTodo,
      },
      {
        key: "triage",
        label: "Triage",
        to: "/w/$workspace/workboard/triage",
        icon: Inbox,
        count: 2,
      },
      { key: "intake", label: "Intake", section: true },
      {
        key: "feedback",
        label: "Feedback",
        to: "/w/$workspace/workboard/feedback",
        icon: MessageSquare,
        count: 3,
      },
    ],
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
  {
    id: "agents",
    title: "Agent board",
    label: "Agent board",
    icon: Bot,
    entry: "/w/$workspace/agents",
    items: [
      {
        key: "runs",
        label: "Runs",
        to: "/w/$workspace/agents",
        icon: Activity,
      },
      {
        key: "approvals",
        label: "Approvals",
        to: "/w/$workspace/agents/approvals",
        icon: ShieldCheck,
        count: 1,
      },
      {
        key: "connectors",
        label: "Connectors",
        to: "/w/$workspace/agents/connectors",
        icon: Plug,
      },
      {
        key: "history",
        label: "Action history",
        to: "/w/$workspace/agents/history",
        icon: History,
      },
      { key: "your-agents", label: "Your agents", section: true },
      {
        key: "sourcing-scout",
        label: "sourcing-scout",
        icon: Bot,
        prototypeOnly: true,
      },
      { key: "qa-bot", label: "qa-bot", icon: Bot, prototypeOnly: true },
      { key: "new-agent", label: "New agent…", icon: Plus, prototypeOnly: true },
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
  return to.replace("$workspace", workspace);
}

/**
 * Resolve a `$workspace` template into a concrete, typed Link/navigate target.
 * Centralizes the single assertion needed to bridge the config-driven (dynamic)
 * targets to TanStack Router's typed `to` — every nav surface passes a resolved
 * path, so no per-call `params` are required.
 */
export function href(template: string, workspace: string): To {
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

function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/")) {
    return pathname.replace(/\/+$/, "");
  }
  return pathname;
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
    case "agents":
      return "agents";
    default:
      return null;
  }
}

export interface ResolvedScreen {
  board: BoardDef | null;
  /** The active sidebar item, if the path maps to one. */
  item: SidebarItem | null;
  /** Breadcrumb title for the current screen. */
  title: string;
}

/** Resolve the current screen for breadcrumbs and active highlighting. */
export function resolveScreen(
  pathname: string,
  workspace: string,
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
    board.items.find(
      (entry) => entry.to && interpolate(entry.to, workspace) === path,
    ) ?? null;
  return { board, item, title: item?.label ?? board.title };
}
