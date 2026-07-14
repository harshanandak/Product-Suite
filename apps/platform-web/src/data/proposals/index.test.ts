import { describe, expect, it } from "vitest";

import * as proposals from "./index";

describe("data/proposals barrel", () => {
  it("re-exports the public seam surface", () => {
    expect(typeof proposals.createMockProposalRepository).toBe("function");
    expect(typeof proposals.createNetworkProposalRepository).toBe("function");
    expect(typeof proposals.useProposals).toBe("function");
    expect(typeof proposals.getDefaultProposalRepository).toBe("function");
    expect(typeof proposals.ProposalRepositoryProvider).toBe("function");
    expect(typeof proposals.useProposalRepositoryContext).toBe("function");
  });

  it("getDefaultProposalRepository returns a stable singleton", () => {
    expect(proposals.getDefaultProposalRepository()).toBe(
      proposals.getDefaultProposalRepository(),
    );
  });
});
