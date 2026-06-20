import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const useOrganizationMock = vi.fn();

vi.mock("@clerk/clerk-react", () => ({
  useOrganization: () => useOrganizationMock(),
}));

// Stub Navigate so we can assert the redirect target without a live router.
vi.mock("@tanstack/react-router", () => ({
  Navigate: (props: { to: string; params: { workspace: string } }) => (
    <div
      data-testid="navigate"
      data-to={props.to}
      data-workspace={props.params.workspace}
    />
  ),
}));

import { WorkspaceHomeRedirect } from "./WorkspaceHomeRedirect";

describe("WorkspaceHomeRedirect", () => {
  it("redirects to the active org's workspace once Clerk has loaded", () => {
    useOrganizationMock.mockReturnValue({
      organization: { slug: "acme-inc" },
      isLoaded: true,
    });

    render(<WorkspaceHomeRedirect />);

    const nav = screen.getByTestId("navigate");
    expect(nav.getAttribute("data-to")).toBe("/w/$workspace");
    expect(nav.getAttribute("data-workspace")).toBe("acme-inc");
  });

  it("falls back to the default workspace when there is no active org", () => {
    useOrganizationMock.mockReturnValue({ organization: null, isLoaded: true });

    render(<WorkspaceHomeRedirect />);

    // DEFAULT_WORKSPACE ("befach-hq") — no VITE_DEFAULT_WORKSPACE in tests.
    expect(screen.getByTestId("navigate").getAttribute("data-workspace")).toBe(
      "befach-hq",
    );
  });

  it("shows a loading state until Clerk resolves the session", () => {
    useOrganizationMock.mockReturnValue({ organization: null, isLoaded: false });

    render(<WorkspaceHomeRedirect />);

    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.getByLabelText("Loading workspace")).toBeInTheDocument();
  });
});
