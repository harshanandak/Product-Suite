import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MeetingActionsRepository } from "./repository";
import type { MeetingActionCandidate, MeetingSyncSummary } from "./types";
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

const EMPTY_SUMMARY: MeetingSyncSummary = {
  proposalsCreated: 0,
  skippedDuplicate: 0,
  skippedUnmappedTenant: 0,
};

/** A repo whose list result can be swapped between reads, to prove refetch. */
function repoWith(pages: MeetingActionCandidate[][]): MeetingActionsRepository {
  let call = 0;
  return {
    list: vi.fn(async () => pages[Math.min(call++, pages.length - 1)]!),
    sync: vi.fn(async () => ({
      proposalsCreated: 0,
      skippedDuplicate: 0,
      skippedUnmappedTenant: 0,
    })),
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
      list: vi.fn(async (): Promise<MeetingActionCandidate[]> => {
        throw new Error("Not a member");
      }),
      sync: vi.fn(async () => EMPTY_SUMMARY),
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

describe("useMeetingActions sync", () => {
  it("refetches the list after a successful sync, so new proposals show up", async () => {
    const repository = repoWith([
      [candidate("a")],
      [
        { ...candidate("a"), promotion_state: "proposal_pending", proposal_id: "p_a" },
      ],
    ]);
    const { result } = renderHook(() => useMeetingActions({ repository }));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));

    await act(async () => {
      await result.current.sync();
    });

    await waitFor(() =>
      expect(result.current.candidates[0]?.promotion_state).toBe("proposal_pending"),
    );
    expect(repository.sync).toHaveBeenCalledTimes(1);
  });

  it("surfaces a sync failure and leaves the list untouched", async () => {
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => [candidate("a", "Still here")]),
      sync: vi.fn(async () => {
        throw new Error("Ingest failed");
      }),
    };
    const { result } = renderHook(() => useMeetingActions({ repository }));
    await waitFor(() => expect(result.current.candidates).toHaveLength(1));

    await act(async () => {
      await result.current.sync();
    });

    expect(result.current.syncError?.message).toBe("Ingest failed");
    // A failed ingest wrote nothing, so re-reading would be noise — and the list
    // the user is looking at must not be blanked by a failure.
    expect(result.current.candidates.map((c) => c.text)).toEqual(["Still here"]);
    expect(repository.list).toHaveBeenCalledTimes(1);
  });

  it("reports the in-flight sync so the caller can disable the button", async () => {
    let release: () => void = () => {};
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => [candidate("a")]),
      sync: vi.fn(
        () =>
          new Promise<MeetingSyncSummary>((resolve) => {
            release = () => resolve(EMPTY_SUMMARY);
          }),
      ),
    };
    const { result } = renderHook(() => useMeetingActions({ repository }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let pending: Promise<unknown> | undefined;
    act(() => {
      pending = result.current.sync();
    });
    await waitFor(() => expect(result.current.isSyncing).toBe(true));

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.isSyncing).toBe(false);
  });

  it("clears a previous sync error when a later sync succeeds", async () => {
    let shouldFail = true;
    const repository: MeetingActionsRepository = {
      list: vi.fn(async () => [candidate("a")]),
      sync: vi.fn(async () => {
        if (shouldFail) throw new Error("Ingest failed");
        return {
          proposalsCreated: 1,
          skippedDuplicate: 0,
          skippedUnmappedTenant: 0,
        };
      }),
    };
    const { result } = renderHook(() => useMeetingActions({ repository }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.sync();
    });
    expect(result.current.syncError).not.toBeNull();

    shouldFail = false;
    await act(async () => {
      await result.current.sync();
    });
    // A stale error banner above a successful sync would be a lie.
    expect(result.current.syncError).toBeNull();
  });
});

describe("getDefaultMeetingActionsRepository", () => {
  it("is a shared singleton, so every uninjected caller reads one store", () => {
    expect(getDefaultMeetingActionsRepository()).toBe(
      getDefaultMeetingActionsRepository(),
    );
  });
});
