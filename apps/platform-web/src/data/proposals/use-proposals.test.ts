import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProposalRepository } from "./repository";
import type { AcceptResult, Proposal } from "./types";
import { useProposals } from "./use-proposals";

function pending(id: string): Proposal {
  return {
    id,
    target_type: "work_item",
    target_id: null,
    operation: "create",
    payload: { title: id },
    rationale: null,
    confidence: null,
    status: "pending",
    run_id: "run_1",
    model_id: "m",
    created_at: "2026-07-13T00:00:00.000Z",
  };
}

/** A controllable fake repo whose list changes across refetches. */
function makeRepo(overrides: Partial<ProposalRepository> = {}): ProposalRepository {
  return {
    list: vi.fn(async () => [pending("p1"), pending("p2")]),
    accept: vi.fn(
      async (): Promise<AcceptResult> => ({
        status: "stale",
        proposal_id: "p1",
        item_id: "wi_1",
        message: "changed",
      }),
    ),
    reject: vi.fn(async () => undefined),
    activeRules: vi.fn(async () => []),
    ...overrides,
  };
}

describe("useProposals", () => {
  it("loads the pending proposals on mount", async () => {
    const repository = makeRepo();
    const { result } = renderHook(() => useProposals({ repository }));

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.proposals.map((p) => p.id)).toEqual(["p1", "p2"]);
    expect(result.current.error).toBeNull();
  });

  it("accept returns the outcome and refetches the list on settle", async () => {
    const list = vi
      .fn<() => Promise<Proposal[]>>()
      .mockResolvedValueOnce([pending("p1"), pending("p2")])
      .mockResolvedValueOnce([pending("p2")]);
    const accept = vi.fn(
      async (): Promise<AcceptResult> => ({
        status: "applied",
        proposal_id: "p1",
        item_id: "wi_1",
      }),
    );
    const repository = makeRepo({ list, accept });
    const { result } = renderHook(() => useProposals({ repository }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    let outcome: AcceptResult | undefined;
    await act(async () => {
      outcome = await result.current.accept("p1");
    });

    expect(outcome).toEqual({
      status: "applied",
      proposal_id: "p1",
      item_id: "wi_1",
    });
    expect(accept).toHaveBeenCalledWith("p1", undefined);
    // Refetched: p1 is gone from the pending set.
    await waitFor(() =>
      expect(result.current.proposals.map((p) => p.id)).toEqual(["p2"]),
    );
  });

  it("raises isLoading (not isRefetching) on the initial load, then isRefetching (not isLoading) on a settle refetch", async () => {
    // The banner-loss fix (kernel 7218a03e): a refetch after accept must NOT flip
    // `isLoading` — that is the initial-skeleton signal that unmounts the detail
    // pane. Hold the refetch open to observe the flag it actually raises.
    let resolveRefetch: (proposals: Proposal[]) => void = () => {};
    let listCalls = 0;
    const list = vi.fn(() =>
      listCalls++ === 0
        ? Promise.resolve([pending("p1")])
        : new Promise<Proposal[]>((resolve) => {
            resolveRefetch = resolve;
          }),
    );
    const repository = makeRepo({ list });
    const { result } = renderHook(() => useProposals({ repository }));

    // Initial load: isLoading is the raised flag, never isRefetching.
    expect(result.current.isLoading).toBe(true);
    expect(result.current.isRefetching).toBe(false);
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // A settle refetch: isRefetching raises, isLoading stays down (no skeleton).
    act(() => {
      result.current.refetch();
    });
    await waitFor(() => expect(result.current.isRefetching).toBe(true));
    expect(result.current.isLoading).toBe(false);

    // Resolving the reload clears the background flag.
    await act(async () => {
      resolveRefetch([pending("p1"), pending("p2")]);
    });
    await waitFor(() => expect(result.current.isRefetching).toBe(false));
    expect(result.current.isLoading).toBe(false);
    expect(result.current.proposals.map((p) => p.id)).toEqual(["p1", "p2"]);
  });

  it("reject forwards the reason and refetches on settle", async () => {
    const reject = vi.fn(async () => undefined);
    const list = vi
      .fn<() => Promise<Proposal[]>>()
      .mockResolvedValueOnce([pending("p1")])
      .mockResolvedValueOnce([]);
    const repository = makeRepo({ list, reject });
    const { result } = renderHook(() => useProposals({ repository }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await result.current.reject("p1", "bad data");
    });

    expect(reject).toHaveBeenCalledWith("p1", "bad data");
    await waitFor(() => expect(result.current.proposals).toEqual([]));
  });

  it("activeRules delegates to the repository, returns the rules, and does NOT refetch the list", async () => {
    const list = vi
      .fn<() => Promise<Proposal[]>>()
      .mockResolvedValue([pending("p1")]);
    const activeRules = vi.fn(async () => [
      { id: "m_1", title: "Prefer concise titles" },
    ]);
    const repository = makeRepo({ list, activeRules });
    const { result } = renderHook(() => useProposals({ repository }));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(list).toHaveBeenCalledTimes(1);

    let rules: { id: string; title: string }[] | undefined;
    await act(async () => {
      rules = await result.current.activeRules("p1");
    });

    expect(rules).toEqual([{ id: "m_1", title: "Prefer concise titles" }]);
    expect(activeRules).toHaveBeenCalledWith("p1");
    // A read, not a mutation — the pending list is never invalidated/re-fetched.
    expect(list).toHaveBeenCalledTimes(1);
  });

  it("surfaces a load error", async () => {
    const repository = makeRepo({
      list: vi.fn(async () => {
        throw new Error("nope");
      }),
    });
    const { result } = renderHook(() => useProposals({ repository }));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.error?.message).toBe("nope");
  });
});
