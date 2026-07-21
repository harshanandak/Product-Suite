import { Link } from "@tanstack/react-router";
import { Bell, Search, Sparkles } from "lucide-react";

import { Button, ThemeToggle, cn } from "@product-suite/ui";

import { useProposals } from "@/data/proposals";

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
  // Pending-proposal count for the launcher badge. TopBar renders under the
  // shell's ProposalRepositoryProvider, so the hook resolves the tenant repo.
  // While the first load is in flight we show nothing (no phantom "0" flicker);
  // the count only appears once real pending proposals have settled.
  const { proposals, isLoading } = useProposals();
  const pendingCount = isLoading ? 0 : proposals.length;

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

      {/* Relative wrapper so the unread-style count badge can float in the
          button's top-right corner without disturbing its layout. The badge is
          a SIBLING of the button (not a child), so the button's accessible name
          stays "Ask agent" while the badge carries its own label. */}
      <div className="relative">
        <Button variant="outline" size="sm" onClick={onAskAgent}>
          <Sparkles />
          Ask agent
        </Button>
        {pendingCount > 0 && (
          <span
            aria-label={`${pendingCount} pending proposal${pendingCount === 1 ? "" : "s"}`}
            className={cn(
              "pointer-events-none absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[0.625rem] font-semibold leading-none text-primary-foreground",
            )}
          >
            {pendingCount > 9 ? "9+" : pendingCount}
          </span>
        )}
      </div>

      <ThemeToggle />

      <UserMenu />
    </header>
  );
}
