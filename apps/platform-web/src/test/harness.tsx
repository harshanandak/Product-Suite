import type { ReactNode } from "react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";

import { ThemeProvider } from "@product-suite/ui";

/**
 * Test helper: render UI inside a TanStack Router context + ThemeProvider.
 *
 * A `/w/$workspace` route with a splat child matches any workspace path, so
 * `useParams`, `useLocation`, and `<Link>` resolve correctly. `path` sets the
 * initial URL (default `/w/test-ws`). Lives under `src/test/` so the
 * source-test coupling gate treats it as a test helper, not source.
 */
export function renderWithRouter(
  ui: ReactNode,
  { path = "/w/test-ws" }: { path?: string } = {},
): RenderResult {
  const rootRoute = createRootRoute();
  const workspaceRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: "/w/$workspace",
    component: () => (
      <ThemeProvider defaultTheme="light">
        <Outlet />
      </ThemeProvider>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "/",
    component: () => <>{ui}</>,
  });
  const splatRoute = createRoute({
    getParentRoute: () => workspaceRoute,
    path: "$",
    component: () => <>{ui}</>,
  });
  const routeTree = rootRoute.addChildren([
    workspaceRoute.addChildren([indexRoute, splatRoute]),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  return render(<RouterProvider router={router} />);
}
