import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNetworkMeetingActionsRepository } from "./network-repository";

const originalFetch = globalThis.fetch;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const CANDIDATE = {
  id: "ai_1",
  meeting_id: "mtg_1",
  text: "Send the revised quote to Acme by Friday",
  confidence: 0.82,
  promotion_reason: "Explicit commitment",
  created_at: "2026-07-25T00:00:00.000Z",
  promotion_state: "proposal_pending",
  proposal_id: "p1",
  work_item_id: null,
};

function repo(getToken: () => Promise<string | null> = async () => "tok") {
  return createNetworkMeetingActionsRepository({
    baseUrl: "https://api.test",
    getToken,
  });
}

describe("createNetworkMeetingActionsRepository", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () => jsonResponse({ candidates: [CANDIDATE] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads the tenant-scoped candidates endpoint with the bearer token", async () => {
    const candidates = await repo().list();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/agent/meeting-candidates");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.text).toBe("Send the revised quote to Acme by Friday");
  });

  it("never requests across tenants — no tenant/org parameter is sent from the client", async () => {
    await repo().list();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    // Scope comes from the verified Clerk token server-side (callerTenantIds).
    // A client-supplied tenant id would be a request to be trusted about identity.
    expect(url).not.toMatch(/tenant/i);
    expect(url).not.toMatch(/org_id/i);
    expect(init.body ?? null).toBeNull();
    expect(init.method ?? "GET").toBe("GET");
  });

  it("normalizes an unknown promotion state off the wire instead of rendering junk", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          { ...CANDIDATE, id: "a", promotion_state: "something_new" },
          { ...CANDIDATE, id: "b", promotion_state: undefined },
          { ...CANDIDATE, id: "c", promotion_state: "accepted" },
        ],
      }),
    );

    const candidates = await repo().list();

    expect(candidates.map((c) => c.promotion_state)).toEqual([
      "unknown",
      "unknown",
      "accepted",
    ]);
  });

  it("coerces the remaining fields defensively, keeping nulls as nulls", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        candidates: [
          {
            id: "a",
            meeting_id: "m",
            text: "t",
            confidence: null,
            promotion_reason: null,
            created_at: "2026-07-25T00:00:00.000Z",
            promotion_state: "unpromoted",
            proposal_id: null,
            work_item_id: null,
          },
        ],
      }),
    );

    const [candidate] = await repo().list();
    expect(candidate).toEqual({
      id: "a",
      meeting_id: "m",
      text: "t",
      confidence: null,
      promotion_reason: null,
      created_at: "2026-07-25T00:00:00.000Z",
      promotion_state: "unpromoted",
      proposal_id: null,
      work_item_id: null,
    });
  });

  it("tolerates a malformed envelope by reading no candidates rather than throwing", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ candidates: "nope" }));
    await expect(repo().list()).resolves.toEqual([]);
  });

  it("throws the API's error message on a non-OK response", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: "Not a member" }, 403));
    await expect(repo().list()).rejects.toThrow("Not a member");
  });

  it("throws when signed out rather than issuing an unauthenticated request", async () => {
    await expect(repo(async () => null).list()).rejects.toThrow(/sign|token|auth/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("createNetworkMeetingActionsRepository.sync", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn(async () =>
      jsonResponse({
        proposalsCreated: 2,
        skippedDuplicate: 1,
        skippedUnmappedTenant: 0,
      }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("POSTs the ingest endpoint exactly once with the bearer token", async () => {
    await repo().sync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.test/api/agent/meeting-ingest");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("sends no org/tenant parameter — the server derives scope from the token", async () => {
    await repo().sync();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toMatch(/tenant|org_id/i);
    // A client-supplied org id would be a request to be trusted about identity.
    expect(init.body ?? null).toBeNull();
  });

  it("returns the ingest summary, including the unmapped-tenant count", async () => {
    // `skippedUnmappedTenant` must stay VISIBLE — that is how a fail-closed
    // allowlist stays debuggable when a tenant is silently not ingesting.
    await expect(repo().sync()).resolves.toEqual({
      proposalsCreated: 2,
      skippedDuplicate: 1,
      skippedUnmappedTenant: 0,
    });
  });

  it("coerces a missing or non-numeric count to 0 rather than NaN", async () => {
    fetchMock.mockResolvedValue(jsonResponse({ proposalsCreated: "lots" }));

    await expect(repo().sync()).resolves.toEqual({
      proposalsCreated: 0,
      skippedDuplicate: 0,
      skippedUnmappedTenant: 0,
    });
  });

  it("throws the API's error message on a non-OK response", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Ambiguous organization; specify org_id" }, 400),
    );
    await expect(repo().sync()).rejects.toThrow("Ambiguous organization");
  });

  it("throws when signed out rather than issuing an unauthenticated write", async () => {
    await expect(repo(async () => null).sync()).rejects.toThrow(/sign|token|auth/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
