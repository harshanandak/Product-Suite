import type {
  AddDependencyInput,
  CreateTaskInput,
  CreateWorkItemInput,
  ListGraphOptions,
  TaskPatch,
  WorkItemGraph,
  WorkItemRepository,
} from "./repository";
import { DEFAULT_GRAPH_DEPTH } from "./repository";
import type {
  ActivityEvent,
  Owner,
  Project,
  Task,
  WorkItem,
  WorkItemDependency,
  WorkItemPatch,
} from "./types";

/** Configuration for {@link createNetworkWorkItemRepository}. */
export interface NetworkRepositoryOptions {
  /** Origin of the platform API (e.g. `https://api.example.com`), no trailing slash. */
  baseUrl: string;
  /**
   * Resolve the current Clerk session token (via `useAuth().getToken()`), or
   * `null` when signed out. Called per request so a rotated/refreshed token is
   * always used — the adapter never caches it.
   */
  getToken: () => Promise<string | null>;
  /**
   * Per-request timeout in ms (default 15000). A hung/slow API can't leave a read
   * pending forever — the fetch is aborted and the read rejects, so the hook's
   * `loading` state resolves to an error instead of spinning indefinitely.
   */
  timeoutMs?: number;
}

/** Default per-request timeout (ms). */
const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Undirected `depth`-hop neighborhood of `focusId` over the dependency edges —
 * the client-side equivalent of the mock's focused {@link WorkItemRepository.listGraph}
 * (nodes + the edges among them), computed from a full read until the API serves
 * graph slices server-side.
 */
function neighborhood(
  nodes: WorkItem[],
  dependencies: WorkItemDependency[],
  focusId: string,
  depth: number,
): WorkItemGraph {
  if (!nodes.some((node) => node.id === focusId)) {
    return { nodes: [], dependencies: [] };
  }

  const adjacency = new Map<string, Set<string>>();
  const link = (from: string, to: string): void => {
    const set = adjacency.get(from);
    if (set) set.add(to);
    else adjacency.set(from, new Set([to]));
  };
  for (const dependency of dependencies) {
    link(dependency.source_item_id, dependency.target_item_id);
    link(dependency.target_item_id, dependency.source_item_id);
  }

  const inScope = new Set<string>([focusId]);
  let frontier: string[] = [focusId];
  for (let hop = 0; hop < Math.max(0, depth); hop += 1) {
    const next: string[] = [];
    for (const node of frontier) {
      for (const neighbor of adjacency.get(node) ?? []) {
        if (!inScope.has(neighbor)) {
          inScope.add(neighbor);
          next.push(neighbor);
        }
      }
    }
    if (next.length === 0) break;
    frontier = next;
  }

  return {
    nodes: nodes.filter((node) => inScope.has(node.id)),
    dependencies: dependencies.filter(
      (dependency) =>
        inScope.has(dependency.source_item_id) &&
        inScope.has(dependency.target_item_id),
    ),
  };
}

/**
 * The network {@link WorkItemRepository} — the adapter that fills the workboard's
 * data seam against the real platform API (Clerk-verified, tenant-scoped) instead
 * of the in-memory mock. Reads AND writes hit the live tenant-scoped endpoints;
 * only `getTasks` and `listGraph` retain a client-side shim (filter/BFS) until
 * the API serves those slices server-side.
 */
export function createNetworkWorkItemRepository(
  options: NetworkRepositoryOptions,
): WorkItemRepository {
  const { baseUrl, getToken } = options;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  /**
   * The single fetch primitive behind every method. Attaches JSON + bearer
   * headers, bounds the request with an abort timeout, and normalizes errors:
   * a non-OK response surfaces the API's `error` field when present (so a 409
   * cycle/duplicate message reaches the caller), else `Request failed (<status>)`.
   * A `204 No Content` resolves to `undefined` (never calls `.json()`).
   */
  async function request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const token = await getToken();
    const headers: Record<string, string> = {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      // Abort a hung/slow request so a call never spins forever.
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      let message = `Request failed (${response.status})`;
      try {
        const errorBody = (await response.json()) as { error?: unknown };
        if (typeof errorBody?.error === "string") {
          message = errorBody.error;
        }
      } catch {
        // Non-JSON (or empty) error body — keep the status-based message.
      }
      throw new Error(message);
    }

    // 204 No Content has no body to parse (e.g. DELETE dependency).
    if (response.status === 204) {
      return undefined as T;
    }
    return (await response.json()) as T;
  }

  return {
    list: () => request<WorkItem[]>("GET", "/api/work-items"),
    listProjects: () => request<Project[]>("GET", "/api/projects"),
    listOwners: () => request<Owner[]>("GET", "/api/owners"),
    listTasks: () => request<Task[]>("GET", "/api/tasks"),
    listDependencies: () =>
      request<WorkItemDependency[]>("GET", "/api/dependencies"),

    async getTasks(workItemId: string): Promise<Task[]> {
      // No single-item tasks endpoint yet — filter the tenant-scoped list.
      const tasks = await request<Task[]>("GET", "/api/tasks");
      return tasks.filter((task) => task.work_item_id === workItemId);
    },

    async listGraph(options: ListGraphOptions = {}): Promise<WorkItemGraph> {
      const [nodes, dependencies] = await Promise.all([
        request<WorkItem[]>("GET", "/api/work-items"),
        request<WorkItemDependency[]>("GET", "/api/dependencies"),
      ]);
      if (options.focusId === undefined) {
        return { nodes, dependencies };
      }
      return neighborhood(
        nodes,
        dependencies,
        options.focusId,
        options.depth ?? DEFAULT_GRAPH_DEPTH,
      );
    },

    subscribe(): () => void {
      // No realtime transport yet — inert unsubscribe (polling/SSE arrives with
      // the write surface). The mock is equally inert, so callers are unaffected.
      return () => {};
    },

    // --- Writes + activity feed: live tenant-scoped endpoints ---
    create: (input: CreateWorkItemInput) =>
      request<WorkItem>("POST", "/api/work-items", input),
    update: (id: string, patch: WorkItemPatch) =>
      request<WorkItem>("PATCH", `/api/work-items/${id}`, patch),
    listActivity: (workItemId: string) =>
      request<ActivityEvent[]>("GET", `/api/work-items/${workItemId}/activity`),
    createTask: (input: CreateTaskInput) =>
      request<Task>("POST", "/api/tasks", input),
    updateTask: (id: string, patch: TaskPatch) =>
      request<Task>("PATCH", `/api/tasks/${id}`, patch),
    toggleStatus: (id: string) =>
      request<Task>("POST", `/api/tasks/${id}/toggle`),
    addDependency: (input: AddDependencyInput) =>
      request<WorkItemDependency>("POST", "/api/dependencies", input),
    removeDependency: (id: string) =>
      request<void>("DELETE", `/api/dependencies/${id}`),
  };
}
