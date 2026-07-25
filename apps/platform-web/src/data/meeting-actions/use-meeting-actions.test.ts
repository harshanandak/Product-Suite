import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MeetingActionsRepository } from "./repository";
import type { MeetingActionCandidate } from "./types";
import {
  getDefaultMeetingActionsRepository,
  useMeetingActions,
} from "./use-meeting-actions";

function candidate(id: string, text = id): MeetingActionCandidate {
  return {
    id,
    meeting_id: "mtg_1",
    text,
    confidence: 0.7,
    promotion_reason: null,
    created_at: "2026-07-25T00:00:00.000Z",
    promotion_state: "unpromoted",
    proposal_id: null,
    work_item_id: null,
  };
}

/** A repo whose list result can be swapped between reads, to prove refetch. */
function repoWith(pages: MeetingActionCandidate[][]): MeetingActionsRepository {
  let call = 0;
  return {
    list: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]!),
  };
}

describe("useMeetingActions", () => {
  it("loads the candidates, clearing the initial loading flag on settle", async () => {
    const { result } = renderHook(() =>
      useMeetingActions({ repository: repoWith([[candidate("a", "Call Acme")]]) }),
    );

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.candidates.map((c) => c.text)).toEqual(["Call Acme"]);
    expect(result.current.error).toBeNull();
  });

  it("surfaces a failed read as an error rather than an empty list", async () => {
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => {
        throw new Error("Not a member");
      }),
    };

    const { result } = renderHook(() => useMeetingActions({ repository }));

    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("Not a member");
    expect(result.current.candidates).toEqual([]);
  });

  it("refetch re-reads the repository", async () => {
    const repository = repoWith([[candidate("a")], [candidate("a"), candidate("b")]]);
    const { result } = renderHook(() => useMeetingActions({ repository }));

    await waitFor(() => expect(result.current.candidates).toHaveLength(1));
    act(() => {
      result.current.refetch();
    });

    await waitFor(() => expect(result.current.candidates).toHaveLength(2));
    expect(repository.list).toHaveBeenCalledTimes(2);
  });
});

describe("getDefaultMeetingActionsRepository", () => {
  it("is a shared singleton, so every uninjected caller reads one store", () => {
    expect(getDefaultMeetingActionsRepository()).toBe(
      getDefaultMeetingActionsRepository(),
    );
  });
});
