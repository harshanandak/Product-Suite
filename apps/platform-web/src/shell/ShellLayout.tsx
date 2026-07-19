import * as React from "react";
import {
  Outlet,
  useLocation,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { RedirectToSignIn, SignedIn, SignedOut, useAuth } from "@clerk/clerk-react";

import { cn } from "@product-suite/ui";

import {
  AgentChatPanel,
  type AgentChatPanelProps,
} from "@/agent-chat/AgentChatPanel";
import {
  type AgentFocusRequest,
  type AskAgent,
  AskAgentProvider,
} from "@/agent-chat/ask-agent";
import { resolveLinkedObject } from "@/agent-chat/linked-object";
import { USE_FIXTURES } from "@/fixtures-mode";
import { useTeams } from "@/data/work-items";

import { DEFAULT_WORKSPACE } from "../env";
import {
  BOARDS,
  buildWorkboardItems,
  deriveActiveBoard,
  getBoard,
  href,
} from "./boards";
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
  // DEV-ONLY fixtures/preview: render the chrome directly, treating the visitor as
  // signed-in, WITHOUT the Clerk gate (there is no ClerkProvider in preview mode).
  // USE_FIXTURES is compile-time `false` in production (see fixtures-mode.ts), so
  // this bypass is dead-code-eliminated — a production build ALWAYS renders the
  // SignedIn/SignedOut gate below and can never skip sign-in.
  if (USE_FIXTURES) {
    return <ShellChrome />;
  }
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
  // Agent chat panel open-state lifted to the shell so the panel stays mounted
  // (its ephemeral thread survives close/reopen + in-workspace navigation).
  const [agentOpen, setAgentOpen] = React.useState(false);
  // A monotonically-increasing focus request driving the panel's input focus.
  // The `nonce` bumps on every `askAgent()` call so invoking "Ask agent" while
  // the panel is ALREADY open re-focuses the input instead of no-oping (or, if
  // this only flipped a boolean, silently doing nothing on the second press).
  const [agentFocus, setAgentFocus] = React.useState<AgentFocusRequest>({
    nonce: 0,
  });
  // The ONE seam every "Ask agent" affordance funnels through (TopBar button,
  // ⌘K palette, and — soon — row context-menus / selection popovers). It only
  // ever OPENS (never toggles closed), then requests input focus, so a second
  // invocation is a no-surprise re-focus, never an accidental close. See
  // `useAskAgent` in agent-chat/ask-agent.tsx.
  const askAgent = React.useCallback<AskAgent>((options) => {
    setAgentOpen(true);
    setAgentFocus((prev) => ({ nonce: prev.nonce + 1, prompt: options?.prompt }));
  }, []);
  const [collapsed, setCollapsed] = React.useState(readSidebarCollapsed);
  // Transient reveal of a collapsed rail. Pointer and keyboard focus are tracked
  // independently and OR'd, so a stray mouse-leave can't yank a rail that still
  // holds keyboard focus (and vice versa). Not persisted — only `collapsed` is.
  const [mouseInside, setMouseInside] = React.useState(false);
  const [focusInside, setFocusInside] = React.useState(false);
  const hovering = mouseInside || focusInside;

  React.useEffect(() => {
    try {
      globalThis.localStorage?.setItem(SIDEBAR_COLLAPSED_KEY, String(collapsed));
    } catch {
      // Persisting the preference is best-effort; ignore storage failures.
    }
  }, [collapsed]);

  const toggleCollapsed = React.useCallback(() => {
    // Drop the transient reveal so a pin/unpin click made while the pointer or
    // focus is over the rail commits immediately instead of leaving it floating
    // open as an overlay; a genuine re-hover re-reveals.
    setMouseInside(false);
    setFocusInside(false);
    setCollapsed((value) => !value);
  }, []);

  const activeBoard = deriveActiveBoard(pathname, slug);
  const board = getBoard(activeBoard ?? "home");

  // The Workboard rail is dynamic: its static rows plus a TEAMS section with one
  // row per team the work items belong to. Other boards render their static
  // config unchanged. (buildWorkboardItems returns just the static rows until the
  // teams load, so the rail never flashes an empty section.)
  const { teams } = useTeams();
  const railBoard =
    activeBoard === "workboard"
      ? { ...board, items: buildWorkboardItems(teams) }
      : board;

  // Visually expanded when pinned open (not collapsed) OR while the collapsed
  // rail is hover/focus-revealed. `overlay` = revealed-but-not-pinned, so it
  // floats over the content instead of pushing it (the grid column stays 64px).
  const expanded = !collapsed || hovering;
  const overlay = collapsed && hovering;

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
    <AskAgentProvider value={askAgent}>
    <div
      className={cn(
        "grid h-screen overflow-hidden bg-background text-foreground transition-[grid-template-columns] duration-200 motion-reduce:transition-none",
        collapsed ? "grid-cols-[64px_1fr]" : "grid-cols-[220px_1fr]",
      )}
    >
      {/* The aside is the grid cell (64px collapsed / 220px pinned); the rail
          panel inside it is absolutely positioned so that, while collapsed, the
          hover-flyout grows it to 220px OVER the content (the cell stays 64px,
          so nothing reflows). Hover/focus on the aside drives `hovering`. */}
      <aside
        className="relative h-screen"
        onMouseEnter={() => setMouseInside(true)}
        onMouseLeave={() => setMouseInside(false)}
        onFocus={() => setFocusInside(true)}
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setFocusInside(false);
          }
        }}
      >
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex h-screen min-h-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width] duration-150 ease-out motion-reduce:transition-none",
            overlay && "z-50 shadow-2xl",
          )}
          style={{ width: expanded ? 220 : 64 }}
        >
          <WorkspaceSwitcher collapsed={!expanded} />
          <Sidebar
            board={railBoard}
            workspace={slug}
            pathname={pathname}
            collapsed={!expanded}
            pinned={!collapsed}
            onToggleCollapse={toggleCollapsed}
          />
          <BoardDock
            workspace={slug}
            activeBoard={activeBoard}
            collapsed={!expanded}
          />
        </div>
      </aside>
      <div className="flex min-w-0 flex-col">
        <TopBar
          workspace={slug}
          onOpenPalette={() => setPaletteOpen(true)}
          onAskAgent={() => askAgent()}
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
      {/* Kept mounted regardless of `agentOpen` so the ephemeral thread survives
          close/reopen; the linked object is captured from the current screen at
          open time (navigation never rewrites the thread's context). Keyed by
          workspace so switching org/workspace starts a fresh thread bound to the
          new tenant (a `useChat` instance ignores a rebuilt transport otherwise,
          leaking the old workspace into requests). */}
      <ShellAgentPanel
        key={slug}
        open={agentOpen}
        onClose={() => setAgentOpen(false)}
        workspace={slug}
        currentObject={resolveLinkedObject(pathname, slug)}
        focusRequest={agentFocus}
      />
    </div>
    </AskAgentProvider>
  );
}

/** The token resolver used in preview/fixtures mode — there is no real backend. */
const FIXTURES_GET_TOKEN = async (): Promise<string | null> => null;

/**
 * Wires the agent panel's Clerk-bearer token WITHOUT importing `useAuth` in a
 * path that runs under fixtures (no ClerkProvider in preview). Mirrors the
 * proposals `ProposalRepositoryProvider` split: fixtures ⇒ a null resolver;
 * otherwise the real Clerk-backed resolver in {@link ClerkAgentPanel}.
 */
function ShellAgentPanel(
  props: Readonly<Omit<AgentChatPanelProps, "getToken" | "getOrgId">>,
) {
  if (USE_FIXTURES) {
    return <AgentChatPanel {...props} getToken={FIXTURES_GET_TOKEN} />;
  }
  return <ClerkAgentPanel {...props} />;
}

/**
 * The real Clerk-backed panel: resolves the session token AND the active org id
 * per request via refs. The org id is sent as `org_id` so a user in more than one
 * org anchors the run to their current org (else the API 400s as ambiguous).
 */
function ClerkAgentPanel(
  props: Readonly<Omit<AgentChatPanelProps, "getToken" | "getOrgId">>,
) {
  const { getToken, orgId } = useAuth();
  const getTokenRef = React.useRef(getToken);
  getTokenRef.current = getToken;
  const orgIdRef = React.useRef(orgId);
  orgIdRef.current = orgId;
  const stableGetToken = React.useMemo(
    () => (): Promise<string | null> => getTokenRef.current(),
    [],
  );
  const stableGetOrgId = React.useMemo(
    () => (): string | null => orgIdRef.current ?? null,
    [],
  );
  // Remount on org change too: `key={slug}` at the shell handles a workspace
  // switch, but a Clerk org switch that leaves the slug unchanged would otherwise
  // keep the old thread + proposals mounted while getOrgId starts anchoring to the
  // NEW org — a cross-tenant exposure. Keying by orgId starts a fresh thread.
  return (
    <AgentChatPanel
      key={orgId ?? "no-org"}
      {...props}
      getToken={stableGetToken}
      getOrgId={stableGetOrgId}
    />
  );
}
