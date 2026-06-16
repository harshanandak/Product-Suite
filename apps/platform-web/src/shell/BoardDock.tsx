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
}: {
  workspace: string;
  activeBoard: BoardId | null;
}) {
  return (
    <nav
      aria-label="Boards"
      className="flex items-center justify-between border-t border-sidebar-border px-2 py-2"
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
