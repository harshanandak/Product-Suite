import type { ReactNode } from "react";

import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { useOrganizationMock, authState } = vi.hoisted(() => ({
  useOrganizationMock: vi.fn(),
  authState: { signedIn: true },
}));

vi.mock("@clerk/clerk-react", () => ({
  SignedIn: ({ children }: { children: ReactNode }) =>
    authState.signedIn ? children : null,
  SignedOut: ({ children }: { children: ReactNode }) =>
    authState.signedIn ? null : children,
  RedirectToSignIn: () => <div data-testid="redirect-signin" />,
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

import {
  ActiveWorkspaceRedirect,
  WorkspaceHomeRedirect,
} from "./WorkspaceHomeRedirect";

afterEach(() => {
  authState.signedIn = true;
  useOrganizationMock.mockReset();
});

describe("ActiveWorkspaceRedirect", () => {
  it("redirects to the active org's workspace once Clerk has loaded", () => {
    useOrganizationMock.mockReturnValue({
      organization: { slug: "acme-inc" },
      isLoaded: true,
    });

    render(<ActiveWorkspaceRedirect />);

    const nav = screen.getByTestId("navigate");
    expect(nav.dataset.to).toBe("/w/$workspace");
    expect(nav.dataset.workspace).toBe("acme-inc");
  });

  it("falls back to the default workspace when there is no active org", () => {
    useOrganizationMock.mockReturnValue({ organization: null, isLoaded: true });

    render(<ActiveWorkspaceRedirect />);

    // DEFAULT_WORKSPACE ("befach-hq") — no VITE_DEFAULT_WORKSPACE in tests.
    expect(screen.getByTestId("navigate").dataset.workspace).toBe("befach-hq");
  });

  it("shows a loading state until Clerk resolves the org", () => {
    useOrganizationMock.mockReturnValue({ organization: null, isLoaded: false });

    render(<ActiveWorkspaceRedirect />);

    expect(screen.queryByTestId("navigate")).toBeNull();
    expect(screen.getByLabelText("Loading workspace")).toBeInTheDocument();
  });
});

describe("WorkspaceHomeRedirect (auth guard)", () => {
  it("routes signed-in users to their workspace (org lookup runs)", () => {
    authState.signedIn = true;
    useOrganizationMock.mockReturnValue({
      organization: { slug: "acme-inc" },
      isLoaded: true,
    });

    render(<WorkspaceHomeRedirect />);

    expect(screen.getByTestId("navigate").dataset.workspace).toBe("acme-inc");
    expect(screen.queryByTestId("redirect-signin")).toBeNull();
  });

  it("sends signed-out users to sign-in WITHOUT calling useOrganization", () => {
    authState.signedIn = false;

    render(<WorkspaceHomeRedirect />);

    expect(screen.getByTestId("redirect-signin")).toBeInTheDocument();
    expect(screen.queryByTestId("navigate")).toBeNull();
    // The whole point of the SignedIn guard: no session-less useOrganization.
    expect(useOrganizationMock).not.toHaveBeenCalled();
  });
});
