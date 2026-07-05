import {
  Link,
  Outlet,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";

import { Button, EmptyState, ErrorState } from "@product-suite/ui";

import { WorkItemDetailScreen } from "./boards/workboard/detail/WorkItemDetailScreen";
import { WorkboardGraphScreen } from "./boards/workboard/graph/WorkboardGraphScreen";
import { WorkboardScreen } from "./boards/workboard/WorkboardScreen";
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
const homeInboxRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "inbox",
  component: BoardScreen,
});

const workboardRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard",
  // The Workboard index renders the live work-items screen; all other board
  // routes (incl. the workboard sub-routes) remain on the BoardScreen placeholder.
  component: WorkboardScreen,
});
// The Graph is a real sub-board (the full-page dependency/phase canvas), not the
// BoardScreen placeholder — it is an unbounded canvas, so it owns its own route.
const workboardGraphRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/graph",
  component: WorkboardGraphScreen,
});
// The work-item DETAIL page — a real route (not the editor Sheet) so an item has
// a durable, linkable home with room for its tabs (Overview/Tasks/…).
const workboardItemRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/item/$itemId",
  component: WorkItemDetailScreen,
});
const workboardStrategyRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/strategy",
  component: BoardScreen,
});
const workboardInsightsRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/insights",
  component: BoardScreen,
});
const workboardTasksRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/tasks",
  component: BoardScreen,
});
const workboardTriageRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/triage",
  component: BoardScreen,
});
const workboardFeedbackRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "workboard/feedback",
  component: BoardScreen,
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
    workboardRoute,
    workboardGraphRoute,
    workboardItemRoute,
    workboardStrategyRoute,
    workboardInsightsRoute,
    workboardTasksRoute,
    workboardTriageRoute,
    workboardFeedbackRoute,
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
