import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNetworkWorkItemRepository } from "./network-repository";

const BASE = "https://api.test";

function jsonOk(body: unknown) {
  return { ok: true, status: 200, json: async () => body } as Response;
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

  it("write + activity methods reject as pending until their endpoints ship", async () => {
    const repo = makeRepo();
    await expect(repo.create({})).rejects.toThrow("create: not yet available");
    await expect(repo.update("x", {})).rejects.toThrow("update: not yet available");
    await expect(repo.createTask({ work_item_id: "x" })).rejects.toThrow(
      "createTask: not yet available",
    );
    await expect(repo.toggleStatus("x")).rejects.toThrow("toggleStatus: not yet available");
    await expect(
      repo.addDependency({ source_item_id: "a", target_item_id: "b" }),
    ).rejects.toThrow("addDependency: not yet available");
    await expect(repo.listActivity("x")).rejects.toThrow("listActivity: not yet available");
    // No network for pure stubs.
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

/** Minimal node shape for the graph test (only `id` is read by the slice logic). */
type WorkItemShape = { id: string };
