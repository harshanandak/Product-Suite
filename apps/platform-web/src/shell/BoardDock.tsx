import { Link } from "@tanstack/react-router";

import { cn } from "@product-suite/ui";

import { BOARDS, type BoardId, href } from "./boards";

/**
 * Board dock — bottom of the left rail (DESIGN §2, tier-1 navigation). The same
 * five icons in fixed order on every screen; only the highlight moves. Clicking
 * one switches the entire board (rail config + content). Maps to the mobile tab
 * bar (same icons, same order) on small screens.
 */
export function BoardDock({
  workspace,
  activeBoard,
  collapsed = false,
}: Readonly<{
  workspace: string;
  activeBoard: BoardId | null;
  collapsed?: boolean;
}>) {
  return (
    <nav
      aria-label="Boards"
      className={cn(
        // shrink-0 keeps the dock at its natural height; the flex-1 sidebar body
        // above it is the scroll region that absorbs a short viewport.
        "flex shrink-0 border-t border-sidebar-border px-2 py-2",
        // The five size-9 icons don't fit side by side in the 64px collapsed
        // rail, so stack them vertically there; spread them out when expanded.
        collapsed ? "flex-col items-center gap-1" : "items-center justify-between",
      )}
    >
      {BOARDS.map((board) => {
        const Icon = board.icon;
        const active = board.id === activeBoard;
        return (
          <Link
            key={board.id}
            to={href(board.entry, workspace)}
            aria-label={board.label}
            title={board.label}
            aria-current={active ? "page" : undefined}
            data-active={active || undefined}
            className={cn(
              "flex size-9 items-center justify-center rounded-md transition-colors",
              active
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground",
            )}
          >
            <Icon className="size-5" />
          </Link>
        );
      })}
    </nav>
  );
}
