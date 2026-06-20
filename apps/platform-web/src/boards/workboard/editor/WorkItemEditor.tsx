import { useEffect, useId, useMemo, useState } from "react";

import {
  Button,
  HealthBadge,
  Input,
  Label,
  PhaseSelect,
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  StatusPill,
} from "@product-suite/ui";

import {
  deriveHealth,
  type Phase,
  type Task,
  type WorkItem,
  type WorkItemPatch,
} from "@/data/work-items";

/**
 * Props for {@link WorkItemEditor}.
 *
 * The four-prop core (`item`, `open`, `onOpenChange`, `onSave`) is the contract
 * shared by EVERY surface that opens the editor — table row, future kanban card,
 * future graph node — so the editor stays view-agnostic.
 *
 * `tasks` is the one ADDITIVE, OPTIONAL extension: the contract intentionally
 * passes `WorkItem` (which carries neither tasks nor stored health), yet the
 * editor must show the item's tasks and its DERIVED health (§3 — health is
 * computed on read, never stored). Rather than self-fetch (which would spin up a
 * repository disconnected from the opening surface's store), the caller supplies
 * the tasks it already has; the editor derives health from them. A caller that
 * passes exactly the four required props still type-checks (`tasks` defaults to
 * an empty array).
 */
export interface WorkItemEditorProps {
  /** The item being edited; `null` closes the Sheet. */
  item: WorkItem | null;
  /** Controlled open state of the Sheet. */
  open: boolean;
  /** Sheet open/close (Esc, overlay click, Cancel, successful save). */
  onOpenChange: (open: boolean) => void;
  /**
   * Persist the edited patch. Wire to `hook.update(id, patch)`. MAY REJECT — on
   * rejection the editor keeps the Sheet open and surfaces the error (the hook
   * has already rolled back local state).
   */
  onSave: (id: string, patch: WorkItemPatch) => Promise<void>;
  /**
   * The item's tasks (read-only) — feed derived health + the task list. The
   * caller passes the tasks it already holds; defaults to none.
   */
  tasks?: ReadonlyArray<Task>;
}

/** The subset of {@link WorkItem} the editor edits, mirrored as local form state. */
interface EditorForm {
  title: string;
  phase: Phase;
  department: string;
}

function toForm(item: WorkItem): EditorForm {
  return { title: item.title, phase: item.phase, department: item.department };
}

/**
 * Compute the minimal {@link WorkItemPatch} — only fields whose value changed —
 * so the save reflects the user's actual edits (and matches `WorkItemPatch`
 * partial semantics).
 */
function diffPatch(item: WorkItem, form: EditorForm): WorkItemPatch {
  const patch: WorkItemPatch = {};
  const title = form.title.trim();
  if (title !== item.title) patch.title = title;
  if (form.phase !== item.phase) patch.phase = form.phase;
  const department = form.department.trim();
  if (department !== item.department) patch.department = department;
  return patch;
}

/**
 * WorkItemEditor — the single, view-agnostic editor for a work item.
 *
 * Rendered as a controlled `@product-suite/ui` Sheet. Edits the
 * {@link WorkItemPatch} surface (title, phase, department); shows the item's
 * DERIVED health (read-only) and its tasks with their status. Accessibility
 * (focus trap, Esc-to-close, overlay dismiss) comes from the Sheet's controlled
 * `open`/`onOpenChange`; fields are explicitly labelled.
 */
export function WorkItemEditor({
  item,
  open,
  onOpenChange,
  onSave,
  tasks = [],
}: Readonly<WorkItemEditorProps>) {
  const titleId = useId();
  const departmentId = useId();
  const phaseId = useId();

  const [form, setForm] = useState<EditorForm | null>(
    item ? toForm(item) : null,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form + transient state whenever a different item is loaded (or the
  // Sheet reopens), so stale edits never leak across openings.
  const itemId = item?.id ?? null;
  useEffect(() => {
    setForm(item ? toForm(item) : null);
    setSaving(false);
    setError(null);
  }, [item, itemId, open]);

  // Tasks belonging to this item (the caller may pass a superset).
  const itemTasks = useMemo(
    () => (item ? tasks.filter((task) => task.work_item_id === item.id) : []),
    [item, tasks],
  );

  const health = useMemo(
    () => (item ? deriveHealth(item, itemTasks) : null),
    [item, itemTasks],
  );

  const handleSave = async (): Promise<void> => {
    if (!item || !form) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(item.id, diffPatch(item, form));
      onOpenChange(false);
    } catch (cause) {
      // Keep the Sheet open and surface the failure (state already rolled back
      // upstream by the hook).
      setError(cause instanceof Error ? cause.message : "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full gap-0 sm:max-w-md"
        aria-busy={saving}
      >
        <SheetHeader>
          <SheetTitle>{item ? "Edit work item" : "Work item"}</SheetTitle>
          <SheetDescription>
            Update the work item&apos;s title, phase, and department.
          </SheetDescription>
        </SheetHeader>

        {item && form ? (
          <form
            className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto px-4 pb-2"
            onSubmit={(event) => {
              event.preventDefault();
              void handleSave();
            }}
          >
            {/* Title */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={titleId}>Title</Label>
              <Input
                id={titleId}
                value={form.title}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, title: event.target.value } : prev,
                  )
                }
              />
            </div>

            {/* Phase */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={phaseId}>Phase</Label>
              <PhaseSelect
                id={phaseId}
                value={form.phase}
                disabled={saving}
                onValueChange={(phase) =>
                  setForm((prev) => (prev ? { ...prev, phase } : prev))
                }
              />
            </div>

            {/* Department */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={departmentId}>Department</Label>
              <Input
                id={departmentId}
                value={form.department}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) =>
                    prev ? { ...prev, department: event.target.value } : prev,
                  )
                }
              />
            </div>

            {/* Derived health (read-only) */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium leading-none">
                Health
              </span>
              <div>
                {health ? (
                  <HealthBadge health={health} />
                ) : (
                  <span className="text-sm text-muted-foreground">—</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Derived from tasks and dates — not editable.
              </p>
            </div>

            {/* Tasks (read-only) */}
            <div className="flex flex-col gap-2">
              <span className="text-sm font-medium leading-none">
                Tasks
                {itemTasks.length > 0 ? ` (${itemTasks.length})` : ""}
              </span>
              {itemTasks.length > 0 ? (
                <ul className="flex flex-col gap-2">
                  {itemTasks.map((task) => (
                    <li
                      key={task.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2"
                    >
                      <span className="min-w-0 truncate text-sm">
                        {task.title}
                      </span>
                      <StatusPill status={task.status} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">No tasks yet.</p>
              )}
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </form>
        ) : null}

        <SheetFooter>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving || !item}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
