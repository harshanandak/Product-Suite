import { describe, expect, it, vi } from "vitest";

import {
  agentChatAuthHeaders,
  agentChatTransportConfig,
  createAgentChatTransport,
  type AgentChatContext,
} from "./transport";

const BASE = "https://api.test";

describe("agentChatAuthHeaders", () => {
  it("attaches a bearer token when signed in", async () => {
    const headers = await agentChatAuthHeaders(async () => "tok_123");
    expect(headers).toEqual({ Authorization: "Bearer tok_123" });
  });

  it("omits Authorization when signed out (null token)", async () => {
    const headers = await agentChatAuthHeaders(async () => null);
    expect(headers).toEqual({});
  });

  it("re-reads the token per call so a rotated token is always used", async () => {
    const getToken = vi
      .fn<() => Promise<string | null>>()
      .mockResolvedValueOnce("tok_a")
      .mockResolvedValueOnce("tok_b");
    expect(await agentChatAuthHeaders(getToken)).toEqual({
      Authorization: "Bearer tok_a",
    });
    expect(await agentChatAuthHeaders(getToken)).toEqual({
      Authorization: "Bearer tok_b",
    });
  });
});

describe("agentChatTransportConfig", () => {
  const context: AgentChatContext = {
    workspace: "befach-hq",
    object: { type: "work_item", id: "wi_1", title: "Ship auth" },
  };

  it("targets POST /api/agent/chat under the configured apiBase", () => {
    const config = agentChatTransportConfig({
      apiBase: BASE,
      getToken: async () => "tok",
      getContext: () => context,
    });
    expect(config.api).toBe(`${BASE}/api/agent/chat`);
  });

  it("headers() resolves the bearer via the async getToken", async () => {
    const config = agentChatTransportConfig({
      apiBase: BASE,
      getToken: async () => "tok_xyz",
      getContext: () => undefined,
    });
    await expect(config.headers()).resolves.toEqual({
      Authorization: "Bearer tok_xyz",
    });
  });

  it("body() carries the current object-scoping context", () => {
    const config = agentChatTransportConfig({
      apiBase: BASE,
      getToken: async () => "tok",
      getContext: () => context,
    });
    expect(config.body()).toEqual({ context });
  });

  it("body() reflects a re-scoped thread by re-reading getContext each call", () => {
    let current: AgentChatContext | undefined = context;
    const config = agentChatTransportConfig({
      apiBase: BASE,
      getToken: async () => "tok",
      getContext: () => current,
    });
    expect(config.body()).toEqual({ context });
    current = { workspace: "befach-hq" };
    expect(config.body()).toEqual({ context: { workspace: "befach-hq" } });
  });

  it("body() anchors the run with org_id when getOrgId resolves one", () => {
    const config = agentChatTransportConfig({
      apiBase: BASE,
      getToken: async () => "tok",
      getContext: () => context,
      getOrgId: () => "org_123",
    });
    expect(config.body()).toEqual({ org_id: "org_123", context });
  });

  it("body() omits org_id when getOrgId is absent/null (single-org fallback)", () => {
    const config = agentChatTransportConfig({
      apiBase: BASE,
      getToken: async () => "tok",
      getContext: () => context,
      getOrgId: () => null,
    });
    expect(config.body()).toEqual({ context });
    expect("org_id" in config.body()).toBe(false);
  });
});

describe("createAgentChatTransport", () => {
  it("builds a DefaultChatTransport pointed at the agent chat endpoint", () => {
    const transport = createAgentChatTransport({
      apiBase: BASE,
      getToken: async () => "tok",
      getContext: () => undefined,
    });
    // DefaultChatTransport stores `api` on the instance (verified against the ai@6 types).
    expect((transport as unknown as { api?: string }).api).toBe(
      `${BASE}/api/agent/chat`,
    );
  });
});
