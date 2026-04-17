// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

import { SummaryFirstMeetingScreen } from "@/components/meeting/SummaryFirstMeetingScreen";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const navigateMock = vi.hoisted(() => vi.fn());

const apiMocks = vi.hoisted(() => ({
  clearAuthToken: vi.fn(),
  getCachedRuntimeConfig: vi.fn(),
  getCurrentUser: vi.fn(),
  getOnboardingState: vi.fn(),
  getStoredAuthToken: vi.fn(),
  initializeRuntimeConfig: vi.fn(),
  listMeetings: vi.fn(),
  signOutHostedSession: vi.fn(),
}));

const hostedAuthFlowMocks = vi.hoisted(() => ({
  performHostedSignOutFlow: vi.fn(),
}));

vi.mock("react-router-dom", async () => {
  const actual = await vi.importActual("react-router-dom");
  return {
    ...actual,
    useNavigate: () => navigateMock,
  };
});

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual("@/lib/api");
  return {
    ...actual,
    clearAuthToken: apiMocks.clearAuthToken,
    getCachedRuntimeConfig: apiMocks.getCachedRuntimeConfig,
    getCurrentUser: apiMocks.getCurrentUser,
    getOnboardingState: apiMocks.getOnboardingState,
    getStoredAuthToken: apiMocks.getStoredAuthToken,
    initializeRuntimeConfig: apiMocks.initializeRuntimeConfig,
    listMeetings: apiMocks.listMeetings,
    signOutHostedSession: apiMocks.signOutHostedSession,
  };
});

vi.mock("@/lib/hostedAuthFlow", async () => {
  const actual = await vi.importActual("@/lib/hostedAuthFlow");
  return {
    ...actual,
    performHostedSignOutFlow: hostedAuthFlowMocks.performHostedSignOutFlow,
  };
});

const { DashboardHomePage } = await import("@/pages/DashboardHomePage");

function mount(Component) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter>
        <Component />
      </MemoryRouter>
    );
  });

  return {
    container,
    root,
    cleanup() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flush() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("dashboard and workspace regressions", () => {
  test("shows the dashboard loading state while meetings are still loading", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: false },
      deployment_mode: "oss",
    });
    apiMocks.listMeetings.mockImplementation(() => new Promise(() => {}));

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();

    expect(container.textContent).toContain("Loading recent meetings...");
    cleanup();
  });

  test("renders recent meeting links on the dashboard", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: false },
      deployment_mode: "oss",
    });
    apiMocks.listMeetings.mockResolvedValue({
      data: [
        {
          id: "meeting-1",
          title: "Launch readiness sync",
          status: "completed",
          duration_seconds: 1800,
        },
        {
          id: "meeting-2",
          title: "Customer review",
          status: "recording",
          duration_seconds: 600,
        },
      ],
    });

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(container.textContent).toContain("Launch readiness sync");
    expect(container.textContent).toContain("Customer review");
    expect(container.querySelector('a[href="/meetings/meeting-1"]')).not.toBeNull();
    expect(container.querySelector('a[href="/meetings/meeting-2"]')).not.toBeNull();
    cleanup();
  });

  test("renders dashboard-01 style activity and table chrome for meeting data", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: false },
      deployment_mode: "oss",
    });
    apiMocks.listMeetings.mockResolvedValue({
      data: [
        {
          id: "meeting-1",
          title: "Launch readiness sync",
          status: "completed",
          duration_seconds: 1800,
          updated_at: "2026-04-13T11:00:00.000Z",
          created_at: "2026-04-13T10:00:00.000Z",
        },
      ],
    });

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(container.textContent).toContain("Meeting activity");
    expect(container.textContent).toContain("Duration");
    expect(container.textContent).toContain("Last update");
    cleanup();
  });

  test("renders the authenticated shell chrome on the dashboard", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: false },
      deployment_mode: "oss",
    });
    apiMocks.listMeetings.mockResolvedValue({ data: [] });

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(container.textContent).toContain("Meeting Agent");
    expect(container.textContent).toContain("Dashboard");
    expect(container.textContent).toContain("Meetings");
    expect(container.textContent).toContain("New meeting");
    expect(container.textContent).toContain("Recent meetings");
    cleanup();
  });

  test("shows hosted sign-out action on the dashboard when a user session is active", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: true },
      deployment_mode: "hosted",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockResolvedValue({
      data: { email: "owner@example.com" },
    });
    apiMocks.getOnboardingState.mockResolvedValue({
      data: { needs_onboarding: false },
    });
    apiMocks.listMeetings.mockResolvedValue({ data: [] });

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(container.textContent).toContain("Sign out");
    cleanup();
  });

  test("keeps the stored session when onboarding state lookup fails", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: true },
      deployment_mode: "hosted",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockResolvedValue({
      data: { email: "owner@example.com" },
    });
    apiMocks.getOnboardingState.mockRejectedValue(new Error("temporary outage"));
    apiMocks.listMeetings.mockResolvedValue({ data: [] });

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(apiMocks.clearAuthToken).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/auth/sign-in", expect.anything());
    expect(container.textContent).toContain("temporary outage");
    cleanup();
  });

  test("keeps a valid session when current user lookup fails transiently", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: true },
      deployment_mode: "hosted",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockRejectedValue(new Error("identity timeout"));

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(apiMocks.clearAuthToken).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalledWith("/auth/sign-in", expect.anything());
    expect(container.textContent).toContain("identity timeout");
    cleanup();
  });

  test("shows the empty workspace state when no meeting is selected", () => {
    const html = renderToStaticMarkup(<SummaryFirstMeetingScreen meeting={null} hasMeetingHistory />);
    expect(html).toContain("Choose a meeting to continue.");
    expect(html).toContain("Meetings workspace");
  });

  test("shows the dashboard empty state when there are no meetings yet", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: false },
      deployment_mode: "oss",
    });
    apiMocks.listMeetings.mockResolvedValue({ data: [] });

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(container.textContent).toContain("No meetings yet.");
    expect(container.textContent).toContain("Start a recording from the workspace");
    expect(container.textContent).toContain("Open workspace");
    expect(container.textContent).toContain("Review meeting history");
    cleanup();
  });

  test("keeps the OSS empty-state fallback only for localhost backend outages", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: false },
      deployment_mode: "oss",
      apiBaseUrl: "http://localhost:8000/api",
    });
    apiMocks.listMeetings.mockRejectedValue(new Error("backend offline"));

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(container.textContent).toContain("No meetings yet.");
    expect(container.textContent).not.toContain("backend offline");
    cleanup();
  });

  test("surfaces OSS network errors when the configured backend is not local", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: false },
      deployment_mode: "oss",
      apiBaseUrl: "https://api.example.com/api",
    });
    apiMocks.listMeetings.mockRejectedValue(new Error("backend offline"));

    const { container, cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(container.textContent).toContain("backend offline");
    cleanup();
  });

  test("routes hosted users into onboarding when no organization is active", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      auth: { required: true },
      deployment_mode: "hosted",
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockResolvedValue({
      data: { email: "owner@example.com" },
    });
    apiMocks.getOnboardingState.mockResolvedValue({
      data: { needs_onboarding: true },
    });

    const { cleanup } = mount(DashboardHomePage);
    await flush();
    await flush();

    expect(navigateMock).toHaveBeenCalledWith("/meetings", { replace: true });
    cleanup();
  });
});
