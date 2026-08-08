import { afterEach, describe, expect, it, vi } from "vitest";

import { createMemoryImpactAdapter } from "./adapter";

const BASE = "https://api.test";

function mockFetch(
  impl: (url: string, init?: RequestInit) => Response | Promise<Response>,
) {
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
    const error = await adapter.get().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: "Unauthorized", status: 401 });
  });

  it("composes caller cancellation with the request timeout", async () => {
    let requestSignal: AbortSignal | undefined;
    mockFetch((_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Response(JSON.stringify({ verdict: "helps" }), { status: 200 });
    });
    const adapter = createMemoryImpactAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
      timeoutMs: 100,
    });
    const caller = new AbortController();

    await adapter.get(30, caller.signal);
    expect(requestSignal).toBeDefined();
    expect(requestSignal).not.toBe(caller.signal);
    expect(requestSignal?.aborted).toBe(false);

    caller.abort();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("rejects an in-flight request when the caller aborts", async () => {
    mockFetch((_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener("abort", () => reject(signal.reason));
      }),
    );
    const adapter = createMemoryImpactAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
      timeoutMs: 100,
    });
    const caller = new AbortController();
    const request = adapter.get(30, caller.signal);

    caller.abort();
    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retains the timeout when a caller signal is present", async () => {
    let requestSignal: AbortSignal | undefined;
    mockFetch((_url, init) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        if (signal?.aborted) reject(signal.reason);
        else signal?.addEventListener("abort", () => reject(signal.reason));
      });
    });
    const adapter = createMemoryImpactAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
      timeoutMs: 5,
    });
    const request = adapter.get(30, new AbortController().signal);

    await expect(request).rejects.toMatchObject({ name: "TimeoutError" });
    expect(requestSignal?.aborted).toBe(true);
  });

  it("exposes 5xx status without changing the API error message", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ error: "Try again" }), { status: 503 }),
    );
    const adapter = createMemoryImpactAdapter({
      apiBase: BASE,
      getToken: async () => "tok",
    });

    const error = await adapter.get().catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: "Try again", status: 503 });
  });
});
