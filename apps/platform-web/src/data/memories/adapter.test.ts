import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoriesAdapter } from "./adapter";

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

describe("createMemoriesAdapter", () => {
  it("list() GETs memories with a bearer token, filters, and org_id", async () => {
    const rows = [{ id: "mem_1", title: "A" }];
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify(rows), { status: 200 }),
    );
    const adapter = createMemoriesAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
      getOrgId: () => "org_1",
    });
    await expect(
      adapter.list({ kind: "decision", status: "active", topic: "models" }),
    ).resolves.toEqual(rows);
    const [url, init] = fetchSpy.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/memories");
    expect(parsed.searchParams.get("kind")).toBe("decision");
    expect(parsed.searchParams.get("status")).toBe("active");
    expect(parsed.searchParams.get("topic")).toBe("models");
    expect(parsed.searchParams.get("org_id")).toBe("org_1");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("list() omits query entirely for a single-org caller with no filters", async () => {
    const fetchSpy = mockFetch(() => new Response("[]", { status: 200 }));
    const adapter = createMemoriesAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
    });
    await adapter.list();
    expect(String(fetchSpy.mock.calls[0]![0])).toBe(`${BASE}/api/memories`);
  });

  it("get() returns { memory, chain }", async () => {
    const detail = { memory: { id: "mem_1" }, chain: [{ id: "mem_1" }] };
    mockFetch(() => new Response(JSON.stringify(detail), { status: 200 }));
    const adapter = createMemoriesAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
    });
    await expect(adapter.get("mem_1")).resolves.toEqual(detail);
  });

  it("create() POSTs a JSON body and injects org_id", async () => {
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: "mem_9" }), { status: 201 }),
    );
    const adapter = createMemoriesAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
      getOrgId: () => "org_1",
    });
    await adapter.create({ kind: "decision", title: "New" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/memories`);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      kind: "decision",
      title: "New",
      org_id: "org_1",
    });
  });

  it("supersede() POSTs change_reason to the supersede route", async () => {
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: "mem_10" }), { status: 200 }),
    );
    const adapter = createMemoriesAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
    });
    await adapter.supersede("mem_1", { change_reason: "stale" });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe(`${BASE}/api/memories/mem_1/supersede`);
    expect(JSON.parse(String(init?.body))).toEqual({ change_reason: "stale" });
  });

  it("retract() POSTs with no body; defer() POSTs its body", async () => {
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ id: "m" }), { status: 200 }),
    );
    const adapter = createMemoriesAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
    });
    await adapter.retract("mem_1");
    expect(fetchSpy.mock.calls[0]![0]).toBe(`${BASE}/api/memories/mem_1/retract`);
    await adapter.defer("mem_1", { waiting_on: "budget" });
    const [url, init] = fetchSpy.mock.calls[1]!;
    expect(url).toBe(`${BASE}/api/memories/mem_1/defer`);
    expect(JSON.parse(String(init?.body))).toEqual({ waiting_on: "budget" });
  });

  it("throws the API's error message on a non-OK response (foreign id → 404)", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ error: "Not found" }), { status: 404 }),
    );
    const adapter = createMemoriesAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
    });
    await expect(adapter.get("foreign")).rejects.toThrow("Not found");
  });
});
