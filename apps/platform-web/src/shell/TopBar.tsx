import { Link } from "@tanstack/react-router";
import { Bell, Search, Sparkles } from "lucide-react";

import { Button, ThemeToggle, cn } from "@product-suite/ui";

import { href } from "./boards";
import { UserMenu } from "./UserMenu";

/**
 * Top bar (DESIGN §2): global search + Cmd+K affordance, review-queue bell,
 * "Ask agent" (opens the object-scoped agent chat panel — the shell owns the
 * panel's open-state + linked object so the thread persists across navigation),
 * theme toggle, and the user menu. The breadcrumb was removed as redundant with
 * the workspace switcher + the active sidebar item (product feedback 2026-06-25).
 */
export function TopBar({
  workspace,
  onOpenPalette,
  onAskAgent,
}: Readonly<{
  workspace: string;
  onOpenPalette: () => void;
  onAskAgent: () => void;
}>) {
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

      <Button variant="outline" size="sm" onClick={onAskAgent}>
        <Sparkles />
        Ask agent
      </Button>

      <ThemeToggle />

      <UserMenu />
    </header>
  );
}
