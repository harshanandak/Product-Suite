import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNetworkWorkItemRepository } from "./network-repository";

const BASE = "https://api.test";

function jsonOk(body: unknown, status = 200) {
  return { ok: true, status, json: async () => body } as Response;
}

/** A 204 whose `.json()` throws — proves the adapter never parses a no-content body. */
function noContent() {
  return {
    ok: true,
    status: 204,
    json: async () => {
      throw new Error("204 has no body — json() must not be called");
    },
  } as unknown as Response;
}

/** A non-OK response carrying the API's `{ error }` envelope. */
function jsonError(status: number, error: string) {
  return { ok: false, status, json: async () => ({ error }) } as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

function makeRepo(
  getToken: () => Promise<string | null> = async () => "tok_123",
) {
  return createNetworkWorkItemRepository({ baseUrl: BASE, getToken });
}

/** The URL + init a given call was made with. */
function callArgs(index = 0) {
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  return { url: url as string, init: init as RequestInit | undefined };
}

describe("createNetworkWorkItemRepository", () => {
  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads hit the tenant-scoped endpoints with a bearer token", async () => {
    const cases: [keyof ReturnType<typeof makeRepo>, string][] = [
      ["list", "/api/work-items"],
      ["listProjects", "/api/projects"],
      ["listOwners", "/api/owners"],
      ["listTasks", "/api/tasks"],
      ["listDependencies", "/api/dependencies"],
    ];
    for (const [method, path] of cases) {
      fetchMock.mockResolvedValueOnce(jsonOk([]));
      const repo = makeRepo();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (repo[method] as any)();
      expect(result).toEqual([]);
      const { url, init } = callArgs(fetchMock.mock.calls.length - 1);
      expect(url).toBe(`${BASE}${path}`);
      expect(
        (init?.headers as Record<string, string>).Authorization,
      ).toBe("Bearer tok_123");
      // Every read is bounded by an abort timeout so it can't spin forever.
      expect(init?.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it("getTasks fetches the tenant-scoped tasks and filters by work item", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonOk([
        { id: "t1", work_item_id: "wi_1", title: "A", status: "todo" },
        { id: "t2", work_item_id: "wi_2", title: "B", status: "todo" },
      ]),
    );
    const tasks = await makeRepo().getTasks("wi_1");
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe("t1");
    expect(callArgs().url).toBe(`${BASE}/api/tasks`);
  });

  it("listGraph composes nodes + edges, and slices a focus neighborhood", async () => {
    const nodes = [{ id: "a" }, { id: "b" }, { id: "c" }] as WorkItemShape[];
    const edges = [
      { id: "e1", source_item_id: "a", target_item_id: "b" },
      { id: "e2", source_item_id: "b", target_item_id: "c" },
    ];
    // full graph: two fetches (work-items + dependencies)
    fetchMock.mockResolvedValueOnce(jsonOk(nodes)).mockResolvedValueOnce(jsonOk(edges));
    const full = await makeRepo().listGraph();
    expect(full.nodes).toHaveLength(3);
    expect(full.dependencies).toHaveLength(2);

    // focus on "a" at depth 1: reaches "b" but not "c"
    fetchMock.mockResolvedValueOnce(jsonOk(nodes)).mockResolvedValueOnce(jsonOk(edges));
    const slice = await makeRepo().listGraph({ focusId: "a", depth: 1 });
    expect(slice.nodes.map((n) => n.id).sort()).toEqual(["a", "b"]);
    expect(slice.dependencies.map((d) => d.id)).toEqual(["e1"]);
  });

  it("throws on a non-OK response", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 503 } as Response);
    await expect(makeRepo().list()).rejects.toThrow("Request failed (503)");
  });

  it("omits the Authorization header when signed out", async () => {
    fetchMock.mockResolvedValueOnce(jsonOk([]));
    await makeRepo(async () => null).list();
    expect((callArgs().init?.headers as Record<string, string>).Authorization).toBeUndefined();
  });

  it("surfaces the API's error message on a non-OK write (e.g. a 409 cycle)", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonError(409, "Dependency would create a cycle: a → b"),
    );
    await expect(
      makeRepo().addDependency({ source_item_id: "a", target_item_id: "b" }),
    ).rejects.toThrow("Dependency would create a cycle: a → b");
  });

  it("create POSTs the input with a bearer and maps the returned work item", async () => {
    const created = { id: "wi_9", title: "New" };
    fetchMock.mockResolvedValueOnce(jsonOk(created, 201));
    const result = await makeRepo().create({ title: "New" });
    expect(result).toEqual(created);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/work-items`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ title: "New" }));
    const headers = init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer tok_123");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("update PATCHes /api/work-items/:id with the patch body", async () => {
    const updated = { id: "wi_1", title: "Renamed" };
    fetchMock.mockResolvedValueOnce(jsonOk(updated));
    const result = await makeRepo().update("wi_1", { title: "Renamed" });
    expect(result).toEqual(updated);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/work-items/wi_1`);
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ title: "Renamed" }));
  });

  it("listActivity GETs the per-item activity feed", async () => {
    const events = [{ id: "act_1", work_item_id: "wi_1" }];
    fetchMock.mockResolvedValueOnce(jsonOk(events));
    const result = await makeRepo().listActivity("wi_1");
    expect(result).toEqual(events);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/work-items/wi_1/activity`);
    expect(init?.method).toBe("GET");
  });

  it("createTask POSTs /api/tasks with the input", async () => {
    const created = { id: "t_9", work_item_id: "wi_1", title: "T", status: "todo" };
    fetchMock.mockResolvedValueOnce(jsonOk(created, 201));
    const result = await makeRepo().createTask({ work_item_id: "wi_1", title: "T" });
    expect(result).toEqual(created);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/tasks`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ work_item_id: "wi_1", title: "T" }));
  });

  it("updateTask PATCHes /api/tasks/:id with the patch", async () => {
    const updated = { id: "t_1", work_item_id: "wi_1", title: "X", status: "completed" };
    fetchMock.mockResolvedValueOnce(jsonOk(updated));
    const result = await makeRepo().updateTask("t_1", { status: "completed" });
    expect(result).toEqual(updated);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/tasks/t_1`);
    expect(init?.method).toBe("PATCH");
    expect(init?.body).toBe(JSON.stringify({ status: "completed" }));
  });

  it("toggleStatus POSTs /api/tasks/:id/toggle with no body", async () => {
    const toggled = { id: "t_1", work_item_id: "wi_1", title: "X", status: "in_progress" };
    fetchMock.mockResolvedValueOnce(jsonOk(toggled));
    const result = await makeRepo().toggleStatus("t_1");
    expect(result).toEqual(toggled);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/tasks/t_1/toggle`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBeUndefined();
    // No body ⇒ no Content-Type, but the bearer is still attached.
    const headers = init?.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
    expect(headers.Authorization).toBe("Bearer tok_123");
  });

  it("addDependency POSTs /api/dependencies and maps the created edge", async () => {
    const edge = { id: "dep_9", source_item_id: "a", target_item_id: "b" };
    fetchMock.mockResolvedValueOnce(jsonOk(edge, 201));
    const result = await makeRepo().addDependency({
      source_item_id: "a",
      target_item_id: "b",
    });
    expect(result).toEqual(edge);
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/dependencies`);
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(
      JSON.stringify({ source_item_id: "a", target_item_id: "b" }),
    );
  });

  it("removeDependency DELETEs and treats 204 as success (no .json())", async () => {
    fetchMock.mockResolvedValueOnce(noContent());
    await expect(makeRepo().removeDependency("dep_1")).resolves.toBeUndefined();
    const { url, init } = callArgs();
    expect(url).toBe(`${BASE}/api/dependencies/dep_1`);
    expect(init?.method).toBe("DELETE");
  });
});

/** Minimal node shape for the graph test (only `id` is read by the slice logic). */
type WorkItemShape = { id: string };
