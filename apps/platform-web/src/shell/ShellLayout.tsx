import * as React from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/clerk-react";

import { cn } from "@product-suite/ui";

import { DEFAULT_WORKSPACE } from "../env";
import { BOARDS, deriveActiveBoard, getBoard, href } from "./boards";
import { BoardDock } from "./BoardDock";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

// Sidebar collapse is a per-user UI preference, persisted across reloads so the
// rail stays the way the user left it. Reads are wrapped because localStorage can
// throw (private mode / disabled storage); we fall back to the expanded rail.
const SIDEBAR_COLLAPSED_KEY = "ps:sidebar-collapsed";

function readSidebarCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
  } catch {
    return false;
  }
}

/**
 * The Zen shell (DESIGN §2). Auth-gated: signed-out users are redirected to the
 * Clerk sign-in route; signed-in users get the stable chrome. The chrome is a
 * left rail (workspace switcher / board sidebar / board dock) and a main column
 * (top bar + content Outlet). Per the navigation law the rail never mutates on
 * content clicks — the sidebar is derived purely from the URL-derived board.
 */
export function ShellLayout() {
  return (
    <>
      <SignedIn>
        <ShellChrome />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </>
  );
}

function ShellChrome() {
  const { workspace } = useParams({ strict: false });
  const slug = workspace ?? DEFAULT_WORKSPACE;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = React.useState(false);
  const [collapsed, setCollapsed] = React.useState(readSidebarCollapsed);

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Persisting the preference is best-effort; ignore storage failures.
    }
  }, [collapsed]);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed((value) => !value);
  }, []);

  const activeBoard = deriveActiveBoard(pathname, slug);
  const board = getBoard(activeBoard ?? "home");

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const node = event.target as HTMLElement | null;
      if (
        node &&
        (node.tagName === "INPUT" ||
          node.tagName === "TEXTAREA" ||
          node.isContentEditable)
      ) {
        return;
      }
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (mod && !paletteOpen && event.key >= "1" && event.key <= "5") {
        const board = BOARDS[Number(event.key) - 1];
        if (board) {
          event.preventDefault();
          navigate({ to: href(board.entry, slug) });
        }
      }
    }
    globalThis.addEventListener("keydown", onKey);
    return () => globalThis.removeEventListener("keydown", onKey);
  }, [navigate, slug, paletteOpen]);

  return (
    <div
      className={cn(
        "grid h-screen overflow-hidden bg-background text-foreground transition-[grid-template-columns] duration-200",
        collapsed ? "grid-cols-[64px_1fr]" : "grid-cols-[220px_1fr]",
      )}
    >
      <aside className="flex h-screen min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <WorkspaceSwitcher collapsed={collapsed} />
        <Sidebar
          board={board}
          workspace={slug}
          pathname={pathname}
          collapsed={collapsed}
          onToggleCollapse={toggleCollapsed}
        />
        <BoardDock
          workspace={slug}
          activeBoard={activeBoard}
          collapsed={collapsed}
        />
      </aside>
      <div className="flex min-w-0 flex-col">
        <TopBar
          workspace={slug}
          pathname={pathname}
          onOpenPalette={() => setPaletteOpen(true)}
        />
        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
      <CommandPalette
        open={paletteOpen}
        onOpenChange={setPaletteOpen}
        workspace={slug}
      />
    </div>
  );
}
