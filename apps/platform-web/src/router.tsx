import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";

import { Button, EmptyState, ErrorState } from "@product-suite/ui";

import { InboxScreen } from "./boards/inbox/InboxScreen";
import { MemoryScreen } from "./boards/memory/MemoryScreen";
import { WorkItemDetailScreen } from "./boards/workboard/detail/WorkItemDetailScreen";
import {
  WORKBOARD_LAYOUTS,
  type WorkboardLayout,
} from "./boards/workboard/filter-state";
import { WorkboardViewsScreen } from "./boards/workboard/views/WorkboardViewsScreen";
import {
  TeamItemsScreen,
  WorkboardScreen,
} from "./boards/workboard/WorkboardScreen";
import { BoardScreen } from "./shell/BoardScreen";
import { ShellLayout } from "./shell/ShellLayout";
import { SignInPage } from "./shell/SignInPage";
import { WorkspaceHomeRedirect } from "./shell/WorkspaceHomeRedirect";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <EmptyState
        title="Page not found"
        description="That route does not exist in the shell."
        action={
          <Link to="/">
            <Button variant="outline" size="sm">
              Back to Home
            </Button>
          </Link>
        }
      />
    </div>
  ),
});

const signInRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/sign-in",
  component: SignInPage,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: WorkspaceHomeRedirect,
});

const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/w/$workspace",
  component: ShellLayout,
});

// Content routes. All render the generic BoardScreen placeholder in F1; each is
// replaced by real board content in Phase 1. Defined explicitly (not mapped) so
// the route tree — and therefore typed `to` targets — stay precise.
const homeIndexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  component: BoardScreen,
});
const homeReviewRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "review",
  component: BoardScreen,
});
// The review inbox renders the live proposals screen (list + detail pane); all
// other home board routes remain on the BoardScreen placeholder.
const homeInboxRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "inbox",
  component: InboxScreen,
  // `?proposal=<id>` deep-links a specific proposal's detail pane (the target of
  // the chat panel's "Review in Inbox →"). Validated to a string or dropped, so a
  // junk value degrades to the default (first-proposal) selection, never a crash.
  validateSearch: (search: Record<string, unknown>): { proposal?: string } =>
    typeof search.proposal === "string" ? { proposal: search.proposal } : {},
});

// The Memory brain (Decision Log). `?new` (the command-palette "Log a decision"
// action) auto-opens the capture form; validated to a boolean or dropped, so a
// junk value degrades to the form closed, never a crash.
const memoryRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "memory",
  component: MemoryScreen,
  validateSearch: (search: Record<string, unknown>): { new?: boolean } =>
    search.new ? { new: true } : {},
});

const workboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard",
  // The Workboard index renders the live work-items screen; all other board
  // routes (incl. the workboard sub-routes) remain on the BoardScreen placeholder.
  // `?layout=` is an optional deep-link seed for the initial Layout (used by the
  // legacy /workboard/graph redirect); unknown values are dropped.
  validateSearch: (
    search: Record<string, unknown>,
  ): { layout?: WorkboardLayout } =>
    typeof search.layout === "string" &&
    (WORKBOARD_LAYOUTS as readonly string[]).includes(search.layout)
      ? { layout: search.layout as WorkboardLayout }
      : {},
  component: WorkboardScreen,
});
// Graph is now a Layout of the single work-items surface (chosen via the
// toolbar's Layout menu), not a standalone screen. This old path stays only to
// redirect legacy `/workboard/graph` links onto that surface, landing on the
// Graph layout via `?layout=graph` so a deep link still opens the graph.
const workboardGraphRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/graph",
  beforeLoad: ({ params }) => {
    throw redirect({
      to: "/w/$workspace/workboard",
      params,
      search: { layout: "graph" },
    });
  },
});
// Saved Views list surface (Phase 2) — the named Layout×Group×Filter×Sort combos
// the workboard toolbar saves. Applying one writes its config to the workboard's
// storage key and navigates back to the work-items surface, which restores it.
const workboardViewsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/views",
  component: WorkboardViewsScreen,
});
// The work-item DETAIL page — a real route (not the editor Sheet) so an item has
// a durable, linkable home with room for its tabs (Overview/Tasks/…).
const workboardItemRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/item/$itemId",
  component: WorkItemDetailScreen,
});
// Team-scoped items surface — the SAME work-items screen, pre-filtered to one
// team by TeamItemsScreen (which reads $teamId from the URL).
const workboardTeamRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/team/$teamId",
  component: TeamItemsScreen,
});

const meetingsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "meetings",
  component: BoardScreen,
});
const meetingsWeekRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "meetings/week",
  component: BoardScreen,
});
const meetingsActionsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "meetings/actions",
  component: BoardScreen,
});
const meetingsTriageRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "meetings/triage",
  component: BoardScreen,
});
const meetingsJobsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "meetings/jobs",
  component: BoardScreen,
});

const canvasRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "canvas",
  component: BoardScreen,
});
const canvasStarredRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "canvas/starred",
  component: BoardScreen,
});
const canvasSharedRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "canvas/shared",
  component: BoardScreen,
});

const agentsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "agents",
  component: BoardScreen,
});
const agentsApprovalsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "agents/approvals",
  component: BoardScreen,
});
const agentsConnectorsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "agents/connectors",
  component: BoardScreen,
});
const agentsHistoryRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "agents/history",
  component: BoardScreen,
});

const settingsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "settings",
  component: BoardScreen,
});

const routeTree = rootRoute.addChildren([
  signInRoute,
  indexRoute,
  workspaceRoute.addChildren([
    homeIndexRoute,
    homeReviewRoute,
    homeInboxRoute,
    memoryRoute,
    workboardRoute,
    workboardGraphRoute,
    workboardViewsRoute,
    workboardItemRoute,
    workboardTeamRoute,
    meetingsRoute,
    meetingsWeekRoute,
    meetingsActionsRoute,
    meetingsTriageRoute,
    meetingsJobsRoute,
    canvasRoute,
    canvasStarredRoute,
    canvasSharedRoute,
    agentsRoute,
    agentsApprovalsRoute,
    agentsConnectorsRoute,
    agentsHistoryRoute,
    settingsRoute,
  ]),
]);

export const router = createRouter({
  routeTree,
  defaultPreload: "intent",
  scrollRestoration: true,
  defaultPendingComponent: () => (
    <output className="block space-y-3 p-6" aria-label="Loading">
      <div className="h-6 w-40 animate-pulse rounded-md bg-muted" />
      <div className="h-32 w-full animate-pulse rounded-lg bg-muted" />
    </output>
  ),
  defaultErrorComponent: ({ error }) => (
    <div className="flex min-h-screen items-center justify-center bg-background p-6">
      <ErrorState
        title="Something went wrong"
        description={error instanceof Error ? error.message : "Unexpected error."}
      />
    </div>
  ),
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
