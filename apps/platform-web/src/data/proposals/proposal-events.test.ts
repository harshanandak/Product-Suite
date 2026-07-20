import { describe, expect, it, vi } from "vitest";

import {
  notifyProposalMutation,
  subscribeProposalMutations,
} from "./proposal-events";

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
    subscribeProposalMutations(other);
    expect(() => notifyProposalMutation()).not.toThrow();
    expect(other).toHaveBeenCalledTimes(1);
  });
});
