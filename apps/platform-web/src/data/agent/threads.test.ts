import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentThreadsAdapter } from "./threads";

const BASE = "https://api.test";

function mockFetch(impl: (url: string, init?: RequestInit) => Response) {
  const spy = vi.fn(async (url: string | URL | Request, init?: RequestInit) =>
    impl(String(url), init),
  );
  vi.stubGlobal("fetch", spy);
  return spy;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAgentThreadsAdapter", () => {
  it("list() GETs the org's threads with a bearer token and org_id", async () => {
    const rows = [{ id: "th_1", title: "First", linked_object: null, updated_at: "2026-07-15" }];
    const fetchSpy = mockFetch(() => new Response(JSON.stringify(rows), { status: 200 }));
    const adapter = createAgentThreadsAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
      getOrgId: () => "org_1",
    });
    await expect(adapter.list()).resolves.toEqual(rows);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/agent/threads?org_id=org_1`);
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("list() omits org_id for a single-org caller", async () => {
    const fetchSpy = mockFetch(() => new Response("[]", { status: 200 }));
    const adapter = createAgentThreadsAdapter({ apiBase: BASE, getToken: async () => "tok" });
    await adapter.list();
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`${BASE}/api/agent/threads`);
  });

  it("messages() unwraps the reconstructed UIMessage[] history", async () => {
    const messages = [{ id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] }];
    mockFetch(() => new Response(JSON.stringify({ messages }), { status: 200 }));
    const adapter = createAgentThreadsAdapter({ apiBase: BASE, getToken: async () => "tok" });
    await expect(adapter.messages("th_1")).resolves.toEqual(messages);
  });

  it("archive() POSTs to the archive route", async () => {
    const fetchSpy = mockFetch(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const adapter = createAgentThreadsAdapter({ apiBase: BASE, getToken: async () => "tok" });
    await adapter.archive("th_1");
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/agent/threads/th_1/archive`);
    expect(init?.method).toBe("POST");
  });

  it("throws the API's error message on a non-OK response", async () => {
    mockFetch(() => new Response(JSON.stringify({ error: "Not found" }), { status: 404 }));
    const adapter = createAgentThreadsAdapter({ apiBase: BASE, getToken: async () => "tok" });
    await expect(adapter.messages("foreign")).rejects.toThrow("Not found");
  });
});
