import { Link } from "@tanstack/react-router";
import { UserButton } from "@clerk/clerk-react";
import { Bell, Search, Sparkles } from "lucide-react";

import { Button, ThemeToggle, cn } from "@product-suite/ui";

import { href, resolveScreen, workspaceDisplayName } from "./boards";
import { toast } from "./toast";

/**
 * Top bar (DESIGN §2): breadcrumb (workspace / board / screen), global search +
 * Cmd+K affordance, review-queue bell, "Ask agent" (opens an object-scoped
 * agent thread tied to the breadcrumb), theme toggle, and the user menu.
 */
export function TopBar({
  workspace,
  pathname,
  onOpenPalette,
}: Readonly<{
  workspace: string;
  pathname: string;
  onOpenPalette: () => void;
}>) {
  const { board, title } = resolveScreen(pathname, workspace);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 items-center gap-1.5 text-sm text-muted-foreground"
      >
        <span className="truncate">{workspaceDisplayName(workspace)}</span>
        {board ? (
          <>
            <span aria-hidden="true">/</span>
            <Link
              to={href(board.entry, workspace)}
              className="truncate hover:text-foreground"
            >
              {board.label}
            </Link>
          </>
        ) : null}
        <span aria-hidden="true">/</span>
        <span className="truncate font-medium text-foreground">{title}</span>
      </nav>

      <div className="flex-1" />

      <button
        type="button"
        onClick={onOpenPalette}
        aria-label="Open command palette"
        className={cn(
          "hidden items-center gap-2 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:flex",
        )}
      >
        <Search className="size-3.5" />
        <span>Search</span>
        <kbd className="rounded bg-muted px-1 font-mono text-xs">⌘K</kbd>
      </button>

      <Link
        to={href("/w/$workspace/review", workspace)}
        aria-label="Review queue"
        title="Review queue"
        className="flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
      >
        <Bell className="size-4" />
      </Link>

      <Button
        variant="outline"
        size="sm"
        onClick={() => toast(`Agent thread opened — linked to: ${title}`)}
      >
        <Sparkles />
        Ask agent
      </Button>

      <ThemeToggle />

      <UserButton afterSignOutUrl="/sign-in" />
    </header>
  );
}
