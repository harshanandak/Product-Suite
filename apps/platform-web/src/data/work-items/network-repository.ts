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
}

/**
 * Methods whose platform-api endpoints do not exist yet (all writes + the
 * per-item activity feed). Rejecting with a clear message — rather than silently
 * failing — keeps the mock the safe default until these land; the moment their
 * endpoints ship, each stub becomes a real `POST`/`PATCH`/`GET`.
 */
function pending(method: string): Promise<never> {
  return Promise.reject(
    new Error(`${method}: not yet available — pending platform-api endpoint`),
  );
}

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
 * of the in-memory mock. Reads hit the live tenant-scoped endpoints; writes +
 * `listActivity` are stubbed until their endpoints ship (see {@link pending}), so
 * this is safe to build and test ahead of the cutover without breaking edits.
 */
export function createNetworkWorkItemRepository(
  options: NetworkRepositoryOptions,
): WorkItemRepository {
  const { baseUrl, getToken } = options;

  async function get<T>(path: string): Promise<T> {
    const token = await getToken();
    const response = await fetch(`${baseUrl}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}): GET ${path}`);
    }
    return (await response.json()) as T;
  }

  return {
    list: () => get<WorkItem[]>("/api/work-items"),
    listProjects: () => get<Project[]>("/api/projects"),
    listOwners: () => get<Owner[]>("/api/owners"),
    listTasks: () => get<Task[]>("/api/tasks"),
    listDependencies: () => get<WorkItemDependency[]>("/api/dependencies"),

    async getTasks(workItemId: string): Promise<Task[]> {
      // No single-item tasks endpoint yet — filter the tenant-scoped list.
      const tasks = await get<Task[]>("/api/tasks");
      return tasks.filter((task) => task.work_item_id === workItemId);
    },

    async listGraph(options: ListGraphOptions = {}): Promise<WorkItemGraph> {
      const [nodes, dependencies] = await Promise.all([
        get<WorkItem[]>("/api/work-items"),
        get<WorkItemDependency[]>("/api/dependencies"),
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

    // --- Writes + activity feed: pending their platform-api endpoints ---
    create: (_input: CreateWorkItemInput) => pending("create"),
    update: (_id: string, _patch: WorkItemPatch) => pending("update"),
    createTask: (_input: CreateTaskInput) => pending("createTask"),
    updateTask: (_id: string, _patch: TaskPatch) => pending("updateTask"),
    toggleStatus: (_id: string) => pending("toggleStatus"),
    addDependency: (_input: AddDependencyInput) => pending("addDependency"),
    removeDependency: (_id: string) => pending("removeDependency"),
    listActivity: (_workItemId: string) => pending("listActivity"),
  };
}
