// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useRealtimeTranscript } from "./useRealtimeTranscript";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the SDK-backed api layer: the hook polls getRecentLines.
const apiMocks = vi.hoisted(() => ({
  getStoredAuthToken: vi.fn(() => null),
  getRecentLines: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getStoredAuthToken: apiMocks.getStoredAuthToken,
  getRecentLines: apiMocks.getRecentLines,
}));

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
  apiMocks.getRecentLines.mockReset();
  apiMocks.getStoredAuthToken.mockReset();
  apiMocks.getStoredAuthToken.mockReturnValue(null);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useRealtimeTranscript", () => {
  test("fetches recent lines from getRecentLines on mount and normalizes them", async () => {
    apiMocks.getRecentLines.mockResolvedValue({
      data: {
        recent_lines: [
          { id: "l2", speaker_label: "Bo", text: "Second", timestamp_start: 2 },
          { id: "l1", speaker_label: "Ada", text: "First", timestamp_start: 1 },
        ],
      },
    });

    const { result, unmount } = renderHook(useRealtimeTranscript, "meeting-9");

    await flushMicrotasks();
    await flushMicrotasks();

    expect(apiMocks.getRecentLines).toHaveBeenCalledWith("meeting-9");
    // Lines are sorted ascending by timestamp_start.
    expect(result.current.recentLines.map((line) => line.id)).toEqual(["l1", "l2"]);
    expect(result.current.recentLines[0].speaker_label).toBe("Ada");
    expect(result.current.loading).toBe(false);

    unmount();
  });

  test("does not fetch when disabled", async () => {
    const { unmount } = renderHook(useRealtimeTranscript, "meeting-9", { enabled: false });

    await flushMicrotasks();

    expect(apiMocks.getRecentLines).not.toHaveBeenCalled();

    unmount();
  });

  test("clears lines and skips the SDK when meetingId is missing", async () => {
    const { result, unmount } = renderHook(useRealtimeTranscript, "");

    await flushMicrotasks();

    expect(apiMocks.getRecentLines).not.toHaveBeenCalled();
    expect(result.current.recentLines).toEqual([]);
    expect(result.current.loading).toBe(false);

    unmount();
  });

  test("surfaces SDK errors from refresh", async () => {
    const failure = new Error("transcript backend offline");
    apiMocks.getRecentLines.mockRejectedValue(failure);

    const { result, unmount } = renderHook(useRealtimeTranscript, "meeting-9");

    await flushMicrotasks();
    await flushMicrotasks();

    expect(result.current.error).toBe(failure);

    unmount();
  });
});
