import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";

const { useSearch } = vi.hoisted(() => ({ useSearch: vi.fn() }));
vi.mock("@tanstack/react-router", () => ({ useSearch }));

// The screen is covered by WorkboardScreen.test.tsx; here it is reduced to a
// probe so this test isolates the one thing this file owns — turning the URL's
// `?project=` into the screen's scope.
vi.mock("./WorkboardScreen", () => ({
  WorkboardScreen: ({ projectId }: { projectId?: string }) => (
    <div data-testid="screen">{projectId ?? "unscoped"}</div>
  ),
}));

import { WorkboardIndexRoute } from "./WorkboardIndexRoute";

describe("WorkboardIndexRoute", () => {
  test("scopes the surface to the project in the URL", () => {
    useSearch.mockReturnValue({ project: "p_1" });
    render(<WorkboardIndexRoute />);
    expect(screen.getByTestId("screen")).toHaveTextContent("p_1");
  });

  test("renders the unscoped board when no project is in the URL", () => {
    useSearch.mockReturnValue({});
    render(<WorkboardIndexRoute />);
    expect(screen.getByTestId("screen")).toHaveTextContent("unscoped");
  });

  test("ignores an unrelated search param rather than scoping to it", () => {
    // The route drops anything it does not validate, so a stray param must not
    // reach the screen as a scope.
    useSearch.mockReturnValue({ layout: "graph" });
    render(<WorkboardIndexRoute />);
    expect(screen.getByTestId("screen")).toHaveTextContent("unscoped");
  });
});
