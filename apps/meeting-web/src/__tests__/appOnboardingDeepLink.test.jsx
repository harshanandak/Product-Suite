// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, test, vi } from "vitest";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const apiMocks = vi.hoisted(() => ({
  acceptOrganizationInvite: vi.fn(),
  clearAuthToken: vi.fn(),
  createMeeting: vi.fn(),
  createOrganization: vi.fn(),
  deleteMeeting: vi.fn(),
  getCachedRuntimeConfig: vi.fn(),
  getChatHistory: vi.fn(),
  getCurrentUser: vi.fn(),
  getHealth: vi.fn(),
  getMeeting: vi.fn(),
  getOnboardingState: vi.fn(),
  getStoredAuthToken: vi.fn(),
  getSummary: vi.fn(),
  getTranscript: vi.fn(),
  initializeRuntimeConfig: vi.fn(),
  listEngines: vi.fn(),
  listMeetings: vi.fn(),
  searchTranscripts: vi.fn(),
  setAuthToken: vi.fn(),
  signOutHostedSession: vi.fn(),
  transcribeAudio: vi.fn(),
  updateMeeting: vi.fn(),
}));

vi.mock("@/lib/api", async () => {
  const actual = await vi.importActual("@/lib/api");
  return {
    ...actual,
    acceptOrganizationInvite: apiMocks.acceptOrganizationInvite,
    clearAuthToken: apiMocks.clearAuthToken,
    createMeeting: apiMocks.createMeeting,
    createOrganization: apiMocks.createOrganization,
    deleteMeeting: apiMocks.deleteMeeting,
    getCachedRuntimeConfig: apiMocks.getCachedRuntimeConfig,
    getChatHistory: apiMocks.getChatHistory,
    getCurrentUser: apiMocks.getCurrentUser,
    getHealth: apiMocks.getHealth,
    getMeeting: apiMocks.getMeeting,
    getOnboardingState: apiMocks.getOnboardingState,
    getStoredAuthToken: apiMocks.getStoredAuthToken,
    getSummary: apiMocks.getSummary,
    getTranscript: apiMocks.getTranscript,
    initializeRuntimeConfig: apiMocks.initializeRuntimeConfig,
    listEngines: apiMocks.listEngines,
    listMeetings: apiMocks.listMeetings,
    searchTranscripts: apiMocks.searchTranscripts,
    setAuthToken: apiMocks.setAuthToken,
    signOutHostedSession: apiMocks.signOutHostedSession,
    transcribeAudio: apiMocks.transcribeAudio,
    updateMeeting: apiMocks.updateMeeting,
  };
});

vi.mock("@/hooks/useMeetingState", () => ({
  useMeetingState: () => ({
    refresh: vi.fn(),
  }),
}));

vi.mock("@/hooks/useBuddyAgent", () => ({
  useBuddyAgent: () => ({
    response: null,
    loading: false,
    error: null,
    askBuddy: vi.fn(),
  }),
}));

vi.mock("@/hooks/useAudioRecorder", () => ({
  useAudioRecorder: () => ({
    isRecording: false,
    isPaused: false,
    elapsedSeconds: 0,
    startRecording: vi.fn(),
    pauseRecording: vi.fn(),
    resumeRecording: vi.fn(),
    stopRecording: vi.fn(),
  }),
}));

vi.mock("@/components/MeetingHistory", () => ({
  MeetingHistory: () => <div>Meeting history</div>,
}));

vi.mock("@/components/meeting/SummaryFirstMeetingScreen", () => ({
  SummaryFirstMeetingScreen: ({ meeting }) => <div>{meeting?.title || "No meeting selected"}</div>,
}));

vi.mock("@/lib/hostedAuthFlow", async () => {
  const actual = await vi.importActual("@/lib/hostedAuthFlow");
  return {
    ...actual,
    performHostedSignOutFlow: vi.fn(),
    retryHostedOnboardingFlow: vi.fn(),
  };
});

vi.mock("@/lib/transcriptionSync", () => ({
  syncSummaryStateAfterTranscriptionChunk: vi.fn(),
}));

const { default: App } = await import("@/App");

function mountApp(initialEntry) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);

  act(() => {
    root.render(
      <MemoryRouter initialEntries={[initialEntry]}>
        <Routes>
          <Route path="/meetings/:meetingId" element={<App />} />
        </Routes>
      </MemoryRouter>
    );
  });

  return {
    container,
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

describe("App onboarding deep link behavior", () => {
  test("keeps the route-selected meeting after hosted onboarding completes", async () => {
    apiMocks.getCachedRuntimeConfig.mockReturnValue(null);
    apiMocks.initializeRuntimeConfig.mockResolvedValue({
      deployment_mode: "hosted",
      auth: {
        required: true,
        provider: "neon",
      },
    });
    apiMocks.getStoredAuthToken.mockReturnValue("token-123");
    apiMocks.getCurrentUser.mockResolvedValue({
      data: { id: "user-1", email: "user@example.com" },
    });
    apiMocks.getOnboardingState.mockResolvedValue({
      data: { needs_onboarding: true },
    });
    apiMocks.listEngines.mockResolvedValue({
      data: {
        engines: [
          { id: "whisper", status: "available" },
          { id: "sarvam", status: "available" },
        ],
      },
    });
    apiMocks.getHealth.mockResolvedValue({
      data: {
        openai_configured: true,
        sarvam_configured: true,
      },
    });
    apiMocks.createOrganization.mockResolvedValue({
      data: {
        organization: { id: "org-1", name: "Acme Team" },
        access_token: "new-token",
        user: { id: "user-1", email: "user@example.com" },
      },
    });
    apiMocks.listMeetings.mockResolvedValue({ data: [] });
    apiMocks.getMeeting.mockResolvedValue({
      data: { id: "meeting-42", title: "Deep-linked meeting", engine: "whisper", status: "completed" },
    });
    apiMocks.getTranscript.mockResolvedValue({ data: { segments: [] } });
    apiMocks.getSummary.mockResolvedValue({ data: {} });
    apiMocks.getChatHistory.mockResolvedValue({ data: { messages: [] } });

    const { container, cleanup } = mountApp("/meetings/meeting-42");
    await flush();
    await flush();

    const nameInput = container.querySelector("#org-name");
    expect(nameInput).not.toBeNull();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      valueSetter.call(nameInput, "Acme Team");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      nameInput.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const form = container.querySelector("form");
    expect(form).not.toBeNull();

    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(apiMocks.createOrganization).toHaveBeenCalled();
    expect(apiMocks.getMeeting).toHaveBeenCalledWith("meeting-42");

    cleanup();
  });
});
