import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Controllable environment flags read by AppRoot's branching.
const envState = vi.hoisted(() => ({ fixtures: false, hasKey: true }));
vi.mock("./fixtures-mode", () => ({
  get USE_FIXTURES() {
    return envState.fixtures;
  },
}));
vi.mock("./env", () => ({
  CLERK_PUBLISHABLE_KEY: "pk_test",
  hasClerkKey: () => envState.hasKey,
}));

// Light stand-ins for the heavy providers / router / auth so AppRoot's branch
// selection is assertable without a real backend, Clerk, or route tree. Each
// pass-through is inlined in its factory (vi.mock hoists above module scope).
vi.mock("@clerk/clerk-react", () => ({
  ClerkProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="clerk">{children}</div>
  ),
}));
vi.mock("@tanstack/react-router", () => ({
  RouterProvider: () => <div data-testid="router" />,
}));
vi.mock("./router", () => ({ router: {} }));
vi.mock("./shell/SetupNotice", () => ({
  SetupNotice: () => <div data-testid="setup-notice" />,
}));
vi.mock("./data/memories", () => ({
  MemoriesProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./data/memory-impact", () => ({
  MemoryImpactProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./data/proposals", () => ({
  ProposalRepositoryProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./data/work-items/RepositoryProvider", () => ({
  RepositoryProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { AppRoot } from "./AppRoot";

afterEach(() => {
  envState.fixtures = false;
  envState.hasKey = true;
});

describe("AppRoot", () => {
  it("fixtures/preview mode → renders the router WITHOUT the Clerk gate", () => {
    envState.fixtures = true;
    render(<AppRoot />);
    expect(screen.getByTestId("router")).toBeInTheDocument();
    expect(screen.queryByTestId("clerk")).not.toBeInTheDocument();
    expect(screen.queryByTestId("setup-notice")).not.toBeInTheDocument();
  });

  it("no Clerk key configured → renders the setup notice (not the app)", () => {
    envState.fixtures = false;
    envState.hasKey = false;
    render(<AppRoot />);
    expect(screen.getByTestId("setup-notice")).toBeInTheDocument();
    expect(screen.queryByTestId("router")).not.toBeInTheDocument();
  });

  it("Clerk key present → renders the Clerk-gated app tree", () => {
    envState.fixtures = false;
    envState.hasKey = true;
    render(<AppRoot />);
    expect(screen.getByTestId("clerk")).toBeInTheDocument();
    expect(screen.getByTestId("router")).toBeInTheDocument();
    expect(screen.queryByTestId("setup-notice")).not.toBeInTheDocument();
  });
});
