import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNetworkProposalRepository } from "./network-repository";

const BASE = "https://api.test";

function jsonOk(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as Response;
}

/** A non-OK response carrying the API's `{ error }` envelope + a status. */
function jsonError(status: number, error?: string) {
  return {
    ok: false,
    status,
    json: async () => (error === undefined ? {} : { error }),
  } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

function makeRepo(
  getToken: () => Promise<string | null> = async () => "tok_123",
) {
  return createNetworkProposalRepository({ baseUrl: BASE, getToken });
}

function callArgs(index = 0) {
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  return { url: url as string, init: init as RequestInit | undefined };
}

describe("createNetworkProposalRepository", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("list GETs /api/agent/proposals with a bearer token + abort signal", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk([{ id: "p1" }]));
    const result = await makeRepo().list();
    expect(result).toEqual([{ id: "p1" }]);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/agent/proposals`);
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_123",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("accept POSTs /:id/accept with NO body and returns the applied item", async () => {
    const item = { id: "wi_9", title: "Made" };
    fetchMock.mockResolvedValueOnce(jsonOk(item));
    const result = await makeRepo().accept("p1");
    expect(result).toEqual({ outcome: "applied", item });
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/agent/proposals/p1/accept`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    // No body ⇒ no Content-Type, but the bearer is still attached.
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer tok_123");
  });

  it("accept sends the FULL merged edited_payload in the body when the reviewer edited", async () => {
    const item = { id: "rule_1", title: "Prefer concise titles" };
    fetchMock.mockResolvedValueOnce(jsonOk(item));
    const edited = { kind: "rule", title: "Prefer concise titles", enforcement: "hard" };
    const result = await makeRepo().accept("p1", edited);
    expect(result).toEqual({ outcome: "applied", item });
    const { init } = callArgs();
    // The human's gold-label correction rides as `edited_payload` (a wholesale
    // replace on the server) — never a partial that would drop kind/title.
    expect(init?.body).toBe(JSON.stringify({ edited_payload: edited }));
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("accept maps 409 to a stale outcome (not an opaque throw)", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(409, "not pending"));
    await expect(makeRepo().accept("p1")).resolves.toEqual({ outcome: "stale" });
  });

  it("accept maps 404 to a stale outcome", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(404));
    await expect(makeRepo().accept("p1")).resolves.toEqual({ outcome: "stale" });
  });

  it("accept maps 422 to an invalid outcome", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(422, "bad payload"));
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      outcome: "invalid",
    });
  });

  it("accept still throws on a real error (e.g. 500)", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(500, "boom"));
    await expect(makeRepo().accept("p1")).rejects.toThrow("boom");
  });

  it("reject POSTs /:id/reject with the reason in the body", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk(undefined, 204));
    await makeRepo().reject("p1", "wrong target");
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/agent/proposals/p1/reject`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ reason: "wrong target" }));
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers.Authorization).toBe("Bearer tok_123");
  });

  it("reject omits a reason when none is given", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk(undefined, 204));
    await makeRepo().reject("p1");
    // { reason: undefined } serializes to {} — a skippable reason.
    expect(callArgs().init?.body).toBe(JSON.stringify({}));
  });

  it("activeRules GETs /:id/active-rules and unwraps the { rules } envelope to the array", async () => {
    const rules = [
      { id: "m_1", title: "Prefer concise titles" },
      { id: "m_2", title: "Never pause design tasks" },
    ];
    fetchMock.mockResolvedValueOnce(jsonOk({ rules }));
    const result = await makeRepo().activeRules("p1");
    // The array is unwrapped from `{ rules }`, not returned as the envelope.
    expect(result).toEqual(rules);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/agent/proposals/p1/active-rules`);
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_123",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("activeRules propagates a transport error (non-OK throws the API message)", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(500, "boom"));
    await expect(makeRepo().activeRules("p1")).rejects.toThrow("boom");
  });

  it("omits the Authorization header when signed out", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk([]));
    await makeRepo(async () => null).list();
    expect(
      (callArgs().init?.headers as Record<string, string>).Authorization,
    ).toBeUndefined();
  });
});
