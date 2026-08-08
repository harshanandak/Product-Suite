import { describe, expect, it } from "vitest";

import * as serverState from "./index";

describe("server-state exports", () => {
  it("exposes the scoped provider and policy helpers", () => {
    expect(serverState.ServerStateProvider).toBeTypeOf("function");
    expect(serverState.createServerStateQueryClient).toBeTypeOf("function");
    expect(serverState.getAdapterIdentity).toBeTypeOf("function");
    expect(serverState.shouldRetryServerStateQuery).toBeTypeOf("function");
    expect(serverState.useServerState).toBeTypeOf("function");
  });
});
