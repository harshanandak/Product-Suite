import { Link } from "@tanstack/react-router";

import { cn } from "@product-suite/ui";

import { BOARDS, type BoardId, href } from "./boards";

/**
 * Board dock — bottom of the left rail (DESIGN §2, tier-1 navigation). Expanded,
 * it's the five boards in fixed order with only the highlight moving. Collapsed
 * (the resting icon rail), it shows ONLY the active board as an indicator; the
 * other four are revealed when the rail expands (hover/pin) — so the rail stays
 * calm at rest without a dropdown. Clicking a board switches the whole board.
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
  // At rest the dock is a single active-board indicator; expanded it's the full
  // row. Filtering (rather than hiding via CSS) keeps the collapsed accessibility
  // tree to just the current board.
  const boards = collapsed
    ? BOARDS.filter((board) => board.id === activeBoard)
    : BOARDS;
  return (
    <nav
      aria-label="Boards"
      className={cn(
        // shrink-0 keeps the dock at its natural height; the flex-1 sidebar body
        // above it is the scroll region that absorbs a short viewport.
        "flex shrink-0 border-t border-sidebar-border px-2 py-2",
        collapsed ? "items-center justify-center" : "items-center justify-between",
      )}
    >
      {boards.map((board) => {
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
