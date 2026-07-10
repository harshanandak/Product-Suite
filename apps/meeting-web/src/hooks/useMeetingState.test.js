// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useMeetingState } from "./useMeetingState";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the SDK-backed api layer: the hook fans out to these getters on mount.
const apiMocks = vi.hoisted(() => ({
  getStoredAuthToken: vi.fn(() => null),
  getMeetingStateCurrent: vi.fn(),
  getChapters: vi.fn(),
  getDecisions: vi.fn(),
  getActionItems: vi.fn(),
  getOpenQuestions: vi.fn(),
  getRecentLines: vi.fn(),
}));

vi.mock("../lib/api", () => ({ ...apiMocks }));

function renderHook(hook, ...args) {
  const result = { current: undefined };

  function Harness() {
    result.current = hook(...args);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  act(() => {
    root.render(createElement(Harness));
  });

  return {
    result,
    unmount() {
      act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
}

async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) {
    mock.mockReset();
  }
  apiMocks.getStoredAuthToken.mockReturnValue(null);
  apiMocks.getMeetingStateCurrent.mockResolvedValue({ data: { current_topic: "Pricing" } });
  apiMocks.getChapters.mockResolvedValue({ data: { chapters: [] } });
  apiMocks.getDecisions.mockResolvedValue({ data: { items: [] } });
  apiMocks.getActionItems.mockResolvedValue({ data: { items: [] } });
  apiMocks.getOpenQuestions.mockResolvedValue({ data: { items: [] } });
  apiMocks.getRecentLines.mockResolvedValue({ data: { recent_lines: [] } });
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useMeetingState", () => {
  test("loads meeting state from every SDK getter on mount", async () => {
    const { result, unmount } = renderHook(useMeetingState, "meeting-7");

    await flushMicrotasks();
    await flushMicrotasks();

    const scopedGetters = [
      apiMocks.getMeetingStateCurrent,
      apiMocks.getChapters,
      apiMocks.getDecisions,
      apiMocks.getActionItems,
      apiMocks.getOpenQuestions,
      apiMocks.getRecentLines,
    ];
    for (const getter of scopedGetters) {
      expect(getter).toHaveBeenCalledWith("meeting-7");
    }

    expect(result.current.meetingState).toEqual({ current_topic: "Pricing" });
    expect(result.current.loading).toBe(false);
    // The "Now" section is derived from the loaded meeting state.
    const nowSection = result.current.sections.find((section) => section.key === "now");
    expect(nowSection.items[0]).toEqual({ label: "Current topic", value: "Pricing" });

    unmount();
  });

  test("does not fetch when disabled", async () => {
    const { unmount } = renderHook(useMeetingState, "meeting-7", { enabled: false });

    await flushMicrotasks();

    expect(apiMocks.getMeetingStateCurrent).not.toHaveBeenCalled();
    expect(apiMocks.getRecentLines).not.toHaveBeenCalled();

    unmount();
  });

  test("clears state and skips the SDK when meetingId is missing", async () => {
    const { result, unmount } = renderHook(useMeetingState, "");

    await flushMicrotasks();

    expect(apiMocks.getMeetingStateCurrent).not.toHaveBeenCalled();
    expect(result.current.meetingState).toBeNull();
    expect(result.current.decisions).toEqual([]);
    expect(result.current.loading).toBe(false);

    unmount();
  });
});
