import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

import { cn } from "@product-suite/ui";

import { type BoardDef, href, interpolate, normalize } from "./boards";
import { toast } from "./toast";

const ITEM_BASE =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors";

/**
 * Per-board sidebar (DESIGN §2 — the navigation law). Rendered purely from the
 * active board's config: navigating to any screen WITHIN the board yields the
 * same board → the same sidebar, so it never mutates on content clicks. Only
 * switching boards (via the dock) swaps it. Counts are stable nav metadata;
 * filters/views live in the content area, never here.
 *
 * The rail can be minimized to an icon-only strip via `onToggleCollapse`. When
 * `collapsed`, labels/counts are hidden and each item keeps an accessible name
 * through `title` + `aria-label` (the visible text otherwise supplies it).
 */
export function Sidebar({
  board,
  workspace,
  pathname,
  collapsed = false,
  pinned,
  onToggleCollapse,
}: Readonly<{
  board: BoardDef;
  workspace: string;
  pathname: string;
  collapsed?: boolean;
  /**
   * Whether the rail is pinned open — drives the toggle's label/icon. Defaults
   * to `!collapsed`; ShellLayout passes the persisted pin state explicitly so
   * the control reads "Expand" (pin) rather than "Collapse" while a collapsed
   * rail is only being hover-revealed.
   */
  pinned?: boolean;
  onToggleCollapse?: () => void;
}>) {
  const isPinned = pinned ?? !collapsed;
  return (
    <nav
      aria-label={`${board.title} navigation`}
      className="flex-1 overflow-y-auto px-2 py-3"
    >
      <div
        className={cn(
          "flex items-center gap-1 pb-2",
          collapsed ? "justify-center" : "px-2",
        )}
      >
        {collapsed ? null : (
          <p className="flex-1 truncate text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {board.title}
          </p>
        )}
        {onToggleCollapse ? (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label={isPinned ? "Collapse sidebar" : "Expand sidebar"}
            aria-expanded={isPinned}
            title={isPinned ? "Collapse sidebar" : "Expand sidebar"}
            className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          >
            {isPinned ? (
              <PanelLeftClose className="size-4" />
            ) : (
              <PanelLeftOpen className="size-4" />
            )}
          </button>
        ) : null}
      </div>
      <ul className="space-y-0.5">
        {board.items.map((item) => {
          if (item.section) {
            // A text section header is meaningless in the icon-only rail; render
            // a thin divider there to preserve the visual grouping instead.
            if (collapsed) {
              return (
                <li
                  key={item.key}
                  aria-hidden="true"
                  className="mx-2 my-2 border-t border-sidebar-border"
                />
              );
            }
            return (
              <li
                key={item.key}
                className="px-2 pb-1 pt-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
              >
                {item.label}
              </li>
            );
          }

          const Icon = item.icon;

          if (!item.to) {
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => toast(`${item.label} — not in the F1 prototype`)}
                  title={collapsed ? item.label : undefined}
                  aria-label={collapsed ? item.label : undefined}
                  className={cn(
                    ITEM_BASE,
                    "text-muted-foreground hover:bg-sidebar-accent/50",
                    collapsed && "justify-center gap-0 px-0",
                  )}
                >
                  {Icon ? <Icon className="size-4 shrink-0" /> : null}
                  {collapsed ? null : <span className="truncate">{item.label}</span>}
                </button>
              </li>
            );
          }

          const active = interpolate(item.to, workspace) === normalize(pathname);

          return (
            <li key={item.key}>
              <Link
                to={href(item.to, workspace)}
                // Exact match so only the current screen is "active": TanStack
                // Router otherwise marks ancestors active by prefix, which would
                // put aria-current="page" on several links at once (e.g. both
                // "Work items" and "Graph" on /workboard/graph). This keeps the
                // programmatic current-location unambiguous — the breadcrumb that
                // used to carry it was removed (DESIGN §2, 2026-06-25).
                activeOptions={{ exact: true }}
                data-active={active || undefined}
                title={collapsed ? item.label : undefined}
                aria-label={collapsed ? item.label : undefined}
                className={cn(
                  ITEM_BASE,
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                  collapsed && "justify-center gap-0 px-0",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" /> : null}
                {collapsed ? null : <span className="truncate">{item.label}</span>}
                {!collapsed && typeof item.count === "number" ? (
                  <span className="ml-auto rounded-full bg-muted px-1.5 text-xs text-muted-foreground">
                    {item.count}
                  </span>
                ) : null}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
