import { Link } from "@tanstack/react-router";
import { Bell, Search, Sparkles } from "lucide-react";

import { Button, ThemeToggle, cn } from "@product-suite/ui";

import { href, resolveScreen } from "./boards";
import { toast } from "./toast";
import { UserMenu } from "./UserMenu";

/**
 * Top bar (DESIGN §2): global search + Cmd+K affordance, review-queue bell,
 * "Ask agent" (opens an object-scoped agent thread tied to the current screen),
 * theme toggle, and the user menu. The breadcrumb was removed as redundant with
 * the workspace switcher + the active sidebar item (product feedback 2026-06-25).
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
  // Breadcrumb removed (redundant with the workspace switcher + active sidebar
  // item). `title` is still used to label the agent thread. DESIGN §2 lists a
  // breadcrumb here; intentional deviation per product feedback (2026-06-25).
  const { title } = resolveScreen(pathname, workspace);

  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-background px-4">
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

      <UserMenu />
    </header>
  );
}
