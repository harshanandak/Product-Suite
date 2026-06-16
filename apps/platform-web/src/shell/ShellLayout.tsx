import * as React from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut } from "@clerk/clerk-react";

import { DEFAULT_WORKSPACE } from "../env";
import { BOARDS, deriveActiveBoard, getBoard, href } from "./boards";
import { BoardDock } from "./BoardDock";
import { CommandPalette } from "./CommandPalette";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

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
  const { workspace } = useParams({ strict: false }) as { workspace?: string };
  const slug = workspace ?? DEFAULT_WORKSPACE;
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [paletteOpen, setPaletteOpen] = React.useState(false);

  const activeBoard = deriveActiveBoard(pathname, slug);
  const board = getBoard(activeBoard ?? "home");

  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (mod && event.key >= "1" && event.key <= "5") {
        const target = BOARDS[Number(event.key) - 1];
        if (target) {
          event.preventDefault();
          navigate({ to: href(target.entry, slug) });
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, slug]);

  return (
    <div className="grid h-screen grid-cols-[220px_1fr] overflow-hidden bg-background text-foreground">
      <aside className="flex h-screen min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
        <WorkspaceSwitcher />
        <Sidebar board={board} workspace={slug} pathname={pathname} />
        <BoardDock workspace={slug} activeBoard={activeBoard} />
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
