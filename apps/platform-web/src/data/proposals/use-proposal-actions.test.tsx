import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ProposalRepository } from "./repository";
import type { AcceptResult } from "./types";
import { useProposalActions } from "./use-proposal-actions";

// Spy on the cross-instance disposal signal (keep isTerminalAcceptOutcome real) so
// tests can assert the PRECISE terminal set that broadcasts.
vi.mock("./proposal-events", async (importActual) => {
  const actual = await importActual<typeof import("./proposal-events")>();
  return { ...actual, notifyProposalMutation: vi.fn() };
});
import { notifyProposalMutation } from "./proposal-events";
const notifySpy = vi.mocked(notifyProposalMutation);

function makeRepo(overrides: Partial<ProposalRepository> = {}): ProposalRepository {
  return {
    list: vi.fn(async () => []),
    accept: vi.fn(
      async (id): Promise<AcceptResult> => ({
        status: "applied",
        proposal_id: id,
        item_id: "wi_1",
      }),
    ),
    reject: vi.fn(async () => undefined),
    activeRules: vi.fn(async () => []),
    ...overrides,
  };
}

/** An accept repo that always resolves the given outcome. */
function repoWithOutcome(result: AcceptResult): ProposalRepository {
  return makeRepo({ accept: vi.fn(async () => result) });
}

beforeEach(() => {
  notifySpy.mockClear();
});

describe("useProposalActions", () => {
  it("accept goes idle → applying → settled and reports the result", async () => {
    const repository = makeRepo();
    const onSettled = vi.fn();
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository, onSettled }),
    );
    expect(result.current.phase).toBe("idle");

    act(() => result.current.accept());

    await waitFor(() => expect(result.current.phase).toBe("settled"));
    expect(result.current.result).toEqual({
      status: "applied",
      proposal_id: "p1",
      item_id: "wi_1",
    });
    expect(onSettled).toHaveBeenCalledWith({
      status: "applied",
      proposal_id: "p1",
      item_id: "wi_1",
    });
  });

  it("collapses a double-click to a SINGLE apply (in-flight guard)", async () => {
    const accept = vi.fn(
      async (id: string): Promise<AcceptResult> => ({
        status: "applied",
        proposal_id: id,
        item_id: "wi_1",
      }),
    );
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: makeRepo({ accept }) }),
    );
    // Two synchronous calls before the first settles.
    act(() => {
      result.current.accept();
      result.current.accept();
    });
    await waitFor(() => expect(result.current.phase).toBe("settled"));
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it("surfaces a THROWN transport error as a retryable failed result (never silent)", async () => {
    const accept = vi.fn(async (): Promise<AcceptResult> => {
      throw new Error("Server error (500)");
    });
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: makeRepo({ accept }) }),
    );
    act(() => result.current.accept());
    await waitFor(() => expect(result.current.phase).toBe("settled"));
    expect(result.current.result).toEqual({
      status: "failed",
      proposal_id: "p1",
      message: "Server error (500)",
      retryable: true,
    });
  });

  it("reject settles to the rejected phase and reports 'rejected'", async () => {
    const onSettled = vi.fn();
    const reject = vi.fn(async () => undefined);
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: makeRepo({ reject }), onSettled }),
    );
    act(() => result.current.reject("wrong target"));
    await waitFor(() => expect(result.current.phase).toBe("rejected"));
    expect(reject).toHaveBeenCalledWith("p1", "wrong target");
    expect(onSettled).toHaveBeenCalledWith("rejected");
  });

  it("a failed reject surfaces error VISIBLY and stays actionable (no false success)", async () => {
    const reject = vi.fn(async () => {
      throw new Error("Discard failed");
    });
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: makeRepo({ reject }) }),
    );
    act(() => result.current.reject());
    await waitFor(() => expect(result.current.error).toBe("Discard failed"));
    // Never flips to a terminal rejected state on failure.
    expect(result.current.phase).not.toBe("rejected");
  });

  it("reset returns the hook to idle (the Edit recovery path)", async () => {
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: makeRepo() }),
    );
    act(() => result.current.accept());
    await waitFor(() => expect(result.current.phase).toBe("settled"));
    act(() => result.current.reset());
    expect(result.current.phase).toBe("idle");
    expect(result.current.result).toBeNull();
  });
});

describe("useProposalActions — disposal signal precision", () => {
  it.each([
    ["applied", { status: "applied", proposal_id: "p1", item_id: "wi_1" }],
    ["not_pending", { status: "not_pending", proposal_id: "p1" }],
    ["not_found", { status: "not_found", proposal_id: "p1" }],
  ] as const)("broadcasts when accept leaves the pending set (%s)", async (_label, outcome) => {
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: repoWithOutcome(outcome as AcceptResult) }),
    );
    act(() => result.current.accept());
    await waitFor(() => expect(result.current.phase).toBe("settled"));
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["stale", { status: "stale", proposal_id: "p1", item_id: "wi_1", message: "changed" }],
    ["invalid", { status: "invalid", proposal_id: "p1", message: "bad", retryable: true }],
    ["failed", { status: "failed", proposal_id: "p1", message: "nope", retryable: false }],
  ] as const)("does NOT broadcast when accept stays pending (%s)", async (_label, outcome) => {
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: repoWithOutcome(outcome as AcceptResult) }),
    );
    act(() => result.current.accept());
    await waitFor(() => expect(result.current.phase).toBe("settled"));
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("does NOT broadcast on a thrown transport error (stays pending as retryable failed)", async () => {
    const repository = makeRepo({
      accept: vi.fn(async () => {
        throw new Error("500");
      }),
    });
    const { result } = renderHook(() => useProposalActions("p1", { repository }));
    act(() => result.current.accept());
    await waitFor(() => expect(result.current.phase).toBe("settled"));
    expect(result.current.result?.status).toBe("failed");
    expect(notifySpy).not.toHaveBeenCalled();
  });

  it("broadcasts on a successful reject (user discard is terminal)", async () => {
    const { result } = renderHook(() =>
      useProposalActions("p1", { repository: makeRepo() }),
    );
    act(() => result.current.reject());
    await waitFor(() => expect(result.current.phase).toBe("rejected"));
    expect(notifySpy).toHaveBeenCalledTimes(1);
  });

  it("refresh re-lists (broadcasts) AND returns the host to idle", async () => {
    const { result } = renderHook(() =>
      useProposalActions("p1", {
        repository: repoWithOutcome({
          status: "stale",
          proposal_id: "p1",
          item_id: "wi_1",
          message: "changed",
        }),
      }),
    );
    act(() => result.current.accept());
    await waitFor(() => expect(result.current.phase).toBe("settled"));
    notifySpy.mockClear(); // ignore the accept path; assert only refresh's signal
    act(() => result.current.refresh());
    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(result.current.phase).toBe("idle");
    expect(result.current.result).toBeNull();
  });
});
