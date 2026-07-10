// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { useBuddyAgent } from "./useBuddyAgent";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Mock the SDK-backed api layer so the hook never performs a real network call.
const apiMocks = vi.hoisted(() => ({
  getStoredAuthToken: vi.fn(() => null),
  queryBuddy: vi.fn(),
}));

vi.mock("../lib/api", () => ({
  getStoredAuthToken: apiMocks.getStoredAuthToken,
  queryBuddy: apiMocks.queryBuddy,
}));

// Minimal renderHook using the repo's react-dom/client + act pattern. The hook
// is passed by (lowercase) reference so it is invoked inside a real component.
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

beforeEach(() => {
  apiMocks.queryBuddy.mockReset();
  apiMocks.getStoredAuthToken.mockReset();
  apiMocks.getStoredAuthToken.mockReturnValue(null);
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("useBuddyAgent", () => {
  test("askBuddy queries the buddy SDK method with the meeting id and mapped context", async () => {
    apiMocks.queryBuddy.mockResolvedValue({
      data: {
        response: { answer: "We ship Friday.", source_kind: "meeting", stub: false },
      },
    });

    const { result, unmount } = renderHook(useBuddyAgent, "meeting-42");

    let returned;
    await act(async () => {
      returned = await result.current.askBuddy("What did we decide?", {
        decisions: [{ text: "Ship on Friday" }],
      });
    });

    expect(apiMocks.queryBuddy).toHaveBeenCalledTimes(1);
    const [meetingId, body] = apiMocks.queryBuddy.mock.calls[0];
    expect(meetingId).toBe("meeting-42");
    expect(body.message).toBe("What did we decide?");
    expect(body.currentContext).toContain("Ship on Friday");
    expect(body.historyContext).toBe("");

    // The SDK payload is unwrapped and mapped for the caller and hook state.
    expect(returned.answer).toBe("We ship Friday.");
    expect(returned.isStub).toBe(false);
    expect(result.current.response.answer).toBe("We ship Friday.");

    unmount();
  });

  test("askBuddy throws and never calls the SDK when meetingId is missing", async () => {
    const { result, unmount } = renderHook(useBuddyAgent, "");

    let error;
    await act(async () => {
      try {
        await result.current.askBuddy("Anything?");
      } catch (caught) {
        error = caught;
      }
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("meetingId is required");
    expect(apiMocks.queryBuddy).not.toHaveBeenCalled();

    unmount();
  });

  test("askBuddy surfaces SDK errors and records them on the hook", async () => {
    const failure = new Error("buddy backend offline");
    apiMocks.queryBuddy.mockRejectedValue(failure);

    const { result, unmount } = renderHook(useBuddyAgent, "meeting-42");

    let error;
    await act(async () => {
      try {
        await result.current.askBuddy("What now?");
      } catch (caught) {
        error = caught;
      }
    });

    expect(error).toBe(failure);
    expect(result.current.error).toBe(failure);
    expect(apiMocks.queryBuddy).toHaveBeenCalledTimes(1);

    unmount();
  });
});
