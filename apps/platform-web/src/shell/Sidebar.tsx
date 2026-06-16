import { Link } from "@tanstack/react-router";

import { cn } from "@product-suite/ui";

import { type BoardDef, href, interpolate } from "./boards";
import { toast } from "./toast";

const ITEM_BASE =
  "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors";

/**
 * Per-board sidebar (DESIGN §2 — the navigation law). Rendered purely from the
 * active board's config: navigating to any screen WITHIN the board yields the
 * same board → the same sidebar, so it never mutates on content clicks. Only
 * switching boards (via the dock) swaps it. Counts are stable nav metadata;
 * filters/views live in the content area, never here.
 */
export function Sidebar({
  board,
  workspace,
  pathname,
}: Readonly<{
  board: BoardDef;
  workspace: string;
  pathname: string;
}>) {
  return (
    <nav
      aria-label={`${board.title} navigation`}
      className="flex-1 overflow-y-auto px-2 py-3"
    >
      <p className="px-2 pb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {board.title}
      </p>
      <ul className="space-y-0.5">
        {board.items.map((item) => {
          if (item.section) {
            return (
              <li
                key={item.key}
                className="px-2 pb-1 pt-3 text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground"
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
                  className={cn(ITEM_BASE, "text-muted-foreground hover:bg-sidebar-accent/50")}
                >
                  {Icon ? <Icon className="size-4 shrink-0" /> : null}
                  <span className="truncate">{item.label}</span>
                </button>
              </li>
            );
          }

          const active = interpolate(item.to, workspace) === pathname;

          return (
            <li key={item.key}>
              <Link
                to={href(item.to, workspace)}
                data-active={active || undefined}
                className={cn(
                  ITEM_BASE,
                  active
                    ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-sidebar-accent/50",
                )}
              >
                {Icon ? <Icon className="size-4 shrink-0" /> : null}
                <span className="truncate">{item.label}</span>
                {typeof item.count === "number" ? (
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
