/**
 * Framework-neutral Workboard core vocabulary (DESIGN §1 / §2 / §11).
 *
 * The single runtime source of truth for the work-item OBJECT MODEL — the
 * Project / WorkItem / Task / WorkItemDependency / ActivityEvent shapes, the two
 * closed sets they carry that are NOT already in `enums.js` (dependency
 * relationship + activity-event kind), the editable work-item patch surface, and
 * the derived-health helper. Framework-neutral so the React `@product-suite/ui`
 * app, the Python backend, and the SDK all validate against ONE artifact instead
 * of each re-declaring the model.
 *
 * Plain ESM (no React, no TS) mirroring the other `src/*.js` contracts. The
 * canonical machine-readable mirror lives in `../contracts/work-items-core.json`;
 * the interfaces/unions live in `./index.d.ts`. A drift-guard test
 * (`work-items.test.ts`) fails if the JS object, the JSON, and the `.d.ts`
 * enumerable content ever disagree.
 *
 * The enum vocabularies this model references by name (`phase`, `taskStatus`,
 * `priority`, `workItemType`, `workItemSource`, `health`) live in `enums.js` /
 * `enums.json` — this module never re-declares them; the object schema just
 * points at them via `{ "kind": "enum", "enum": "<name>" }`.
 */

/**
 * Relationship kind on a {@link WorkItemDependency} edge. Tracks the legacy
 * `linked_items.relationship_type` value set so the F2 adapter maps one-to-one;
 * v1 renders only `depends_on`.
 */
export const DEPENDENCY_RELATIONSHIP_VALUES = [
  "depends_on",
  "blocks",
  "complements",
];

/** Default relationship for a new dependency edge (the only kind v1 renders). */
export const DEPENDENCY_RELATIONSHIP_DEFAULT = "depends_on";

/**
 * The kind of change an {@link ActivityEvent} records — drives the Activity
 * feed's icon/emphasis. v0 covers the mutations the repository emits.
 */
export const ACTIVITY_EVENT_KIND_VALUES = [
  "created",
  "updated",
  "dependency_added",
  "dependency_removed",
];

/**
 * The editable surface of a work item (the {@link WorkItemPatch} keys) shared
 * VERBATIM by the repository `update`, the hook, and the Editor. Excludes managed
 * fields (`id`, timestamps), the derived `health`, and `source` (provenance is
 * recorded once at creation and is display-only). Ordered as declared on the
 * object so selects/forms have a stable field order.
 */
export const WORK_ITEM_PATCH_FIELDS = [
  "title",
  "description",
  "phase",
  "type",
  "priority",
  "tags",
  "project_id",
  "team_id",
  "department",
  "assignee_id",
  "due_date",
  "archived",
];

/**
 * The editable surface of a task (the task-write `TaskPatch` keys). Frozen here
 * so F2 can author `product_tasks` writes against a stable contract.
 */
export const TASK_PATCH_FIELDS = ["title", "status", "due_date"];

/**
 * Canonical mirror of `../contracts/work-items-core.json` (deep-equal in the sync
 * test). A language-neutral description of the core object model: each object's
 * fields with their JSON-friendly type, nullability, and read-only (managed)
 * flag; the two edge/activity enums; and the editable patch surfaces. The Python
 * backend validates payloads against THIS artifact.
 *
 * Field `type` vocabulary:
 *  - `"string" | "boolean" | "string[]"` — primitive JSON shapes,
 *  - `{ kind: "enum", enum: "<name>" }` — one of `enums.json`'s closed sets.
 * `nullable: true` ⇒ the field may be `null`. `readonly: true` ⇒ managed by the
 * store (id / timestamps), never part of a client patch. `optional: true` ⇒ the
 * key may be absent on the wire.
 */
export const workItemsCore = {
  dependencyRelationship: {
    values: DEPENDENCY_RELATIONSHIP_VALUES,
    default: DEPENDENCY_RELATIONSHIP_DEFAULT,
  },
  activityEventKind: {
    values: ACTIVITY_EVENT_KIND_VALUES,
  },
  workItemPatchFields: WORK_ITEM_PATCH_FIELDS,
  taskPatchFields: TASK_PATCH_FIELDS,
  objects: {
    Project: {
      fields: {
        id: { type: "string", readonly: true },
        name: { type: "string" },
        kind: { type: "string" },
        created_at: { type: "string", readonly: true },
        updated_at: { type: "string", readonly: true },
      },
    },
    Team: {
      fields: {
        id: { type: "string", readonly: true },
        tenant_id: { type: "string", readonly: true },
        name: { type: "string" },
        created_at: { type: "string", readonly: true },
        updated_at: { type: "string", readonly: true },
      },
    },
    Owner: {
      fields: {
        id: { type: "string", readonly: true },
        name: { type: "string" },
        initials: { type: "string", optional: true },
      },
    },
    WorkItem: {
      fields: {
        id: { type: "string", readonly: true },
        title: { type: "string" },
        description: { type: "string", optional: true },
        phase: { type: { kind: "enum", enum: "phase" } },
        type: { type: { kind: "enum", enum: "workItemType" } },
        priority: { type: { kind: "enum", enum: "priority" } },
        tags: { type: "string[]" },
        source: { type: { kind: "enum", enum: "workItemSource" } },
        project_id: { type: "string", nullable: true },
        team_id: { type: "string" },
        department: { type: "string" },
        assignee_id: { type: "string", nullable: true },
        due_date: { type: "string", nullable: true },
        archived: { type: "boolean", optional: true },
        created_at: { type: "string", readonly: true },
        updated_at: { type: "string", readonly: true },
      },
    },
    Task: {
      fields: {
        id: { type: "string", readonly: true },
        work_item_id: { type: "string" },
        title: { type: "string" },
        status: { type: { kind: "enum", enum: "taskStatus" } },
        due_date: { type: "string", nullable: true },
        created_at: { type: "string", readonly: true },
        updated_at: { type: "string", readonly: true },
      },
    },
    ActivityEvent: {
      fields: {
        id: { type: "string", readonly: true },
        work_item_id: { type: "string" },
        kind: { type: { kind: "enum", enum: "activityEventKind" } },
        summary: { type: "string" },
        created_at: { type: "string", readonly: true },
      },
    },
    WorkItemDependency: {
      fields: {
        id: { type: "string", readonly: true },
        source_item_id: { type: "string" },
        target_item_id: { type: "string" },
        relationship_type: {
          type: { kind: "enum", enum: "dependencyRelationship" },
        },
        created_at: { type: "string", readonly: true },
      },
    },
  },
};

/**
 * Pure health derivation (DESIGN §1 / §3 — health is ALWAYS derived, never
 * stored or hand-set). Maps `(workItem, tasks)` to a health value in the
 * `enums.js` `health` set (`on_track` | `at_risk` | `blocked`).
 *
 * Rules (deterministic, in priority order):
 *  1. `blocked`  — the item is past its `due_date` and still has incomplete
 *     tasks (the work cannot land on time).
 *  2. `at_risk`  — any task is past its own `due_date` while still incomplete,
 *     OR the item is past `due_date` with no tasks to show progress.
 *  3. `on_track` — `phase === "done"`, or every task is completed, or nothing
 *     above fired.
 *
 * `now` is injected (defaulted to `Date.now()`) so callers and tests stay
 * deterministic — never read the clock implicitly.
 *
 * @param {{ phase: string, due_date: string | null }} workItem the item whose health to compute.
 * @param {ReadonlyArray<{ status: string, due_date: string | null }>} tasks the item's tasks (may be empty).
 * @param {number} [now] reference epoch ms; defaults to the current time.
 * @returns {"on_track" | "at_risk" | "blocked"}
 */
export function deriveHealth(workItem, tasks, now = Date.now()) {
  const isComplete = (status) => status === "completed";
  const isOverdue = (due) => due !== null && Date.parse(due) < now;

  const incompleteTasks = tasks.filter((task) => !isComplete(task.status));
  const itemOverdue = isOverdue(workItem.due_date);

  // 1. Past due with work still open → blocked.
  if (itemOverdue && incompleteTasks.length > 0) {
    return "blocked";
  }

  // 2. An overdue-and-incomplete task, or an overdue item with no tasks → at risk.
  const hasOverdueOpenTask = incompleteTasks.some((task) =>
    isOverdue(task.due_date),
  );
  if (hasOverdueOpenTask || (itemOverdue && tasks.length === 0)) {
    return "at_risk";
  }

  // 3. Otherwise on track.
  return "on_track";
}
