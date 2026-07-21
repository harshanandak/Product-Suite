import { describe, expect, it, vi } from "vitest";

import {
  isTerminalAcceptOutcome,
  notifyProposalMutation,
  subscribeProposalMutations,
} from "./proposal-events";
import type { AcceptResult } from "./types";

describe("proposal-events", () => {
  it("notifies every current subscriber", () => {
    const a = vi.fn();
    const b = vi.fn();
    const offA = subscribeProposalMutations(a);
    const offB = subscribeProposalMutations(b);
    notifyProposalMutation();
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(1);
    offA();
    offB();
  });

  it("stops notifying after unsubscribe", () => {
    const listener = vi.fn();
    const off = subscribeProposalMutations(listener);
    notifyProposalMutation();
    off();
    notifyProposalMutation();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("is safe when a listener unsubscribes during dispatch (iterates a copy)", () => {
    const off = subscribeProposalMutations(() => off());
    const other = vi.fn();
    // Capture the second listener's unsubscribe and clear it before the test exits
    // so it never leaks into the module-global set (order-independent tests).
    const offOther = subscribeProposalMutations(other);
    expect(() => notifyProposalMutation()).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
    offOther();
  });
});

describe("isTerminalAcceptOutcome", () => {
  it("is true for outcomes that LEFT the pending set (applied / not_pending / not_found / non-retryable failed)", () => {
    const terminal: AcceptResult[] = [
      { status: "applied", proposal_id: "p", item_id: "wi_1" },
      { status: "not_pending", proposal_id: "p" },
      { status: "not_found", proposal_id: "p" },
      // The server already flipped this to failed in the DB — it is gone.
      { status: "failed", proposal_id: "p", message: "terminal", retryable: false },
    ];
    for (const result of terminal) {
      expect(isTerminalAcceptOutcome(result)).toBe(true);
    }
  });

  it("is false for still-pending recoverable outcomes (stale / invalid / retryable failed)", () => {
    const pending: AcceptResult[] = [
      { status: "stale", proposal_id: "p", item_id: "wi_1", message: "changed" },
      { status: "invalid", proposal_id: "p", message: "bad", retryable: true },
      // A RETRYABLE failed is transient — the proposal is still pending.
      { status: "failed", proposal_id: "p", message: "transient", retryable: true },
    ];
    for (const result of pending) {
      expect(isTerminalAcceptOutcome(result)).toBe(false);
    }
  });
});
