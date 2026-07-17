import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryImpactAdapter } from "./adapter";

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

describe("createMemoryImpactAdapter", () => {
  it("get() GETs the impact with a bearer token, window, and org_id", async () => {
    const impact = { verdict: "helps", savedEdits: 12 };
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify(impact), { status: 200 }),
    );
    const adapter = createMemoryImpactAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
      getOrgId: () => "org_1",
    });
    await expect(adapter.get(30)).resolves.toEqual(impact);
    const [url, init] = fetchSpy.mock.calls[0]!;
    const parsed = new URL(String(url));
    expect(parsed.pathname).toBe("/api/agent/memory-impact");
    expect(parsed.searchParams.get("window")).toBe("30");
    expect(parsed.searchParams.get("org_id")).toBe("org_1");
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok",
    );
  });

  it("defaults the window to 30 and omits org_id for a single-org caller", async () => {
    const fetchSpy = mockFetch(
      () => new Response(JSON.stringify({ verdict: "insufficient" }), { status: 200 }),
    );
    const adapter = createMemoryImpactAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
    });
    await adapter.get();
    const parsed = new URL(String(fetchSpy.mock.calls[0]![0]));
    expect(parsed.searchParams.get("window")).toBe("30");
    expect(parsed.searchParams.get("org_id")).toBeNull();
  });

  it("throws the API's error message on a non-OK response", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 }),
    );
    const adapter = createMemoryImpactAdapter({
      apiBase: BASE,
      getToken: async () => null,
    });
    await expect(adapter.get()).rejects.toThrow("Unauthorized");
  });
});
