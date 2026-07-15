import type { MemoriesAdapter } from "./adapter";
import type {
  CreateMemoryInput,
  DeferMemoryInput,
  MemoryDetail,
  MemoryFilters,
  MemoryRow,
  SupersedeMemoryInput,
} from "./types";

/** A compact factory for a fully-populated {@link MemoryRow} in fixtures/mock. */
function row(partial: Partial<MemoryRow> & Pick<MemoryRow, "id" | "title">): MemoryRow {
  const now = "2026-07-14T09:00:00.000Z";
  return {
    tenant_id: "org_demo",
    kind: "decision",
    body: null,
    attrs: null,
    supersedes_id: null,
    superseded_by_id: null,
    change_reason: null,
    valid_from: now,
    status: "active",
    waiting_on: null,
    review_after: null,
    scope_type: "org",
    scope_id: null,
    topics: [],
    source_kind: "manual",
    source_run_id: null,
    source_proposal_id: null,
    source_quote: null,
    created_by: "user_demo",
    decided_by: null,
    pinned: false,
    priority: null,
    enforcement: null,
    created_at: now,
    updated_at: now,
    ...partial,
    root_id: partial.root_id ?? partial.id,
  };
}

/** A small, illustrative seed for preview mode / tests. */
export function createMemoryFixtures(): MemoryRow[] {
  return [
    row({
      id: "mem_1",
      kind: "decision",
      title: "Standardize on Kimi K2.5 for the blog writer",
      body: "Cheaper per token than GLM-5 at comparable quality on our eval set.",
      topics: ["models", "blog"],
      source_kind: "meeting",
      decided_by: "Harsha",
      created_at: "2026-07-10T09:00:00.000Z",
    }),
    row({
      id: "mem_2",
      kind: "fact",
      title: "Ad account is act_170153044",
      topics: ["meta-ads"],
      source_kind: "manual",
      created_at: "2026-07-11T09:00:00.000Z",
    }),
    row({
      id: "mem_3",
      kind: "decision",
      title: "Ship Option B (phase-lifecycle on flat tasks) first",
      body: "Two-axis model; Cycle stays orthogonal.",
      topics: ["work-item-model"],
      source_kind: "chat",
      created_at: "2026-07-12T09:00:00.000Z",
    }),
  ];
}

/** Matches a row against the (optional) list filters. */
function matches(memory: MemoryRow, filters?: MemoryFilters): boolean {
  if (!filters) return true;
  if (filters.kind && memory.kind !== filters.kind) return false;
  if (filters.status && memory.status !== filters.status) return false;
  if (filters.scope_type && memory.scope_type !== filters.scope_type) return false;
  if (filters.scope_id && memory.scope_id !== filters.scope_id) return false;
  if (filters.topic && !memory.topics.includes(filters.topic)) return false;
  if (filters.q) {
    const hay = `${memory.title} ${memory.body ?? ""}`.toLowerCase();
    if (!hay.includes(filters.q.toLowerCase())) return false;
  }
  return true;
}

/**
 * An in-memory {@link MemoriesAdapter} over {@link createMemoryFixtures}, for
 * preview mode (`USE_FIXTURES`) and tests. Owns an isolated copy so parallel
 * instances never share state. Mutations model the real supersession semantics:
 * `supersede` marks the old row superseded and appends a new active version
 * linked through `root_id`/`supersedes_id`/`superseded_by_id`.
 */
export function createMockMemoriesAdapter(
  options: { seed?: MemoryRow[] } = {},
): MemoriesAdapter {
  const store: MemoryRow[] = (options.seed ?? createMemoryFixtures()).map((m) => ({
    ...m,
  }));
  let counter = store.length;
  const nowIso = (): string => new Date().toISOString();

  function find(id: string): MemoryRow {
    const memory = store.find((m) => m.id === id);
    if (!memory) throw new Error(`Request failed (404)`);
    return memory;
  }

  return {
    list: (filters?: MemoryFilters) =>
      Promise.resolve(
        store
          .filter((m) => matches(m, filters))
          .map((m) => ({ ...m }))
          .sort((a, b) => b.created_at.localeCompare(a.created_at)),
      ),

    get: async (id: string): Promise<MemoryDetail> => {
      const memory = find(id);
      const rootId = memory.root_id ?? memory.id;
      const chain = store
        .filter((m) => (m.root_id ?? m.id) === rootId)
        .map((m) => ({ ...m }))
        .sort((a, b) => a.created_at.localeCompare(b.created_at));
      return Promise.resolve({ memory: { ...memory }, chain });
    },

    create: (input: CreateMemoryInput): Promise<MemoryRow> => {
      counter += 1;
      const now = nowIso();
      const id = `mem_${counter}`;
      const created = row({
        id,
        kind: input.kind,
        title: input.title,
        body: input.body ?? null,
        topics: input.topics ?? [],
        scope_type: input.scopeType ?? "org",
        scope_id: input.scopeId ?? null,
        source_kind: input.sourceKind ?? "manual",
        decided_by: input.decidedBy ?? null,
        created_at: now,
        updated_at: now,
        valid_from: now,
      });
      store.push(created);
      return Promise.resolve({ ...created });
    },

    supersede: async (
      id: string,
      input: SupersedeMemoryInput,
    ): Promise<MemoryRow> => {
      const old = find(id);
      counter += 1;
      const now = nowIso();
      const newId = `mem_${counter}`;
      const replacement = row({
        ...old,
        id: newId,
        title: input.title ?? old.title,
        body: input.body ?? old.body,
        topics: input.topics ?? old.topics,
        root_id: old.root_id ?? old.id,
        supersedes_id: old.id,
        superseded_by_id: null,
        change_reason: input.change_reason,
        status: "active",
        created_at: now,
        updated_at: now,
        valid_from: now,
      });
      const index = store.findIndex((m) => m.id === id);
      store[index] = {
        ...old,
        status: "superseded",
        superseded_by_id: newId,
        updated_at: now,
      };
      store.push(replacement);
      return Promise.resolve({ ...replacement });
    },

    retract: async (id: string): Promise<MemoryRow> => {
      const memory = find(id);
      const index = store.findIndex((m) => m.id === id);
      const next = { ...memory, status: "retracted" as const, updated_at: nowIso() };
      store[index] = next;
      return Promise.resolve({ ...next });
    },

    defer: async (id: string, input: DeferMemoryInput): Promise<MemoryRow> => {
      const memory = find(id);
      const index = store.findIndex((m) => m.id === id);
      const next = {
        ...memory,
        status: "deferred" as const,
        waiting_on: input.waiting_on ?? null,
        review_after: input.review_after ?? null,
        updated_at: nowIso(),
      };
      store[index] = next;
      return Promise.resolve({ ...next });
    },

    reactivate: async (id: string): Promise<MemoryRow> => {
      const memory = find(id);
      const index = store.findIndex((m) => m.id === id);
      const next = {
        ...memory,
        status: "active" as const,
        waiting_on: null,
        review_after: null,
        updated_at: nowIso(),
      };
      store[index] = next;
      return Promise.resolve({ ...next });
    },
  };
}
