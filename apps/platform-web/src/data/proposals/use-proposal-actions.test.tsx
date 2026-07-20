import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { ProposalRepository } from "./repository";
import type { AcceptResult } from "./types";
import { useProposalActions } from "./use-proposal-actions";

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
