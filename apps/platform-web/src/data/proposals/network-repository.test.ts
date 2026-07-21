import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNetworkProposalRepository } from "./network-repository";

const BASE = "https://api.test";

function jsonOk(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as Response;
}

/** A response (ok flag controlled) carrying a JSON body + a status code. */
function jsonBody(ok: boolean, status: number, body: unknown) {
  return { ok, status, json: async () => body } as Response;
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
    // A source-less row is normalized to `source: null` (see the source tests below).
    expect(result).toEqual([{ id: "p1", source: null }]);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/agent/proposals`);
    expect(init?.method).toBe("GET");
    expect((init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok_123",
    );
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("list passes through a valid source facet and nulls a missing/unknown one", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk([
        { id: "p1", source: "chat" },
        { id: "p2", source: "autonomous" },
        { id: "p3", source: "connector" },
        { id: "p4", source: "bogus" }, // junk ⇒ null
        { id: "p5" }, // missing ⇒ null
      ]),
    );
    const result = await makeRepo().list();
    expect(result.map((p) => p.source)).toEqual([
      "chat",
      "autonomous",
      "connector",
      null,
      null,
    ]);
  });

  it("accept POSTs /:id/accept with NO body and returns the applied envelope", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk({ status: "applied", proposal_id: "p1", item_id: "wi_9" }),
    );
    const result = await makeRepo().accept("p1");
    expect(result).toEqual({ status: "applied", proposal_id: "p1", item_id: "wi_9" });
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
    fetchMock.mockResolvedValueOnce(
      jsonOk({ status: "applied", proposal_id: "p1", item_id: "rule_1" }),
    );
    const edited = { kind: "rule", title: "Prefer concise titles", enforcement: "hard" };
    const result = await makeRepo().accept("p1", edited);
    expect(result).toEqual({ status: "applied", proposal_id: "p1", item_id: "rule_1" });
    const { init } = callArgs();
    // The human's gold-label correction rides as `edited_payload` (a wholesale
    // replace on the server) — never a partial that would drop kind/title.
    expect(init?.body).toBe(JSON.stringify({ edited_payload: edited }));
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("accept reads the outcome from the BODY status, not the HTTP code", async () => {
    // A 200 that nonetheless carries an `invalid` envelope maps to invalid — the
    // body's `status` is authoritative, never the transport code.
    fetchMock.mockResolvedValueOnce(
      jsonOk({ status: "invalid", proposal_id: "p1", message: "Title is required" }),
    );
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "invalid",
      proposal_id: "p1",
      message: "Title is required",
      retryable: true,
    });
  });

  it("accept surfaces a stale envelope (item_id + message) instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(false, 409, {
        status: "stale",
        proposal_id: "p1",
        item_id: "wi_1",
        message: "This item changed since the agent proposed it.",
      }),
    );
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "stale",
      proposal_id: "p1",
      item_id: "wi_1",
      message: "This item changed since the agent proposed it.",
    });
  });

  it("accept treats invalid as retryable unless the envelope says otherwise", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(false, 422, {
        status: "invalid",
        proposal_id: "p1",
        message: "Team not found",
        retryable: false,
      }),
    );
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "invalid",
      proposal_id: "p1",
      message: "Team not found",
      retryable: false,
    });
  });

  it("accept surfaces an explicit failed envelope (message + retryable) instead of throwing", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(false, 400, {
        status: "failed",
        proposal_id: "p1",
        message: "The team this refers to no longer exists.",
        retryable: false,
      }),
    );
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "failed",
      proposal_id: "p1",
      message: "The team this refers to no longer exists.",
      retryable: false,
    });
  });

  it("accept maps not_found / not_pending envelopes", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonBody(false, 404, { status: "not_found", proposal_id: "p1" }),
    );
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "not_found",
      proposal_id: "p1",
    });
    fetchMock.mockResolvedValueOnce(
      jsonBody(false, 409, { status: "not_pending", proposal_id: "p2" }),
    );
    await expect(makeRepo().accept("p2")).resolves.toEqual({
      status: "not_pending",
      proposal_id: "p2",
    });
  });

  // --- C-before-A shim: the CURRENT live API returns the applied ROW (not the
  // envelope) on 2xx and `{error}` bodies on 4xx. The adapter must handle BOTH. ---

  it("(row shape) treats a 2xx applied ROW body as applied, item_id from the row id", async () => {
    // The live API (routes/proposals.ts) returns the applied work-item row on
    // success — its id is `id`, NOT `item_id`. Must still surface as applied.
    fetchMock.mockResolvedValueOnce(jsonOk({ id: "wi_42", title: "Ship pricing brief" }));
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "applied",
      proposal_id: "p1",
      item_id: "wi_42",
    });
  });

  it("(envelope shape) still prefers item_id when the 2xx body carries the envelope", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk({ item_id: "wi_9", id: "ignore_me" }));
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "applied",
      proposal_id: "p1",
      item_id: "wi_9",
    });
  });

  it("(shim) a bare 409 'stale' message maps to a stale outcome", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(409, "Target changed; proposal is stale"));
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "stale",
      proposal_id: "p1",
      item_id: "",
      message: "Target changed; proposal is stale",
    });
  });

  it("(shim) a bare 409 'no longer pending' message maps to not_pending (not stale)", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(409, "Proposal is no longer pending"));
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "not_pending",
      proposal_id: "p1",
    });
  });

  it("(legacy) accept maps a bare 404 to not_found", async () => {
    fetchMock.mockResolvedValueOnce(jsonError(404));
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "not_found",
      proposal_id: "p1",
    });
  });

  it("(shim) a bare 422 maps to a TERMINAL failed (the live API flips it to failed)", async () => {
    // The current live API returns a bare 422 for invalid AND terminally marks the
    // proposal `failed` in the DB — so it is NOT recoverable. Discard-only.
    fetchMock.mockResolvedValueOnce(jsonError(422, "bad payload"));
    await expect(makeRepo().accept("p1")).resolves.toEqual({
      status: "failed",
      proposal_id: "p1",
      message: "bad payload",
      retryable: false,
    });
  });

  it("accept still throws on a real error (e.g. 500) with no accept envelope", async () => {
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
