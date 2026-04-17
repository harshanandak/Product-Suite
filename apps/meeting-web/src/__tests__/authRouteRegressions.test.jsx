// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  clearAuthToken: vi.fn(),
  exchangeHostedSession: vi.fn(),
  getCachedRuntimeConfig: vi.fn(),
  getCurrentUser: vi.fn(),
  getHostedIdentityToken: vi.fn(),
  getHostedSession: vi.fn(),
  getOnboardingState: vi.fn(),
  getStoredAuthToken: vi.fn(),
  initializeRuntimeConfig: vi.fn(),
  listMeetings: vi.fn(),
  loginUser: vi.fn(),
  registerUser: vi.fn(),
  setAuthToken: vi.fn(),
  signInHostedWithEmail: vi.fn(),
  signInHostedWithGoogle: vi.fn(),
  signUpHostedWithEmail: vi.fn(),
}));

const navigateMock = vi.hoisted(() => vi.fn());
const locationStateMock = vi.hoisted(() => ({
  search: "",
  state: {},
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual("@/lib/api");
  return {
    ...actual,
    clearAuthToken: apiMocks.clearAuthToken,
    exchangeHostedSession: apiMocks.exchangeHostedSession,
    getCachedRuntimeConfig: apiMocks.getCachedRuntimeConfig,
    getCurrentUser: apiMocks.getCurrentUser,
    getHostedIdentityToken: apiMocks.getHostedIdentityToken,
    getHostedSession: apiMocks.getHostedSession,
    getOnboardingState: apiMocks.getOnboardingState,
    getStoredAuthToken: apiMocks.getStoredAuthToken,
    initializeRuntimeConfig: apiMocks.initializeRuntimeConfig,
    listMeetings: apiMocks.listMeetings,
    loginUser: apiMocks.loginUser,
    registerUser: apiMocks.registerUser,
    setAuthToken: apiMocks.setAuthToken,
    signInHostedWithEmail: apiMocks.signInHostedWithEmail,
    signInHostedWithGoogle: apiMocks.signInHostedWithGoogle,
    signUpHostedWithEmail: apiMocks.signUpHostedWithEmail,
  };
});

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useLocation: () => locationStateMock,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/hostedAuthFlow", async () => {
  const actual = await vi.importActual("@/lib/hostedAuthFlow");
  return {
    ...actual,
    startHostedGoogleSignInFlow: vi.fn(),
  };
});

const routerModule = await import("../app/router");
const { WorkspaceShellFallback } = await import("../pages/WorkspaceShellFallback");

const { createAppRouter } = routerModule;

function renderPath(pathname) {
  const router = createMemoryRouter(createAppRouter(), {
    initialEntries: [pathname],
  });

  return renderToStaticMarkup(<RouterProvider router={router} />);
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
  locationStateMock.search = "";
  locationStateMock.state = {};
});

describe("auth and route regressions", () => {
  test("redirects authenticated users away from the sign-in route", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { provider: "local", required: true },
      deployment_mode: "oss",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockResolvedValue({ data: { id: "user-1" } });
    apiMocks.getOnboardingState.mockResolvedValue({ data: { needs_onboarding: false } });
    apiMocks.listMeetings.mockResolvedValue({ data: [] });

    const signInRoute = createAppRouter().find((route) => route.path === "/auth/sign-in");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(signInRoute.element);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(navigateMock).toHaveBeenCalledWith("/app", { replace: true });
    act(() => {
      root.unmount();
    });
  });

  test("redirects to the app when auth is disabled", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { provider: "local", required: false },
      deployment_mode: "oss",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("");

    const signInRoute = createAppRouter().find((route) => route.path === "/auth/sign-in");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(signInRoute.element);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(navigateMock).toHaveBeenCalledWith("/app", { replace: true });
    act(() => {
      root.unmount();
    });
  });

  test("restores the requested destination for non-hosted sign-ins", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { provider: "local", required: true },
      deployment_mode: "oss",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockResolvedValue({ data: { id: "user-1" } });
    locationStateMock.search = "?next=/meetings/demo-meeting";

    const signInRoute = createAppRouter().find((route) => route.path === "/auth/sign-in");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(signInRoute.element);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(navigateMock).toHaveBeenCalledWith("/meetings/demo-meeting", { replace: true });
    act(() => {
      root.unmount();
    });
  });

  test("keeps the stored token when current-user lookup fails transiently", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { provider: "local", required: true },
      deployment_mode: "oss",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockRejectedValue(new Error("auth bootstrap timeout"));

    const signInRoute = createAppRouter().find((route) => route.path === "/auth/sign-in");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(signInRoute.element);
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
      await new Promise((resolve) => {
        setTimeout(resolve, 0);
      });
    });

    expect(apiMocks.clearAuthToken).not.toHaveBeenCalled();
    expect(container.textContent).toContain("auth bootstrap timeout");
    act(() => {
      root.unmount();
    });
  });

  test("renders the signed-out confirmation route", () => {
    const html = renderPath("/auth/signed-out");
    expect(html).toContain("Session closed");
    expect(html).toContain("You are signed out.");
    expect(html).toContain("Return to sign-in");
    expect(html).toContain("Back to landing page");
  });

  test("renders the meetings route fallback shell", () => {
    const html = renderPath("/meetings");
    expect(html).toContain("Loading meetings...");
    expect(html).toContain("Preparing recent meetings, search, and open threads.");
    expect(html).toContain("Meeting history");
  });

  test("renders the meeting workspace route fallback shell", () => {
    const html = renderPath("/meetings/demo-meeting");
    expect(html).toContain("Opening meeting workspace...");
    expect(html).toContain("Restoring the selected meeting, transcript, summary, and action panels.");
    expect(html).toContain("Focused workspace");
  });

  test("renders the workspace load failure shell with recovery copy", () => {
    const html = renderToStaticMarkup(
      <WorkspaceShellFallback
        title="Failed to load workspace"
        description="The workspace bundle could not be loaded. Refresh the page to retry."
        highlights={["Transcript", "Live summary", "Decisions"]}
      />
    );

    expect(html).toContain("Failed to load workspace");
    expect(html).toContain("Refresh the page to retry.");
    expect(html).toContain("Live summary");
  });
});
